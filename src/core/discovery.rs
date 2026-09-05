use crate::adapters::get_mcp_servers;
use crate::catalog::store::get_mcp;
use crate::core::mcp::catalog_recipe;
use crate::core::plugin::{
    catalog_plugin_ids, digest_plugin, parse_plugin_dir, plugin_import, plugin_metadata, MANIFESTS,
};
use crate::core::skill_source::import_skill;
use crate::paths::{
    get_agent_mcp_config_path, get_agent_skills_dir, get_catalog_dir, get_catalog_skill_dir,
    home_dir,
};
use crate::storage::{read_value, update_value};
use crate::types::TargetName;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredPlugin {
    pub name: String,
    pub version: String,
    pub description: String,
    pub source_path: PathBuf,
    pub agent: TargetName,
    pub skills: Vec<String>,
    pub mcps: usize,
    pub agents: usize,
    pub digest: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_version: Option<String>,
}

pub fn provider_plugin_roots() -> Vec<(PathBuf, TargetName)> {
    let home = home_dir();
    vec![
        (get_catalog_dir().join("plugins"), TargetName::Claude),
        (home.join(".claude/plugins"), TargetName::Claude),
        (home.join(".codex/plugins/cache"), TargetName::Codex),
        (home.join(".codex/.tmp/plugins/plugins"), TargetName::Codex),
        (
            home.join(".codex/.tmp/bundled-marketplaces"),
            TargetName::Codex,
        ),
        (home.join(".gemini/config/plugins"), TargetName::Antigravity),
        (home.join(".grok/plugins"), TargetName::Grok),
    ]
}

fn app_name(path: &Path) -> Option<String> {
    for part in path.components() {
        if let Some(name) = part
            .as_os_str()
            .to_str()
            .and_then(|s| s.strip_suffix(".app"))
        {
            return Some(name.into());
        }
    }
    let parts: Vec<_> = path.components().collect();
    parts
        .windows(2)
        .find(|pair| pair[0].as_os_str() == "Application Support")
        .map(|pair| pair[1].as_os_str().to_string_lossy().into_owned())
}

pub fn discover_plugins(
    roots: &[(PathBuf, TargetName)],
    depth: usize,
) -> anyhow::Result<Vec<DiscoveredPlugin>> {
    let mut found = BTreeMap::new();
    for (root, agent) in roots {
        if !root.is_dir() {
            continue;
        }
        let mut walker = WalkDir::new(root)
            .max_depth(depth)
            .follow_links(false)
            .into_iter();
        while let Some(entry) = walker.next() {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    eprintln!("Warning: plugin discovery: {error}");
                    continue;
                }
            };
            if !entry.path().is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy();
            if [
                "node_modules",
                ".git",
                "Frameworks",
                "MacOS",
                "Caches",
                "Cache",
                "GPUCache",
                "Code Cache",
                "logs",
                "IndexedDB",
                "Local Storage",
                "Session Storage",
                "Partitions",
                "WebStorage",
                "fonts",
                "images",
            ]
            .contains(&name.as_ref())
            {
                walker.skip_current_dir();
                continue;
            }
            let path = entry.path();
            let has_manifest = MANIFESTS.iter().any(|name| path.join(name).is_file());
            let skill_only = path.join("skills").is_dir()
                && fs::read_dir(path.join("skills"))?
                    .filter_map(Result::ok)
                    .any(|e| e.path().join("SKILL.md").is_file());
            if !has_manifest && !skill_only {
                continue;
            }
            match parse_plugin_dir(path) {
                Ok(info) => {
                    let canonical = path.canonicalize()?;
                    let digest = digest_plugin(path)?;
                    found.entry(canonical.clone()).or_insert(DiscoveredPlugin {
                        name: info.name,
                        version: info.version,
                        description: info.description,
                        source_path: canonical,
                        agent: *agent,
                        skills: info.skills,
                        mcps: info.mcp_servers.len(),
                        agents: fs::read_dir(path.join("agents"))
                            .map(|entries| {
                                entries
                                    .filter_map(Result::ok)
                                    .filter(|e| e.path().is_file())
                                    .count()
                            })
                            .unwrap_or(0),
                        digest,
                        app: app_name(path),
                        app_version: source_origin(path).1,
                    });
                    walker.skip_current_dir();
                }
                Err(error) => eprintln!("Warning: invalid plugin {}: {error}", path.display()),
            }
        }
    }
    Ok(found.into_values().collect())
}

pub fn desktop_roots() -> Vec<(PathBuf, TargetName)> {
    if let Ok(config) = crate::paths::read_acm_config() {
        if let Some(roots) = config
            .get("discovery_roots")
            .and_then(toml::Value::as_array)
        {
            return roots
                .iter()
                .filter_map(toml::Value::as_str)
                .map(|p| (crate::paths::expand_home(p), TargetName::Claude))
                .collect();
        }
    }
    let mut roots = Vec::new();
    for applications in [
        PathBuf::from("/Applications"),
        home_dir().join("Applications"),
    ] {
        if let Ok(entries) = fs::read_dir(applications) {
            for entry in entries.filter_map(Result::ok) {
                if entry.path().extension().is_some_and(|e| e == "app") {
                    let resources = entry.path().join("Contents/Resources");
                    let interesting = fs::read_dir(&resources)
                        .map(|entries| {
                            entries.filter_map(Result::ok).any(|e| {
                                let name = e.file_name().to_string_lossy().to_lowercase();
                                e.path().is_dir()
                                    && [
                                        "plugin",
                                        "skill",
                                        "agent",
                                        "prompt",
                                        "bundled",
                                        "app",
                                        "resources",
                                    ]
                                    .iter()
                                    .any(|s| name.contains(s))
                            })
                        })
                        .unwrap_or(false);
                    if interesting {
                        roots.push((resources, TargetName::Codex));
                    }
                }
            }
        }
    }
    roots.push((
        home_dir().join("Library/Application Support"),
        TargetName::Claude,
    ));
    roots
}

