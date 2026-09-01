use crate::catalog::catalog::load_catalog;
use crate::paths::{get_agent_skills_dir, get_catalog_path, get_catalog_skills_dir};
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

pub fn run_doctor<P: AsRef<Path>>(
    project_root: P,
    fix: bool,
    targets: &[TargetName],
) -> anyhow::Result<DiagnosticReport> {
    let root = project_root.as_ref();
    let mut report = DiagnosticReport::default();

    // 1. Catalog Health Check
    let catalog_path = get_catalog_path();
    match load_catalog() {
        Ok(cat) => {
            report.checks.push(DiagnosticCheck {
                category: "Catalog".to_string(),
                title: format!("Catalog loaded ({} MCPs, {} Skills)", cat.mcps.len(), cat.skills.len()),
                status: CheckStatus::Pass,
                detail: Some(catalog_path.display().to_string()),
                fix_applied: None,
            });
        }
        Err(e) => {
            let mut fix_applied = None;
            if fix {
                if let Ok(_) = crate::catalog::catalog::init_catalog() {
                    fix_applied = Some("Initialized fresh empty catalog.toml".to_string());
                    report.fixed_count += 1;
                }
            }
            report.has_errors = true;
            report.checks.push(DiagnosticCheck {
                category: "Catalog".to_string(),
                title: format!("Failed to load catalog: {}", e),
                status: CheckStatus::Error,
                detail: None,
                fix_applied,
            });
        }
    }

    // 2. Catalog Skills Directory & Dangling Symlinks Check (Proposal 3)
    let catalog_skills = get_catalog_skills_dir();
    if catalog_skills.exists() {
        if let Ok(entries) = fs::read_dir(&catalog_skills) {
            for entry in entries.flatten() {
                let p = entry.path();
                if let Ok(meta) = fs::symlink_metadata(&p) {
                    if meta.file_type().is_symlink() {
                        let is_broken = fs::metadata(&p).is_err();
                        if is_broken {
                            let mut fix_applied = None;
                            if fix {
                                if let Ok(_) = fs::remove_file(&p) {
                                    fix_applied = Some("Removed dangling symlink in catalog".to_string());
                                    report.fixed_count += 1;
                                }
                            } else {
                                report.has_warnings = true;
                            }

                            report.checks.push(DiagnosticCheck {
                                category: "Catalog Skills".to_string(),
                                title: format!("Dangling symlink in catalog: {}", entry.file_name().to_string_lossy()),
                                status: CheckStatus::Warning,
                                detail: fs::read_link(&p).ok().map(|t| format!("Points to missing path: {}", t.display())),
                                fix_applied,
                            });
                        }
                    }
                }
            }
        }
    }

    // 3. Target Provider Skills Dangling Symlinks Check (Proposal 3)
    for &target in targets {
        let skills_dir = get_agent_skills_dir(root, target);
        if skills_dir.exists() {
            if let Ok(entries) = fs::read_dir(&skills_dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if let Ok(meta) = fs::symlink_metadata(&p) {
                        if meta.file_type().is_symlink() {
                            let is_broken = fs::metadata(&p).is_err();
                            if is_broken {
                                let mut fix_applied = None;
                                if fix {
                                    if let Ok(_) = fs::remove_file(&p) {
                                        fix_applied = Some(format!("Removed broken symlink for {}", target));
                                        report.fixed_count += 1;
                                    }
                                } else {
                                    report.has_warnings = true;
                                }

                                report.checks.push(DiagnosticCheck {
                                    category: format!("Target Skills ({})", target),
                                    title: format!("Broken skill symlink: {}", entry.file_name().to_string_lossy()),
                                    status: CheckStatus::Warning,
                                    detail: fs::read_link(&p).ok().map(|t| format!("Points to: {}", t.display())),
                                    fix_applied,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    // 4. Environment Check (node, npm, npx)
    for tool in &["node", "npm", "npx"] {
        if which_exists(tool) {
            report.checks.push(DiagnosticCheck {
                category: "Environment".to_string(),
                title: format!("{}: available", tool),
                status: CheckStatus::Pass,
                detail: None,
                fix_applied: None,
            });
        } else {
            report.has_warnings = true;
            report.checks.push(DiagnosticCheck {
                category: "Environment".to_string(),
                title: format!("{}: not found in PATH", tool),
                status: CheckStatus::Warning,
                detail: Some("May be required for running npx MCP servers".to_string()),
                fix_applied: None,
            });
        }
    }

    Ok(report)
}

fn which_exists(cmd: &str) -> bool {
    std::process::Command::new("which")
        .arg(cmd)
        .output()
        .map_or(false, |out| out.status.success())
}
