use crate::adapters::recipe_from_native;
use crate::catalog::metadata::update_skill_metadata;
use crate::core::placement::{copy_dir_recursive, create_dir_link, replace_directory};
use crate::paths::{
    expand_home, format_home_path, get_catalog_dir, get_catalog_plugin_dir,
    get_catalog_plugins_dir, get_catalog_skill_dir, is_home_scope,
};
use crate::storage::{atomic_write, object_at, read_value, update_value, validate_id, write_value};
use crate::types::{
    McpRecipe, PluginPlacementState, PluginStatus, PluginUpdateResult, PluginWorkspaceStatus,
    TargetName,
};
use anyhow::{bail, Context};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use walkdir::WalkDir;

pub const MANIFESTS: &[&str] = &[
    ".claude-plugin/plugin.json",
    ".codex-plugin/plugin.json",
    ".grok-plugin/plugin.json",
    "plugin.json",
];
pub const MARKETPLACE: &str = "acm-catalog";

#[derive(Debug, Clone)]
pub struct ParsedPluginInfo {
    pub name: String,
    pub version: String,
    pub description: String,
    pub skills: Vec<String>,
    pub mcp_servers: HashMap<String, McpRecipe>,
    pub manifest: Value,
}

pub fn validate_plugin_id(id: &str) -> anyhow::Result<()> {
    validate_id(id)?;
    if id.len() > 100 || id.starts_with('-') || id.contains("..") {
        bail!("Invalid plugin name: {id}");
    }
    Ok(())
}

pub fn metadata_path() -> PathBuf {
    get_catalog_dir().join("plugins-metadata.toml")
}
pub fn plugin_metadata(id: &str) -> anyhow::Result<Value> {
    validate_plugin_id(id)?;
    let metadata = read_value(&metadata_path())?;
    let Some(plugins) = metadata.get("plugins") else {
        return Ok(json!({}));
    };
    let plugins = plugins
        .as_object()
        .context("Plugin metadata plugins must be an object")?;
    let value = plugins.get(id).cloned().unwrap_or_else(|| json!({}));
    validate_plugin_metadata_value(&value)?;
    Ok(value)
}
fn validate_plugin_metadata_value(value: &Value) -> anyhow::Result<()> {
    value
        .as_object()
        .context("Plugin metadata entry must be an object")?;
    if let Some(installations) = value.get("nativeInstallations") {
        for installation in installations
            .as_object()
            .context("nativeInstallations must be an object")?
            .values()
        {
            let installation = installation
                .as_object()
                .context("Native installation record must be an object")?;
            for field in ["enabled", "activationPending"] {
                if installation
                    .get(field)
                    .is_some_and(|value| !value.is_boolean())
                {
                    bail!("Native installation {field} must be a boolean");
                }
            }
        }
    }
    Ok(())
}

pub(crate) fn update_metadata<T>(
    id: &str,
    update: impl FnOnce(&mut Value) -> anyhow::Result<T>,
) -> anyhow::Result<T> {
    update_value(&metadata_path(), |value| {
        let entry = object_at(value, "plugins")?
            .entry(id)
            .or_insert_with(|| json!({}));
        entry
            .as_object()
            .context("Plugin metadata entry must be an object")?;
        update(entry)
    })
}

pub fn parse_plugin_dir<P: AsRef<Path>>(dir: P) -> anyhow::Result<ParsedPluginInfo> {
    let dir = dir.as_ref();
    if !dir.is_dir() {
        bail!("Plugin directory not found: {}", dir.display());
    }
    let manifest = if let Some(file) = MANIFESTS
        .iter()
        .map(|name| dir.join(name))
        .find(|p| p.is_file())
    {
        read_value(&file)?
    } else if dir.join("skills").is_dir() {
        json!({"name": dir.file_name().context("Plugin directory name missing")?.to_string_lossy()})
    } else {
        bail!(
            "No plugin manifest or skills directory in {}",
            dir.display()
        );
    };
    let name = manifest
        .get("name")
        .and_then(Value::as_str)
        .context("Plugin manifest has no name")?
        .to_owned();
    validate_plugin_id(&name)?;
    let mut skills = Vec::new();
    if dir.join("skills").is_dir() {
        for entry in fs::read_dir(dir.join("skills"))? {
            let entry = entry?;
            if entry.path().join("SKILL.md").is_file() {
                skills.push(entry.file_name().to_string_lossy().into_owned());
            }
        }
    }
    skills.sort();
    let mut mcp_servers = HashMap::new();
    let mcp_file = [".mcp.json", "mcp_config.json"]
        .iter()
        .map(|name| dir.join(name))
        .find(|p| p.is_file());
    if let Some(file) = mcp_file {
        let config = read_value(&file)?;
        let servers = config
            .get("mcpServers")
            .unwrap_or(&config)
            .as_object()
            .context("Invalid plugin MCP config")?;
        for (name, server) in servers {
            mcp_servers.insert(name.clone(), recipe_from_native(server)?);
        }
    } else if let Some(servers) = manifest.get("mcpServers").and_then(Value::as_object) {
        for (name, server) in servers {
            mcp_servers.insert(name.clone(), recipe_from_native(server)?);
        }
    }
    Ok(ParsedPluginInfo {
        name,
        version: manifest
            .get("version")
            .and_then(Value::as_str)
            .unwrap_or("0.0.0")
            .into(),
        description: manifest
            .get("description")
            .or_else(|| {
                manifest
                    .get("interface")
                    .and_then(|v| v.get("shortDescription"))
            })
            .and_then(Value::as_str)
            .unwrap_or_default()
            .into(),
        skills,
        mcp_servers,
        manifest,
    })
}