pub fn plugin_scan() -> anyhow::Result<Vec<DiscoveredPlugin>> {
    discover_plugins(&provider_plugin_roots(), 7)
}

pub fn snapshot(save: bool) -> anyhow::Result<Value> {
    let mut entries = serde_json::Map::new();
    for plugin in plugin_scan()? {
        let key = format!("{}:{}", plugin.agent, plugin.name);
        entries.entry(key).or_insert(json!({"name": plugin.name, "version": plugin.version, "skills": plugin.skills.len(), "mcps": plugin.mcps, "agents": plugin.agents}));
    }
    let current = json!({"scannedAt": chrono::Utc::now().to_rfc3339(), "plugins": entries});
    let path = get_catalog_dir().join("plugin-snapshot.toml");
    if save {
        update_value(&path, |value| {
            *value = current.clone();
            Ok(())
        })?;
        return Ok(current);
    }
    let previous = read_value(&path)?;
    let old = previous
        .get("plugins")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let new = current["plugins"].as_object().unwrap();
    let added: Vec<_> = new.keys().filter(|key| !old.contains_key(*key)).collect();
    let removed: Vec<_> = old.keys().filter(|key| !new.contains_key(*key)).collect();
    let changed: Vec<_> = new
        .iter()
        .filter(|(key, value)| old.get(*key).is_some_and(|old| old != *value))
        .map(|(key, value)| json!({"name": key, "before": old[key], "after": value}))
        .collect();
    Ok(json!({"added": added, "removed": removed, "changed": changed}))
}

pub fn scan_import(root: &Path, targets: &[TargetName], dry_run: bool) -> anyhow::Result<Value> {
    let mut imported = Vec::new();
    let mut scopes = vec![root.to_path_buf()];
    if root != home_dir() {
        scopes.push(home_dir());
    }
    for scope in scopes {
        for &target in targets {
            let dir = get_agent_skills_dir(&scope, target);
            if dir.is_dir() {
                for entry in fs::read_dir(&dir)? {
                    let entry = entry?;
                    let id = entry.file_name().to_string_lossy().into_owned();
                    if id.starts_with('.')
                        || !entry.path().join("SKILL.md").is_file()
                        || get_catalog_skill_dir(&id).exists()
                    {
                        continue;
                    }
                    if !dry_run {
                        import_skill(&entry.path(), Some(&id), false)?;
                    }
                    imported.push(json!({"kind": "skill", "id": id, "target": target}));
                }
            }
            for (id, server) in get_mcp_servers(target, get_agent_mcp_config_path(&scope, target))?
            {
                if get_mcp(&id)?.is_some() {
                    continue;
                }
                if let Some(recipe) = server.recipe {
                    if !dry_run {
                        catalog_recipe(&id, &recipe, None, None)?;
                    }
                    imported.push(json!({"kind": "mcp", "id": id, "target": target}));
                }
            }
        }
    }
    for plugin in plugin_scan()? {
        if !targets.contains(&plugin.agent)
            || crate::paths::get_catalog_plugin_dir(&plugin.name).exists()
        {
            continue;
        }
        if !dry_run {
            plugin_import(&plugin.source_path, None, false)?;
        }
        imported.push(json!({"kind": "plugin", "id": plugin.name, "target": plugin.agent}));
    }
    Ok(json!({"dryRun": dry_run, "imported": imported}))
}

pub fn plugin_drift() -> anyhow::Result<Value> {
    let mut drift = Vec::new();
    for id in catalog_plugin_ids()? {
        let meta = plugin_metadata(&id)?;
        if let Some(source) = meta.get("sourcePath").and_then(Value::as_str) {
            let source = crate::paths::expand_home(source);
            let digest = if source.is_dir() {
                Some(digest_plugin(&source)?)
            } else {
                None
            };
            let state = if digest.is_none() {
                "missing"
            } else if digest.as_deref() == meta.get("sourceDigest").and_then(Value::as_str) {
                "current"
            } else {
                "changed"
            };
            drift.push(json!({"name": id, "state": state, "sourcePath": source}));
        }
    }
    Ok(json!(drift))
}

pub fn source_origin(path: &Path) -> (Option<String>, Option<String>) {
    let app = app_name(path);
    let bundle = path
        .ancestors()
        .find(|p| p.extension().is_some_and(|ext| ext == "app"));
    let version = bundle.and_then(|bundle| {
        let plist = bundle.join("Contents/Info.plist");
        if let Ok(content) = fs::read_to_string(&plist) {
            let pattern = regex::Regex::new(
                r"(?s)<key>CFBundleShortVersionString</key>\s*<string>([^<]+)</string>",
            )
            .ok()?;
            if let Some(captures) = pattern.captures(&content) {
                return Some(captures[1].to_owned());
            }
        }
        let result = std::process::Command::new("plutil")
            .args(["-extract", "CFBundleShortVersionString", "raw", "-o", "-"])
            .arg(plist)
            .output()
            .ok()?;
        result
            .status
            .success()
            .then(|| String::from_utf8_lossy(&result.stdout).trim().to_owned())
    });
    (app, version)
}
