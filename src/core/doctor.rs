use crate::adapters::{get_mcp_servers, validate_recipe};
use crate::catalog::store::load_catalog;
use crate::paths::*;
use crate::types::TargetName;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DiagnosticReport {
    pub has_errors: bool,
    pub has_warnings: bool,
    pub fixed_count: usize,
    pub checks: Vec<DiagnosticCheck>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticCheck {
    pub category: String,
    pub title: String,
    pub status: CheckStatus,
    pub detail: Option<String>,
    pub fix_applied: Option<String>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CheckStatus {
    Pass,
    Warning,
    Error,
    Info,
}
impl DiagnosticReport {
    fn add(
        &mut self,
        category: &str,
        title: impl Into<String>,
        status: CheckStatus,
        detail: Option<String>,
    ) {
        self.has_errors |= status == CheckStatus::Error;
        self.has_warnings |= status == CheckStatus::Warning;
        self.checks.push(DiagnosticCheck {
            category: category.into(),
            title: title.into(),
            status,
            detail,
            fix_applied: None,
        });
    }
}

pub fn command_exists(command: &str, cwd: &Path) -> bool {
    fn executable(path: &Path) -> bool {
        if !path.is_file() {
            return false;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::metadata(path).is_ok_and(|m| m.permissions().mode() & 0o111 != 0)
        }
        #[cfg(not(unix))]
        {
            true
        }
    }
    if command.contains('/') || command.contains('\\') {
        return executable(&cwd.join(expand_home(command)));
    }
    std::env::var_os("PATH").is_some_and(|path| {
        std::env::split_paths(&path).any(|dir| {
            if executable(&dir.join(command)) {
                return true;
            }
            #[cfg(windows)]
            {
                return std::env::var("PATHEXT")
                    .unwrap_or_else(|_| ".EXE;.CMD;.BAT".into())
                    .split(';')
                    .any(|ext| executable(&dir.join(format!("{command}{ext}"))));
            }
            #[cfg(not(windows))]
            {
                false
            }
        })
    })
}

fn links(
    report: &mut DiagnosticReport,
    dir: &Path,
    fix: bool,
    portable: bool,
) -> anyhow::Result<()> {
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if !fs::symlink_metadata(&path)?.file_type().is_symlink() {
            continue;
        }
        let target = fs::read_link(&path)?;
        if !path.exists() {
            if fix {
                fs::remove_file(&path)?;
                report.fixed_count += 1;
                report.add(
                    "Links",
                    format!("Removed broken link: {}", path.display()),
                    CheckStatus::Pass,
                    Some(target.display().to_string()),
                );
                report.checks.last_mut().unwrap().fix_applied =
                    Some("Removed dangling symlink; source was not modified".into());
            } else {
                report.add(
                    "Links",
                    format!("Broken link: {}", path.display()),
                    CheckStatus::Warning,
                    Some(target.display().to_string()),
                );
            }
        } else if portable && target.is_absolute() {
            report.add(
                "Portability",
                format!("Absolute development link: {}", path.display()),
                CheckStatus::Warning,
                Some("Use skill import or plugin import for a portable snapshot".into()),
            );
        }
    }
    Ok(())
}

pub fn run_doctor<P: AsRef<Path>>(
    project_root: P,
    fix: bool,
    targets: &[TargetName],
) -> anyhow::Result<DiagnosticReport> {
    let root = project_root.as_ref();
    let mut report = DiagnosticReport::default();
    match load_catalog() {
        Ok(cat) => report.add(
            "Catalog",
            format!(
                "Loaded {} MCPs and {} skills",
                cat.mcps.len(),
                cat.skills.len()
            ),
            CheckStatus::Pass,
            Some(get_catalog_dir().display().to_string()),
        ),
        Err(e) => report.add(
            "Catalog",
            "Cannot load catalog",
            CheckStatus::Error,
            Some(e.to_string()),
        ),
    }
    for path in [
        get_skills_metadata_path(),
        get_mcps_metadata_path(),
        crate::core::plugin::metadata_path(),
    ] {
        if let Err(e) = crate::storage::read_value(&path) {
            report.add(
                "Metadata",
                path.display().to_string(),
                CheckStatus::Error,
                Some(e.to_string()),
            );
        }
    }
    for path in [get_catalog_skills_dir(), get_catalog_plugins_dir()] {
        links(&mut report, &path, fix, true)?;
    }
    for &target in targets {
        let path = get_agent_mcp_config_path(root, target);
        match get_mcp_servers(target, &path) {
            Err(e) => report.add(
                "Configuration",
                format!("Invalid {target} configuration"),
                CheckStatus::Error,
                Some(e.to_string()),
            ),
            Ok(servers) => {
                report.add(
                    "Configuration",
                    format!("{target}: {} MCP definitions", servers.len()),
                    CheckStatus::Pass,
                    Some(path.display().to_string()),
                );
                if target == TargetName::Antigravity && !is_home_scope(root) && path.exists() {
                    report.add(
                        "Scope",
                        "Antigravity project MCP configuration is not read by the provider",
                        CheckStatus::Warning,
                        Some("Use --home for Antigravity MCP servers".into()),
                    );
                }
                for (name, server) in servers {
                    let Some(recipe) = server.recipe else {
                        continue;
                    };
                    if let Err(e) = validate_recipe(&recipe) {
                        report.add(
                            "MCP",
                            format!("{target}/{name}"),
                            CheckStatus::Error,
                            Some(e.to_string()),
                        );
                        continue;
                    }
                    if !server.enabled {
                        continue;
                    }
                    let cwd = recipe
                        .cwd
                        .as_ref()
                        .map(|s| root.join(expand_home(s)))
                        .unwrap_or_else(|| root.to_path_buf());
                    if !cwd.is_dir() {
                        report.add(
                            "MCP",
                            format!("{target}/{name}: missing working directory"),
                            CheckStatus::Error,
                            Some(cwd.display().to_string()),
                        );
                    }
                    if let Some(command) = &recipe.command {
                        if !command_exists(command, &cwd) {
                            report.add(
                                "Command",
                                format!("{target}/{name}: {command} is unavailable"),
                                CheckStatus::Warning,
                                None,
                            );
                        }
                    }
                    if recipe
                        .cwd
                        .as_ref()
                        .is_some_and(|p| Path::new(p).is_absolute())
                        || recipe
                            .command
                            .as_ref()
                            .is_some_and(|p| Path::new(p).is_absolute())
                    {
                        report.add(
                            "Portability",
                            format!("{target}/{name}: absolute path"),
                            CheckStatus::Warning,
                            Some("This recipe depends on the current machine".into()),
                        );
                    }
                }
            }
        }
        links(&mut report, &get_agent_skills_dir(root, target), fix, false)?;
        if let Some(dir) = get_agent_plugins_dir(root, target) {
            links(&mut report, &dir, fix, false)?;
        }
    }
    if let Ok(status) = crate::core::mcp::get_mcp_workspace_status(root, targets) {
        for server in status.servers {
            for (target, state) in server.state {
                if state == "differs" {
                    report.add(
                        "Drift",
                        format!("{target}/{} differs from catalog", server.name),
                        CheckStatus::Warning,
                        Some(
                            "Use mcp update to deploy or mcp adopt to save the native recipe"
                                .into(),
                        ),
                    );
                }
            }
        }
    }
    if let Ok(drift) = crate::core::discovery::plugin_drift() {
        for plugin in drift.as_array().into_iter().flatten() {
            if plugin["state"] != "current" {
                report.add(
                    "Plugins",
                    format!(
                        "{}: {}",
                        plugin["name"].as_str().unwrap_or("plugin"),
                        plugin["state"].as_str().unwrap_or("unknown")
                    ),
                    CheckStatus::Warning,
                    None,
                );
            }
        }
    }
    Ok(report)
}