pub fn digest_plugin(dir: &Path) -> anyhow::Result<String> {
    let mut files = Vec::new();
    for entry in WalkDir::new(dir)
        .follow_links(true)
        .into_iter()
        .filter_entry(|e| e.file_name() != ".git")
    {
        let entry = entry?;
        if entry.file_type().is_file() && entry.file_name() != ".DS_Store" {
            files.push(entry.into_path());
        }
    }
    files.sort();
    let mut hash = Sha256::new();
    for file in files {
        hash.update(file.strip_prefix(dir)?.to_string_lossy().as_bytes());
        hash.update(b"\0");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            hash.update((fs::metadata(&file)?.permissions().mode() & 0o777).to_le_bytes());
        }
        let bytes = fs::read(&file)?;
        if file.extension().is_some_and(|e| e == "json") {
            if let Ok(mut value) = serde_json::from_slice::<Value>(&bytes) {
                if let Some(object) = value.as_object_mut() {
                    for field in [
                        "installedAt",
                        "updatedAt",
                        "lastUpdated",
                        "installedFor",
                        "sourceAgent",
                    ] {
                        object.remove(field);
                    }
                }
                hash.update(serde_json::to_vec(&value)?);
            } else {
                hash.update(&bytes);
            }
        } else {
            hash.update(&bytes);
        }
        hash.update(b"\0");
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn register_source(id: &str, source: &Path, info: &ParsedPluginInfo) -> anyhow::Result<()> {
    let digest = digest_plugin(source)?;
    update_metadata(id, |entry| {
        entry["name"] = json!(id);
        entry["version"] = json!(info.version);
        entry["description"] = json!(info.description);
        entry["sourceName"] = json!(info.name);
        let (app, version) = crate::core::discovery::source_origin(source);
        if let Some(app) = app {
            entry["sourceApp"] = json!(app);
        }
        if let Some(version) = version {
            entry["sourceAppVersion"] = json!(version);
        }
        entry["sourcePath"] = json!(format_home_path(source));
        entry["sourceDigest"] = json!(digest);
        entry["skills"] = json!(info.skills);
        entry["mcps"] = json!(info.mcp_servers.keys().collect::<Vec<_>>());
        entry
            .as_object_mut()
            .unwrap()
            .entry("installedAt")
            .or_insert_with(|| json!(chrono::Utc::now().to_rfc3339()));
        entry["updatedAt"] = json!(chrono::Utc::now().to_rfc3339());
        Ok(())
    })
}

pub fn plugin_add_to_catalog<P: AsRef<Path>>(
    source: P,
    id: Option<&str>,
) -> anyhow::Result<String> {
    let source = source.as_ref().canonicalize()?;
    let info = parse_plugin_dir(&source)?;
    let id = id.unwrap_or(&info.name).to_owned();
    validate_plugin_id(&id)?;
    let destination = get_catalog_plugin_dir(&id);
    if destination.canonicalize().ok().as_ref() == Some(&source) {
        return Ok(id);
    }
    if source.starts_with(&destination) {
        bail!("Cannot link a plugin into itself");
    }
    if fs::symlink_metadata(&destination).is_ok_and(|m| !m.file_type().is_symlink()) {
        bail!("Catalog plugin {id} is a real directory; use import --force to replace it");
    }
    replace_directory(&destination, |stage| create_dir_link(&source, stage))?;
    register_source(&id, &source, &info)?;
    Ok(id)
}

pub fn plugin_import(source: &Path, id: Option<&str>, force: bool) -> anyhow::Result<String> {
    let source = source.canonicalize()?;
    let info = parse_plugin_dir(&source)?;
    let id = id.unwrap_or(&info.name).to_owned();
    validate_plugin_id(&id)?;
    let destination = get_catalog_plugin_dir(&id);
    if destination.canonicalize().ok().as_ref() == Some(&source) {
        return Ok(id);
    }
    if source.starts_with(&destination) {
        bail!("Cannot import a plugin into itself");
    }
    if fs::symlink_metadata(&destination).is_ok() && !force {
        bail!("Plugin {id} already exists; use --force to replace it");
    }
    replace_directory(&destination, |stage| copy_dir_recursive(&source, stage))?;
    register_source(&id, &source, &info)?;
    // Preserve the catalog's standalone skill index without duplicating payloads.
    for skill in &info.skills {
        validate_id(skill)?;
        let entry = get_catalog_skill_dir(skill);
        if fs::symlink_metadata(&entry).is_err() {
            replace_directory(&entry, |stage| {
                create_dir_link(&destination.join("skills").join(skill), stage)
            })?;
            update_skill_metadata(skill, |meta| {
                meta["plugin"] = json!(id);
                meta["sourceType"] = json!("plugin");
                Ok(())
            })?;
        }
    }
    Ok(id)
}

pub fn catalog_plugin_ids() -> anyhow::Result<Vec<String>> {
    let mut ids = BTreeSet::new();
    if let Some(plugins) = read_value(&metadata_path())?
        .get("plugins")
        .and_then(Value::as_object)
    {
        ids.extend(plugins.keys().cloned());
    }
    let dir = get_catalog_plugins_dir();
    if dir.is_dir() {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.starts_with('.') && (entry.path().is_dir() || entry.file_type()?.is_symlink())
            {
                ids.insert(name);
            }
        }
    }
    Ok(ids.into_iter().collect())
}

