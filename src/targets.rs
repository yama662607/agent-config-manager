//! Resolution of configured provider instances, independent of resource operations.
//!
//! A target ID identifies an installation; `TargetName` identifies its provider.
//! Keeping those identities separate allows multiple installations of one provider.
use crate::types::TargetName;
use anyhow::{bail, Context};
use serde::Deserialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct TargetInstance {
    pub id: String,
    pub provider: TargetName,
    pub display_name: String,
    pub short_code: String,
    pub tui_key: Option<char>,
    pub home_dir: PathBuf,
    pub mcp_config: PathBuf,
    pub skills_dir: PathBuf,
    pub plugins_dir: Option<PathBuf>,
    pub builtin: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Profile {
    id: String,
    provider: String,
    display_name: String,
    short_code: String,
    #[serde(default)]
    tui_key: Option<char>,
    home_dir: String,
    #[serde(default)]
    mcp_config: Option<String>,
    #[serde(default)]
    skills_dir: Option<String>,
    #[serde(default)]
    plugins_dir: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TargetRegistry {
    targets: Vec<TargetInstance>,
}

fn resolve_path(value: &str, home: &Path) -> anyhow::Result<PathBuf> {
    if value.trim().is_empty() {
        bail!("profile paths must not be empty");
    }
    let path = if value == "~" {
        home.to_path_buf()
    } else if let Some(rest) = value.strip_prefix("~/") {
        home.join(rest)
    } else {
        PathBuf::from(value)
    };
    if !path.is_absolute() {
        bail!("profile path must be absolute or start with ~/: {value}");
    }
    if path
        .components()
        .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        bail!("profile path must not contain '..': {value}");
    }
    Ok(path)
}

fn comparable_path(path: &Path) -> PathBuf {
    for ancestor in path.ancestors() {
        if let Ok(canonical) = ancestor.canonicalize() {
            if let Ok(remainder) = path.strip_prefix(ancestor) {
                return canonical.join(remainder);
            }
        }
    }
    path.to_path_buf()
}

/// Distinct target IDs must not operate on the same provider installation or resource.
pub fn validate_distinct(targets: &[&TargetInstance]) -> anyhow::Result<()> {
    for (index, left) in targets.iter().enumerate() {
        for right in &targets[index + 1..] {
            if left.provider != right.provider {
                continue;
            }
            for (label, a, b) in [
                ("home", Some(&left.home_dir), Some(&right.home_dir)),
                (
                    "MCP configuration",
                    Some(&left.mcp_config),
                    Some(&right.mcp_config),
                ),
                (
                    "skills directory",
                    Some(&left.skills_dir),
                    Some(&right.skills_dir),
                ),
                (
                    "plugins directory",
                    left.plugins_dir.as_ref(),
                    right.plugins_dir.as_ref(),
                ),
            ] {
                if let (Some(a), Some(b)) = (a, b) {
                    if comparable_path(a) == comparable_path(b) {
                        bail!(
                            "targets {} and {} share the same {label}: {}",
                            left.id,
                            right.id,
                            a.display()
                        );
                    }
                }
            }
        }
    }
    Ok(())
}

impl TargetRegistry {
    /// Build a registry without creating or modifying any files.
    pub fn from_config(
        config: &toml::Table,
        home: &Path,
        claude_home: Option<&Path>,
        codex_home: Option<&Path>,
    ) -> anyhow::Result<Self> {
        let mut targets = Vec::new();
        for &provider in TargetName::all() {
            let spec = provider.spec();
            let override_home = match provider {
                TargetName::Claude => claude_home,
                TargetName::Codex => codex_home,
                _ => None,
            }
            .filter(|p| !p.as_os_str().is_empty());
            let default_home = match provider {
                TargetName::Claude => home.join(".claude"),
                TargetName::Codex => home.join(".codex"),
                _ => home
                    .join(spec.home_skills_dir)
                    .parent()
                    .expect("provider skills path has a parent")
                    .to_path_buf(),
            };
            let target_home = override_home.unwrap_or(&default_home).to_path_buf();
            let (mcp_config, skills_dir, plugins_dir) = if let Some(dir) = override_home {
                let mcp = match provider {
                    TargetName::Claude => ".claude.json",
                    TargetName::Codex => "config.toml",
                    _ => unreachable!(),
                };
                (
                    dir.join(mcp),
                    dir.join("skills"),
                    spec.home_plugins_dir.map(|_| dir.join("plugins")),
                )
            } else {
                (
                    home.join(spec.home_mcp_config),
                    home.join(spec.home_skills_dir),
                    spec.home_plugins_dir.map(|p| home.join(p)),
                )
            };
            targets.push(TargetInstance {
                id: provider.as_str().into(),
                provider,
                display_name: provider.display_name().into(),
                short_code: provider.short_code().into(),
                tui_key: Some(provider.tui_key()),
                home_dir: target_home,
                mcp_config,
                skills_dir,
                plugins_dir,
                builtin: true,
            });
        }
        let profiles: Vec<Profile> = match config.get("profiles") {
            Some(value) => value
                .clone()
                .try_into()
                .context("invalid profiles configuration")?,
            None => Vec::new(),
        };
        let mut ids: HashSet<String> = TargetName::all()
            .iter()
            .flat_map(|p| p.spec().aliases.iter().map(|s| (*s).to_owned()))
            .collect();
        ids.insert("all".into());
        let mut codes: HashSet<String> = targets
            .iter()
            .map(|t| t.short_code.to_lowercase())
            .collect();
        let mut keys: HashSet<char> = targets.iter().filter_map(|t| t.tui_key).collect();
        for profile in profiles {
            let provider = TargetName::all()
                .iter()
                .copied()
                .find(|target| target.as_str() == profile.provider)
                .with_context(|| format!("unknown profile provider: {}", profile.provider))?;
            if profile.id.is_empty()
                || !profile
                    .id
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
                || !ids.insert(profile.id.clone())
            {
                bail!("invalid or duplicate profile id: {}", profile.id);
            }
            if !matches!(provider, TargetName::Claude | TargetName::Codex) {
                bail!("profiles are not supported for provider {}", provider);
            }
            if profile.display_name.trim().is_empty()
                || profile.short_code.trim().is_empty()
                || !codes.insert(profile.short_code.to_lowercase())
            {
                bail!(
                    "profile {} has an empty name or duplicate/empty short code",
                    profile.id
                );
            }
            if let Some(key) = profile.tui_key {
                if !key.is_ascii_alphabetic() || !keys.insert(key) || "qHSeufdjkJKn p".contains(key)
                {
                    bail!(
                        "profile {} has a reserved or duplicate TUI key: {key}",
                        profile.id
                    );
                }
            }
            let dir = resolve_path(&profile.home_dir, home)
                .with_context(|| format!("profile {} home_dir", profile.id))?;
            let mcp_default = match provider {
                TargetName::Claude => ".claude.json",
                TargetName::Codex => "config.toml",
                _ => unreachable!(),
            };
            let mcp_config = profile
                .mcp_config
                .as_deref()
                .map(|p| resolve_path(p, home))
                .transpose()?
                .unwrap_or_else(|| dir.join(mcp_default));
            let skills_dir = profile
                .skills_dir
                .as_deref()
                .map(|p| resolve_path(p, home))
                .transpose()?
                .unwrap_or_else(|| dir.join("skills"));
            if provider != TargetName::Claude && profile.plugins_dir.is_some() {
                bail!(
                    "profile {}: plugins_dir is only supported for Claude",
                    profile.id
                );
            }
            let plugins_dir = if provider == TargetName::Claude {
                Some(
                    profile
                        .plugins_dir
                        .as_deref()
                        .map(|p| resolve_path(p, home))
                        .transpose()?
                        .unwrap_or_else(|| dir.join("plugins")),
                )
            } else {
                None
            };
            targets.push(TargetInstance {
                id: profile.id,
                provider,
                display_name: profile.display_name,
                short_code: profile.short_code,
                tui_key: profile.tui_key,
                home_dir: dir,
                mcp_config,
                skills_dir,
                plugins_dir,
                builtin: false,
            });
        }
        Ok(Self { targets })
    }

    /// Load the current configuration and native environment without writing state.
    pub fn load() -> anyhow::Result<Self> {
        let config = crate::paths::read_acm_config()?;
        let claude = crate::paths::provider_home_override(TargetName::Claude);
        let codex = crate::paths::provider_home_override(TargetName::Codex);
        Self::from_config(
            &config,
            &crate::paths::home_dir(),
            claude.as_deref(),
            codex.as_deref(),
        )
    }

    /// Resolve explicit target IDs (including aliases and `all`) or configured defaults.
    /// An absent or empty default list retains the five historical built-ins.
    pub fn select<'a>(
        &'a self,
        explicit: Option<&[String]>,
        config: &toml::Table,
    ) -> anyhow::Result<Vec<&'a TargetInstance>> {
        let defaults;
        let values = match explicit {
            Some(values) => values,
            None => {
                defaults = match config.get("default_targets") {
                    None => Vec::new(),
                    Some(value) => value
                        .as_array()
                        .context("default_targets must be an array")?
                        .iter()
                        .map(|value| {
                            value
                                .as_str()
                                .map(str::to_owned)
                                .context("default_targets must contain strings")
                        })
                        .collect::<anyhow::Result<Vec<_>>>()?,
                };
                if defaults.is_empty() {
                    return Ok(self
                        .targets
                        .iter()
                        .filter(|target| target.builtin)
                        .collect());
                }
                &defaults
            }
        };
        let mut selected = Vec::new();
        for value in values {
            if value == "all" {
                for target in &self.targets {
                    if !selected.contains(&target) {
                        selected.push(target);
                    }
                }
            } else {
                let target = self
                    .resolve(value)
                    .with_context(|| format!("Unknown target: {value}"))?;
                if !selected.contains(&target) {
                    selected.push(target);
                }
            }
        }
        if selected.is_empty() {
            bail!("Select at least one target");
        }
        validate_distinct(&selected)?;
        Ok(selected)
    }

    pub fn all(&self) -> &[TargetInstance] {
        &self.targets
    }

    pub fn resolve(&self, id: &str) -> Option<&TargetInstance> {
        let id = id.trim().to_ascii_lowercase();
        self.targets
            .iter()
            .find(|t| t.id == id || (t.builtin && t.provider.spec().aliases.contains(&id.as_str())))
    }
}

/// A process-wide immutable snapshot keeps IDs and paths stable throughout an operation.
pub fn global_registry() -> anyhow::Result<&'static TargetRegistry> {
    static REGISTRY: std::sync::OnceLock<Result<TargetRegistry, String>> =
        std::sync::OnceLock::new();
    REGISTRY
        .get_or_init(|| TargetRegistry::load().map_err(|e| format!("{e:#}")))
        .as_ref()
        .map_err(|e| anyhow::anyhow!("{e}"))
}