pub fn assemble_plugin(id: &str, destination: &Path) -> anyhow::Result<Value> {
    validate_plugin_id(id)?;
    let source = get_catalog_plugin_dir(id);
    let metadata = plugin_metadata(id)?;
    let info = parse_plugin_dir(&source)?;
    let mut manifest = info.manifest;
    manifest["name"] = json!(id);
    for field in ["installedAt", "installedFor", "sourceAgent"] {
        manifest.as_object_mut().unwrap().remove(field);
    }
    let mut carried = Vec::new();
    for field in ["apps", "interface", "hooks", "agents", "commands"] {
        if manifest.get(field).is_some() {
            carried.push(field);
        }
    }
    replace_directory(destination, |stage| {
        copy_dir_recursive(&source, stage)?;
        if let Some(skills) = metadata.get("skills").and_then(Value::as_array) {
            for skill in skills {
                let id = skill
                    .as_str()
                    .context("Invalid skill name in plugin metadata")?;
                validate_id(id)?;
                let dest = stage.join("skills").join(id);
                if !dest.join("SKILL.md").is_file() {
                    let skill = get_catalog_skill_dir(id);
                    if !skill.join("SKILL.md").is_file() {
                        bail!("Plugin {id} is missing a skill payload; run plugin repair");
                    }
                    copy_dir_recursive(&skill, &dest)?;
                }
            }
        }
        for file in MANIFESTS {
            write_value(&stage.join(file), &manifest)?;
        }
        let mcp = if stage.join(".mcp.json").exists() {
            Some(read_value(&stage.join(".mcp.json"))?)
        } else if stage.join("mcp_config.json").exists() {
            Some(read_value(&stage.join("mcp_config.json"))?)
        } else {
            manifest
                .get("mcpServers")
                .filter(|v| v.is_object())
                .map(|v| json!({"mcpServers": v}))
        };
        if let Some(mcp) = mcp {
            write_value(&stage.join(".mcp.json"), &mcp)?;
            write_value(&stage.join("mcp_config.json"), &mcp)?;
        }
        Ok(())
    })?;
    Ok(json!({"name": id, "path": destination, "carriedFields": carried}))
}

pub fn build_marketplace(ids: &[String]) -> anyhow::Result<PathBuf> {
    let destination = get_catalog_dir().join("marketplace");
    let _lock = crate::storage::FileLock::acquire(&get_catalog_dir().join("marketplace.lock"))?;
    let mut requested: BTreeSet<String> = ids.iter().cloned().collect();
    let plugins_dir = destination.join("plugins");
    if plugins_dir.is_dir() {
        for entry in fs::read_dir(&plugins_dir)? {
            let entry = entry?;
            let id = entry.file_name().to_string_lossy().into_owned();
            if entry.path().is_dir() && get_catalog_plugin_dir(&id).is_dir() {
                requested.insert(id);
            }
        }
    }
    let mut listed = Vec::new();
    for id in requested {
        assemble_plugin(&id, &plugins_dir.join(&id))?;
        let info = parse_plugin_dir(plugins_dir.join(&id))?;
        listed.push(json!({"name": id, "version": info.version, "description": info.description, "source": format!("./plugins/{id}")}));
    }
    let claude = json!({"name": MARKETPLACE, "owner": {"name": "acm"}, "plugins": listed});
    write_value(
        &destination.join(".claude-plugin/marketplace.json"),
        &claude,
    )?;
    write_value(&destination.join(".grok-plugin/marketplace.json"), &claude)?;
    let codex_plugins: Vec<_> = listed.into_iter().map(|mut entry| {
        entry["source"] = json!({"source": "local", "path": format!("./plugins/{}", entry["name"].as_str().unwrap())});
        entry["policy"] = json!({"installation": "AVAILABLE"}); entry
    }).collect();
    write_value(
        &destination.join(".agents/plugins/marketplace.json"),
        &json!({"name": MARKETPLACE, "interface": {"displayName": "acm catalog"}, "plugins": codex_plugins}),
    )?;
    Ok(destination)
}

pub fn provider_command(
    target: TargetName,
    root: &Path,
    args: &[String],
) -> anyhow::Result<String> {
    super::plugin_verification::bounded_provider_command(target, root, args)
}

fn validate_scope(root: &Path, targets: &[TargetName]) -> anyhow::Result<()> {
    if !is_home_scope(root) && targets.iter().any(|t| *t != TargetName::Claude) {
        bail!("Native plugins for Codex, Antigravity and Grok use home scope; use --home, or distribute individual skills/MCPs to a project");
    }
    Ok(())
}

pub(crate) fn installation_key(root: &Path, target: TargetName) -> String {
    if target != TargetName::Claude || is_home_scope(root) {
        format!("{target}:home")
    } else {
        format!("{target}:{}", root.display())
    }
}

pub(crate) fn native_operation_lock(id: &str) -> anyhow::Result<crate::storage::FileLock> {
    validate_plugin_id(id)?;
    crate::storage::FileLock::acquire(&crate::storage::resource_lock_path(
        &get_catalog_plugins_dir().join(format!("{id}.native-operation")),
    ))
}

pub fn register_marketplace(
    root: &Path,
    targets: &[TargetName],
    marketplace: &Path,
) -> anyhow::Result<()> {
    for &target in targets {
        if matches!(
            target,
            TargetName::Claude | TargetName::Codex | TargetName::Grok
        ) {
            let args = vec![
                "plugin".into(),
                "marketplace".into(),
                "add".into(),
                marketplace.display().to_string(),
            ];
            if let Err(error) = provider_command(target, root, &args) {
                let message = error.to_string().to_lowercase();
                if ![
                    "already configured",
                    "already added",
                    "already exists",
                    "already registered",
                    "duplicate marketplace",
                ]
                .iter()
                .any(|text| message.contains(text))
                {
                    return Err(error);
                }
                if !super::plugin_verification::marketplace_source_matches(
                    root,
                    target,
                    marketplace,
                )? {
                    bail!("Existing {target} marketplace refers to a different or unverified source; explicitly remove or reconfigure that marketplace before retrying. No plugin was installed from the old source");
                }
            }
        }
    }
    Ok(())
}

pub fn plugin_install(
    root: &Path,
    id: &str,
    targets: &[TargetName],
) -> anyhow::Result<PluginStatus> {
    let _lock = native_operation_lock(id)?;
    plugin_install_unlocked(root, id, targets)
}

fn plugin_install_unlocked(
    root: &Path,
    id: &str,
    targets: &[TargetName],
) -> anyhow::Result<PluginStatus> {
    validate_scope(root, targets)?;
    let marketplace = build_marketplace(&[id.to_owned()])?;
    let digest = digest_plugin(&get_catalog_plugin_dir(id))?;
    let mut report = super::operations::OperationReport::new("plugin.install", id);
    for &target in targets {
        let result = (|| {
            register_marketplace(root, &[target], &marketplace)?;
            let selector = format!("{id}@{MARKETPLACE}");
            let args = match target {
                TargetName::Claude => vec![
                    "plugin".into(),
                    "install".into(),
                    selector,
                    "--scope".into(),
                    if is_home_scope(root) {
                        "user"
                    } else {
                        "project"
                    }
                    .into(),
                ],
                TargetName::Codex => vec!["plugin".into(), "add".into(), selector],
                TargetName::Antigravity => vec![
                    "plugin".into(),
                    "install".into(),
                    marketplace.join("plugins").join(id).display().to_string(),
                ],
                TargetName::Grok => vec![
                    "plugin".into(),
                    "install".into(),
                    marketplace.join("plugins").join(id).display().to_string(),
                    "--trust".into(),
                ],
            };
            if let Err(error) = provider_command(target, root, &args) {
                if target == TargetName::Grok && error.to_string().contains("already installed") {
                    let observed =
                        super::plugin_verification::observe_provider_plugin(root, id, target)?;
                    if observed["installed"] != true {
                        bail!("Grok reports an existing plugin, but its source could not be matched to this ACM deployment; existing installation was retained");
                    }
                    provider_command(target, root, &["plugin".into(), "update".into(), id.into()])?;
                } else {
                    return Err(error);
                }
            }
            update_metadata(id, |entry| {
                let installation = object_at(entry, "nativeInstallations")?
                    .entry(installation_key(root, target))
                    .or_insert_with(|| json!({}));
                let installation = installation
                    .as_object_mut()
                    .context("Invalid native installation record")?;
                installation.insert("target".into(), json!(target));
                installation.insert("root".into(), json!(format_home_path(root)));
                installation
                    .entry("installedAt")
                    .or_insert_with(|| json!(chrono::Utc::now().to_rfc3339()));
                installation.insert("activationPending".into(), json!(true));
                for field in [
                    "deployedDigest",
                    "enabled",
                    "verifiedAt",
                    "verificationState",
                    "verifiedEnabledKnown",
                ] {
                    installation.remove(field);
                }
                Ok(())
            })
            .context("Provider installed the plugin but ACM could not record the installation")?;
            if matches!(target, TargetName::Antigravity | TargetName::Grok) {
                let args = vec!["plugin".into(), "enable".into(), id.into()];
                provider_command(target, root, &args).context(
                    "Plugin was installed, but native activation failed; retry installation",
                )?;
            }
            update_metadata(id, |entry| {
                let installation = object_at(entry, "nativeInstallations")?
                    .get_mut(&installation_key(root, target))
                    .context("Installation record disappeared during activation")?;
                installation["deployedDigest"] = json!(digest);
                installation["enabled"] = json!(true);
                installation
                    .as_object_mut()
                    .context("Invalid installation record")?
                    .remove("activationPending");
                Ok(())
            })?;
            Ok(json!({"id":id,"installed":true}))
        })();
        report.push(target, result);
    }
    report.finish()?;
    get_plugin_status(root, id, targets)
}

pub fn plugin_remove(root: &Path, id: &str, targets: &[TargetName]) -> anyhow::Result<()> {
    validate_plugin_id(id)?;
    validate_scope(root, targets)?;
    let _lock = native_operation_lock(id)?;
    let metadata = plugin_metadata(id)?;
    let mut report = super::operations::OperationReport::new("plugin.remove", id);
    for &target in targets {
        let result = (|| {
            let key = installation_key(root, target);
            let recorded = metadata
                .get("nativeInstallations")
                .and_then(|v| v.get(&key))
                .is_some();
            let legacy = is_home_scope(root)
                && metadata
                    .get("installedFor")
                    .and_then(Value::as_array)
                    .is_some_and(|values| values.contains(&json!(target)));
            if !recorded && !legacy {
                return Ok(json!({"id":id,"installed":false,"skipped":true}));
            }
            let args = match target {
                TargetName::Claude => vec![
                    "plugin".into(),
                    "uninstall".into(),
                    format!("{id}@{MARKETPLACE}"),
                    "--scope".into(),
                    if is_home_scope(root) {
                        "user"
                    } else {
                        "project"
                    }
                    .into(),
                ],
                TargetName::Codex => vec![
                    "plugin".into(),
                    "remove".into(),
                    format!("{id}@{MARKETPLACE}"),
                ],
                TargetName::Grok => vec![
                    "plugin".into(),
                    "uninstall".into(),
                    id.into(),
                    "--confirm".into(),
                ],
                _ => vec!["plugin".into(), "uninstall".into(), id.into()],
            };
            provider_command(target, root, &args)?;
            update_metadata(id, |entry| {
                object_at(entry, "nativeInstallations")?.remove(&key);
                if is_home_scope(root) {
                    if let Some(values) =
                        entry.get_mut("installedFor").and_then(Value::as_array_mut)
                    {
                        values.retain(|v| v != &json!(target));
                    }
                }
                Ok(())
            })
            .context(
                "Provider removed the plugin but ACM could not update its installation record",
            )?;
            Ok(json!({"id":id,"installed":false}))
        })();
        report.push(target, result);
    }
    report.finish()?;
    Ok(())
}

pub fn plugin_unlink_from_catalog(id: &str) -> anyhow::Result<()> {
    let _lock = native_operation_lock(id)?;
    let metadata = plugin_metadata(id)?;
    if metadata
        .get("nativeInstallations")
        .and_then(Value::as_object)
        .is_some_and(|v| !v.is_empty())
        || metadata
            .get("installedFor")
            .and_then(Value::as_array)
            .is_some_and(|v| !v.is_empty())
    {
        bail!("Uninstall {id} from its providers before unlinking it");
    }
    let dir = get_catalog_plugin_dir(id);
    if !fs::symlink_metadata(&dir)?.file_type().is_symlink() {
        bail!("Catalog plugin {id} is a real directory; unlink only removes links");
    }
    fs::remove_file(dir)?;
    update_value(&metadata_path(), |value| {
        object_at(value, "plugins")?.remove(id);
        Ok(())
    })
}

pub fn get_plugin_status(
    root: &Path,
    id: &str,
    targets: &[TargetName],
) -> anyhow::Result<PluginStatus> {
    let metadata = plugin_metadata(id)?;
    plugin_status(root, id, targets, &metadata)
}

fn plugin_status(
    root: &Path,
    id: &str,
    targets: &[TargetName],
    metadata: &Value,
) -> anyhow::Result<PluginStatus> {
    validate_plugin_id(id)?;
    validate_plugin_metadata_value(metadata)?;
    let dir = get_catalog_plugin_dir(id);
    let info = if dir.is_dir() {
        Some(parse_plugin_dir(&dir)?)
    } else {
        None
    };
    let mut placement = HashMap::new();
    let mut installed = Vec::new();
    let mut enabled = false;
    for &target in targets {
        let key = installation_key(root, target);
        let native = metadata
            .get("nativeInstallations")
            .and_then(|v| v.get(&key))
            .is_some();
        let legacy = is_home_scope(root)
            && metadata
                .get("installedFor")
                .and_then(Value::as_array)
                .is_some_and(|a| a.contains(&json!(target)));
        let state = if info.is_none() {
            PluginPlacementState::Broken
        } else if native || legacy {
            installed.push(target);
            if metadata
                .get("nativeInstallations")
                .and_then(|v| v.get(&key))
                .and_then(|v| v.get("enabled"))
                .and_then(Value::as_bool)
                == Some(false)
            {
                PluginPlacementState::Disabled
            } else {
                let installation = metadata
                    .get("nativeInstallations")
                    .and_then(|v| v.get(&key));
                let recorded_enabled = installation
                    .and_then(|v| v.get("enabled"))
                    .and_then(Value::as_bool)
                    .unwrap_or_else(|| installation.is_none_or(|v| v.get("verifiedAt").is_none()));
                enabled |= recorded_enabled
                    && installation
                        .and_then(|v| v.get("activationPending"))
                        .and_then(Value::as_bool)
                        != Some(true);
                PluginPlacementState::NativeLinked
            }
        } else {
            PluginPlacementState::Missing
        };
        placement.insert(target, state);
    }
    let mut skills = info.as_ref().map(|i| i.skills.clone()).unwrap_or_default();
    if let Some(legacy) = metadata.get("skills").and_then(Value::as_array) {
        for id in legacy.iter().filter_map(Value::as_str) {
            if !skills.iter().any(|s| s == id) {
                skills.push(id.to_owned());
            }
        }
    }
    Ok(PluginStatus {
        id: id.into(),
        name: info
            .as_ref()
            .map(|i| i.name.clone())
            .unwrap_or_else(|| id.into()),
        description: info
            .as_ref()
            .map(|i| i.description.clone())
            .unwrap_or_default(),
        version: info.as_ref().map(|i| i.version.clone()).unwrap_or_default(),
        enabled,
        targets: installed,
        placement,
        skills,
        mcp_servers: info
            .as_ref()
            .map(|i| i.mcp_servers.keys().cloned().collect())
            .unwrap_or_default(),
        source_path: metadata
            .get("sourcePath")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or_else(|| format_home_path(&dir)),
    })
}

pub fn get_plugin_workspace_status(
    root: &Path,
    targets: &[TargetName],
) -> anyhow::Result<PluginWorkspaceStatus> {
    let metadata = read_value(&metadata_path())?;
    let plugins: Vec<_> = catalog_plugin_ids()?
        .iter()
        .map(|id| {
            plugin_status(
                root,
                id,
                targets,
                metadata
                    .get("plugins")
                    .and_then(|v| v.get(id))
                    .unwrap_or(&json!({})),
            )
        })
        .collect::<anyhow::Result<_>>()?;
    Ok(PluginWorkspaceStatus {
        project_root: root.display().to_string(),
        total_count: plugins.len(),
        enabled_count: plugins.iter().filter(|p| p.enabled).count(),
        plugins,
    })
}

pub fn resolve_plugin_source(id: &str) -> anyhow::Result<PathBuf> {
    let metadata = plugin_metadata(id)?;
    let recorded = match metadata.get("sourcePath") {
        None | Some(Value::Null) => None,
        Some(Value::String(path)) if !path.is_empty() => Some(expand_home(path)),
        Some(_) => bail!("Invalid sourcePath provenance for plugin {id}"),
    };
    let app = match metadata.get("sourceApp") {
        None | Some(Value::Null) => None,
        Some(Value::String(name)) if !name.is_empty() => Some(name.as_str()),
        Some(_) => bail!("Invalid sourceApp provenance for plugin {id}"),
    };
    let catalog = get_catalog_plugin_dir(id);
    // A shared manifest name is not evidence that two local sources have the same owner.
    // Only a recorded application origin permits relocation discovery. Catalog-only entries
    // continue to use their own payload; missing local origins require explicit re-import.
    if app.is_none() {
        return match recorded {
            Some(source) if source.is_dir() => Ok(source),
            Some(_) => bail!("Plugin source missing for {id}; use plugin import <new path> --as {id} --force to explicitly select its replacement"),
            None => catalog.canonicalize().with_context(|| format!("Plugin source missing for {id}; import its source before updating")),
        };
    }
    let original_name = metadata
        .get("sourceName")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .or_else(|| parse_plugin_dir(&catalog).ok().map(|p| p.name))
        .unwrap_or_else(|| id.into());
    let mut roots = crate::core::discovery::provider_plugin_roots();
    roots.extend(crate::core::discovery::desktop_roots());
    if let Some(source) = &recorded {
        if let Some(parent) = source.ancestors().skip(1).take(3).find(|p| p.is_dir()) {
            roots.push((parent.to_path_buf(), TargetName::Claude));
        }
    }
    let catalog_root = get_catalog_dir()
        .canonicalize()
        .unwrap_or_else(|_| get_catalog_dir());
    let mut candidates: Vec<_> = crate::core::discovery::discover_plugins(&roots, 8)?
        .into_iter()
        .filter(|p| {
            p.name == original_name
                && !p.source_path.starts_with(&catalog_root)
                && app.is_none_or(|app| p.app.as_deref() == Some(app))
        })
        .collect();
    candidates.sort_by_key(|p| {
        numeric_version(p.app_version.as_deref().unwrap_or(&p.version)).unwrap_or_default()
    });
    if let Some(candidate) = candidates.pop() {
        return Ok(candidate.source_path);
    }
    recorded.filter(|p| p.is_dir()).or_else(|| if metadata.get("sourcePath").is_none() { catalog.canonicalize().ok() } else { None })
        .with_context(|| format!("Plugin source missing for {id}; use plugin discover or plugin import <new path> --as {id} --force"))
}

fn numeric_version(version: &str) -> Option<Vec<u64>> {
    version.split('.').map(|v| v.parse().ok()).collect()
}
fn older(candidate: &str, recorded: &str) -> bool {
    let (Some(mut candidate), Some(mut recorded)) =
        (numeric_version(candidate), numeric_version(recorded))
    else {
        return false;
    };
    let len = candidate.len().max(recorded.len());
    candidate.resize(len, 0);
    recorded.resize(len, 0);
    candidate < recorded
}

pub fn plugin_update(
    root: &Path,
    id: &str,
    targets: &[TargetName],
) -> anyhow::Result<PluginUpdateResult> {
    plugin_update_options(root, id, targets, false, false)
}

pub fn plugin_update_options(
    root: &Path,
    id: &str,
    targets: &[TargetName],
    force: bool,
    dry_run: bool,
) -> anyhow::Result<PluginUpdateResult> {
    validate_plugin_id(id)?;
    validate_scope(root, targets)?;
    // A dry-run must not create machine-state lock files.
    let _lock = if dry_run {
        None
    } else {
        Some(native_operation_lock(id)?)
    };
    let status = get_plugin_status(root, id, targets)?;
    let metadata = plugin_metadata(id)?;
    let catalog = get_catalog_plugin_dir(id);
    let source = resolve_plugin_source(id)?;
    if !dry_run {
        if let Some(git_root) = source.ancestors().find(|p| p.join(".git").exists()) {
            let output = Command::new("git")
                .arg("-C")
                .arg(git_root)
                .args(["pull", "--ff-only"])
                .output()?;
            if !output.status.success() {
                bail!(
                    "Plugin update failed: {}",
                    super::operations::redact_text(String::from_utf8_lossy(&output.stderr).trim())
                );
            }
        }
    }
    // Validate after pulling: an upstream checkout can change the candidate version.
    let (_, app_version) = crate::core::discovery::source_origin(&source);
    let info = parse_plugin_dir(&source)?;
    let candidate = app_version.as_deref().unwrap_or(&info.version);
    let recorded = metadata
        .get("sourceAppVersion")
        .or_else(|| metadata.get("version"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !force && older(candidate, recorded) {
        bail!("Source version {candidate} is older than recorded {recorded}; use --force to allow a downgrade");
    }
    let digest = digest_plugin(&source)?;
    let source_updated = metadata.get("sourceDigest").and_then(Value::as_str) != Some(&digest)
        || metadata.get("sourcePath").and_then(Value::as_str)
            != Some(format_home_path(&source).as_str())
        || app_version.as_deref().is_some_and(|version| {
            metadata.get("sourceAppVersion").and_then(Value::as_str) != Some(version)
        });
    if source_updated && !dry_run {
        if !fs::symlink_metadata(&catalog).is_ok_and(|m| m.file_type().is_symlink())
            && catalog.canonicalize().ok().as_ref() != Some(&source)
        {
            plugin_import(&source, Some(id), true)?;
        } else {
            register_source(id, &source, &info)?;
        }
    }
    let deployment_digest = if dry_run && source_updated {
        digest
    } else {
        digest_plugin(&catalog)?
    };
    let pending: Vec<_> = status
        .targets
        .into_iter()
        .filter(|&target| {
            let installation = metadata
                .get("nativeInstallations")
                .and_then(|v| v.get(installation_key(root, target)));
            // Unknown observations are not new activation requests. Preserve disabled state,
            // while permitting a retry of a previously requested but incomplete activation.
            let active = installation
                .and_then(|v| v.get("enabled"))
                .and_then(Value::as_bool)
                .unwrap_or_else(|| installation.is_none_or(|v| v.get("verifiedAt").is_none()));
            let activation_pending = installation
                .and_then(|v| v.get("activationPending"))
                .and_then(Value::as_bool)
                == Some(true);
            (active || activation_pending)
                && installation
                    .and_then(|v| v.get("deployedDigest"))
                    .and_then(Value::as_str)
                    != Some(deployment_digest.as_str())
        })
        .collect();
    if !dry_run && !pending.is_empty() {
        plugin_install_unlocked(root, id, &pending)?;
    }
    let changed = source_updated || !pending.is_empty();
    Ok(PluginUpdateResult {
        id: id.into(),
        updated: changed && !dry_run,
        message: if dry_run && changed {
            "Would update source or retry pending native deployments"
        } else if changed {
            "Updated source and pending native deployments"
        } else {
            "Up to date"
        }
        .into(),
        reprojected_targets: if dry_run { Vec::new() } else { pending },
    })
}

pub fn plugin_update_all(
    root: &Path,
    targets: &[TargetName],
) -> anyhow::Result<Vec<PluginUpdateResult>> {
    catalog_plugin_ids()?
        .iter()
        .map(|id| plugin_update(root, id, targets))
        .collect()
}

pub fn plugin_repair(apply: bool) -> anyhow::Result<Value> {
    let mut reports = Vec::new();
    for id in catalog_plugin_ids()? {
        let metadata = plugin_metadata(&id)?;
        let Some(source) = metadata
            .get("sourcePath")
            .and_then(Value::as_str)
            .map(expand_home)
            .filter(|p| p.is_dir())
        else {
            continue;
        };
        let mut pairs = vec![(source.clone(), get_catalog_plugin_dir(&id))];
        if let Some(skills) = metadata.get("skills").and_then(Value::as_array) {
            for skill in skills.iter().filter_map(Value::as_str) {
                validate_id(skill)?;
                pairs.push((
                    source.join("skills").join(skill),
                    get_catalog_skill_dir(skill),
                ));
            }
        }
        for (source, destination) in pairs {
            if !source.is_dir()
                || fs::symlink_metadata(&destination).is_ok_and(|m| m.file_type().is_symlink())
            {
                continue;
            }
            for entry in WalkDir::new(&source)
                .follow_links(true)
                .into_iter()
                .filter_entry(|e| e.file_name() != ".git")
            {
                let entry = entry?;
                if !entry.file_type().is_file() {
                    continue;
                }
                let relative = entry.path().strip_prefix(&source)?;
                let to = destination.join(relative);
                if fs::symlink_metadata(&to).is_ok() {
                    continue;
                }
                if apply {
                    atomic_write(&to, &fs::read(entry.path())?)?;
                }
                reports.push(json!({"plugin": id, "path": to, "applied": apply}));
            }
        }
    }
    Ok(json!(reports))
}

pub fn plugin_remove_from_catalog(id: &str) -> anyhow::Result<()> {
    let _lock = native_operation_lock(id)?;
    let metadata = plugin_metadata(id)?;
    if metadata
        .get("nativeInstallations")
        .and_then(Value::as_object)
        .is_some_and(|v| !v.is_empty())
        || metadata
            .get("installedFor")
            .and_then(Value::as_array)
            .is_some_and(|v| !v.is_empty())
    {
        bail!("Uninstall {id} from its providers before removing it from the catalog");
    }
    let directory = get_catalog_plugin_dir(id);
    if fs::symlink_metadata(&directory).is_err() {
        bail!("Catalog plugin {id} not found");
    }
    if let Some(skills) = metadata.get("skills").and_then(Value::as_array) {
        for skill in skills.iter().filter_map(Value::as_str) {
            validate_id(skill)?;
            let path = get_catalog_skill_dir(skill);
            let skill_metadata =
                crate::core::skill_source::skill_metadata(skill).unwrap_or_else(|_| json!({}));
            if skill_metadata["plugin"] == id
                && fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink())
            {
                fs::remove_file(&path)?;
                update_value(&crate::paths::get_skills_metadata_path(), |value| {
                    object_at(value, "skills")?.remove(skill);
                    Ok(())
                })?;
            }
        }
    }
    crate::core::placement::remove_path(&directory)?;
    update_value(&metadata_path(), |value| {
        object_at(value, "plugins")?.remove(id);
        Ok(())
    })
}
