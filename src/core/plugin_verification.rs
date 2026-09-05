//! Explicit, bounded observation of native plugin state. Observations never activate plugins.
use super::operations::{redact_text, OperationFailure};
use super::plugin::{
    catalog_plugin_ids, installation_key, native_operation_lock, parse_plugin_dir, plugin_metadata,
    update_metadata, validate_plugin_id, MARKETPLACE,
};
use crate::paths::{
    expand_home, format_home_path, get_catalog_dir, get_catalog_plugin_dir, is_home_scope,
    read_acm_config,
};
use crate::storage::object_at;
use crate::types::TargetName;
use anyhow::{bail, Context};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

pub fn provider_executable(target: TargetName) -> anyhow::Result<PathBuf> {
    let variable = format!("ACM_{}_BIN", target.as_str().to_uppercase());
    if let Some(path) = std::env::var_os(&variable) {
        if path.is_empty() {
            bail!("{variable} must name an executable");
        }
        return Ok(expand_home(&path.to_string_lossy()));
    }
    let config = read_acm_config()?;
    if let Some(commands) = config.get("provider_commands") {
        let commands = commands
            .as_table()
            .context("provider_commands must be a table")?;
        if let Some(path) = commands.get(target.as_str()) {
            let path = path
                .as_str()
                .filter(|p| !p.is_empty())
                .context("provider_commands values must be nonempty executable paths")?;
            return Ok(expand_home(path));
        }
    }
    Ok(PathBuf::from(if target == TargetName::Antigravity {
        "agy"
    } else {
        target.as_str()
    }))
}

fn terminate(child: &mut Child) {
    #[cfg(unix)]
    unsafe {
        // Every provider gets a fresh group, so timeout also stops installer descendants.
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn capture(
    mut reader: impl Read + Send + 'static,
    cap: usize,
    sender: mpsc::Sender<anyhow::Result<Vec<u8>>>,
) {
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = reader
            .by_ref()
            .take(cap as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(anyhow::Error::from)
            .and_then(|_| {
                if bytes.len() > cap {
                    bail!("Provider output exceeded the {} byte limit", cap);
                }
                Ok(bytes)
            });
        let _ = sender.send(result);
    });
}

/// No shell interpretation, stdin interaction, unlimited output, or implicit executable fallback.
pub fn bounded_provider_command(
    target: TargetName,
    root: &Path,
    args: &[String],
) -> anyhow::Result<String> {
    let executable = provider_executable(target)?;
    let default_timeout = if args
        .iter()
        .map(String::as_str)
        .eq(["plugin", "list", "--json"])
        || args
            .iter()
            .map(String::as_str)
            .eq(["plugin", "marketplace", "list", "--json"])
    {
        10_000
    } else {
        120_000
    };
    let timeout_ms = match std::env::var("ACM_PROVIDER_TIMEOUT_MS") {
        Ok(value) => value
            .parse::<u64>()
            .ok()
            .filter(|n| (10..=120_000).contains(n))
            .context("ACM_PROVIDER_TIMEOUT_MS must be between 10 and 120000")?,
        Err(std::env::VarError::NotPresent) => default_timeout,
        Err(error) => return Err(error.into()),
    };
    let mut command = Command::new(&executable);
    command
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command.spawn().with_context(|| format!("Cannot execute {target}; install its CLI or configure provider_commands.{target} / ACM_{}_BIN", target.as_str().to_uppercase()))?;
    let (stdout_tx, stdout_rx) = mpsc::channel();
    let (stderr_tx, stderr_rx) = mpsc::channel();
    capture(child.stdout.take().unwrap(), 1_048_576, stdout_tx);
    capture(child.stderr.take().unwrap(), 262_144, stderr_tx);
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    let mut stdout = None;
    let mut stderr = None;
    let mut status = None;
    loop {
        if stdout.is_none() {
            if let Ok(value) = stdout_rx.try_recv() {
                stdout = Some(value);
            }
        }
        if stderr.is_none() {
            if let Ok(value) = stderr_rx.try_recv() {
                stderr = Some(value);
            }
        }
        if stdout.as_ref().is_some_and(Result::is_err)
            || stderr.as_ref().is_some_and(Result::is_err)
        {
            let message = stdout
                .as_ref()
                .and_then(|r| r.as_ref().err())
                .or_else(|| stderr.as_ref().and_then(|r| r.as_ref().err()))
                .unwrap()
                .to_string();
            terminate(&mut child);
            bail!("{message}");
        }
        if status.is_none() {
            match child.try_wait() {
                Ok(value) => status = value,
                Err(error) => {
                    terminate(&mut child);
                    return Err(error.into());
                }
            }
        }
        if status.is_some() && stdout.is_some() && stderr.is_some() {
            break;
        }
        if Instant::now() >= deadline {
            terminate(&mut child);
            bail!("{target} command timed out after {timeout_ms} ms");
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let stdout = stdout.unwrap()?;
    let stderr = stderr.unwrap()?;
    if !status.unwrap().success() {
        // Output can contain provider credentials; never expose it unredacted.
        bail!(
            "{target} command failed: {}",
            redact_text(&format!(
                "{} {}",
                String::from_utf8_lossy(&stderr),
                String::from_utf8_lossy(&stdout)
            ))
            .trim()
        );
    }
    Ok(String::from_utf8(stdout)
        .context("Provider returned non-UTF-8 output")?
        .trim()
        .to_owned())
}

#[derive(Clone)]
struct Listing {
    entries: Vec<Value>,
}

fn parse_listing(target: TargetName, raw: &str) -> anyhow::Result<Listing> {
    if target == TargetName::Antigravity && raw.trim() == "No imported plugins." {
        return Ok(Listing {
            entries: Vec::new(),
        });
    }
    let value: Value = serde_json::from_str(raw)
        .context("Provider returned an unsupported plugin list representation")?;
    let entries = match target {
        TargetName::Claude | TargetName::Grok => value.as_array(),
        TargetName::Codex => value.get("installed").and_then(Value::as_array),
        TargetName::Antigravity => value.get("imports").and_then(Value::as_array),
    }
    .context("Provider plugin list has an unsupported schema")?;
    for entry in entries {
        let name_key = match target {
            TargetName::Claude => "id",
            TargetName::Codex => "pluginId",
            _ => "name",
        };
        if entry
            .get(name_key)
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .is_none()
        {
            bail!("Provider plugin list contains an entry without a valid identity");
        }
        match target {
            TargetName::Claude => {
                if !matches!(
                    entry.get("scope").and_then(Value::as_str),
                    Some("user" | "project" | "local" | "managed")
                ) {
                    bail!("Claude plugin list contains an unknown scope");
                }
                if matches!(entry["scope"].as_str(), Some("project" | "local"))
                    && entry.get("projectPath").and_then(Value::as_str).is_none()
                {
                    bail!("Claude project installation has no projectPath");
                }
            }
            TargetName::Codex => {
                if entry
                    .get("marketplaceName")
                    .and_then(Value::as_str)
                    .is_none()
                    || entry.get("installed").and_then(Value::as_bool) != Some(true)
                {
                    bail!("Codex installed entry does not confirm marketplace and installation");
                }
            }
            TargetName::Grok => {
                if entry.get("status").and_then(Value::as_str) != Some("installed") {
                    bail!("Grok plugin list contains an unknown installation status");
                }
            }
            TargetName::Antigravity => {}
        }
        if entry
            .get("enabled")
            .is_some_and(|v| !v.is_boolean() && !v.is_null())
        {
            bail!("Provider enabled state has an unsupported type");
        }
    }
    Ok(Listing {
        entries: entries.clone(),
    })
}

fn same_path(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => left.is_absolute() && right.is_absolute() && left == right,
    }
}

fn observe(root: &Path, id: &str, target: TargetName, listing: &Listing) -> Value {
    let selector = format!("{id}@{MARKETPLACE}");
    let expected_source = get_catalog_dir().join("marketplace/plugins").join(id);
    let mut matches = Vec::new();
    let mut ambiguous = false;
    for entry in &listing.entries {
        let matches_identity = match target {
            TargetName::Claude => {
                if entry["id"] != selector {
                    continue;
                }
                let expected_scope = if is_home_scope(root) {
                    "user"
                } else {
                    "project"
                };
                if entry["scope"] != expected_scope {
                    continue;
                }
                if expected_scope == "project"
                    && !same_path(&expand_home(entry["projectPath"].as_str().unwrap()), root)
                {
                    continue;
                }
                true
            }
            TargetName::Codex => {
                if entry["pluginId"] != selector {
                    continue;
                }
                if entry["marketplaceName"] != MARKETPLACE
                    || entry.get("name").is_some_and(|name| name != id)
                {
                    ambiguous = true;
                    continue;
                }
                true
            }
            TargetName::Grok => {
                if entry["name"] != id {
                    continue;
                }
                // ACM installs Grok plugins by local source, not marketplace selector.
                let source = entry.get("source").and_then(Value::as_str);
                if source.is_some_and(|source| same_path(&expand_home(source), &expected_source)) {
                    true
                } else {
                    ambiguous = true;
                    continue;
                }
            }
            TargetName::Antigravity => {
                if entry["name"] == id {
                    ambiguous = true;
                }
                continue;
            }
        };
        if matches_identity {
            matches.push(entry);
        }
    }
    if ambiguous || matches.len() > 1 {
        return json!({"state":"unknown","installed":null,"enabled":null,"candidatePresent":true,"reason":"Native listing contains an ambiguous same-name/source/scope identity; ACM records were retained"});
    }
    let Some(entry) = matches.first() else {
        return json!({"state":"missing","installed":false,"enabled":null,"reason":"Successful complete provider listing contains no matching installation"});
    };
    let enabled = entry.get("enabled").and_then(Value::as_bool);
    json!({"state":if enabled == Some(false) {"disabled"} else {"installed"},"installed":true,"enabled":enabled,
        "identity":selector,"reason":if enabled.is_some() {"Native provider confirmed identity and enabled state"} else {"Native provider confirmed installation; enabled state is not exposed by this listing"}})
}

/// A targeted ownership check for an installer that reports an existing local deployment.
pub(crate) fn observe_provider_plugin(
    root: &Path,
    id: &str,
    target: TargetName,
) -> anyhow::Result<Value> {
    validate_plugin_id(id)?;
    let raw = bounded_provider_command(
        target,
        root,
        &["plugin".into(), "list".into(), "--json".into()],
    )?;
    Ok(observe(root, id, target, &parse_listing(target, &raw)?))
}

pub(crate) fn marketplace_source_matches(
    root: &Path,
    target: TargetName,
    expected: &Path,
) -> anyhow::Result<bool> {
    let raw = bounded_provider_command(
        target,
        root,
        &[
            "plugin".into(),
            "marketplace".into(),
            "list".into(),
            "--json".into(),
        ],
    )?;
    let value: Value = serde_json::from_str(&raw)
        .context("Cannot verify the existing marketplace source: unsupported JSON")?;
    let entries = match target {
        TargetName::Codex => value.get("marketplaces").and_then(Value::as_array),
        TargetName::Claude | TargetName::Grok => value.as_array(),
        TargetName::Antigravity => None,
    }
    .context("Cannot verify the existing marketplace source: unsupported schema")?;
    if matches!(target, TargetName::Claude | TargetName::Codex)
        && entries
            .iter()
            .filter(|entry| entry["name"] == MARKETPLACE)
            .count()
            != 1
    {
        return Ok(false);
    }
    let mut matches = 0;
    for entry in entries {
        let source = match target {
            TargetName::Claude
                if entry["name"] == MARKETPLACE && entry["source"] == "directory" =>
            {
                entry.get("path").and_then(Value::as_str)
            }
            TargetName::Codex
                if entry["name"] == MARKETPLACE
                    && entry["marketplaceSource"]["sourceType"] == "local" =>
            {
                entry["marketplaceSource"]
                    .get("source")
                    .and_then(Value::as_str)
            }
            TargetName::Grok if entry["kind"] == "local" => {
                entry["source"].get("path").and_then(Value::as_str)
            }
            _ => None,
        };
        if source.is_some_and(|source| same_path(&expand_home(source), expected)) {
            matches += 1;
        }
    }
    Ok(matches == 1)
}

/// The result is useful on failure too: OperationFailure retains every observation as one document.
pub fn verify_plugins(
    root: &Path,
    ids: &[String],
    targets: &[TargetName],
    reconcile: bool,
) -> anyhow::Result<Value> {
    let ids = if ids.is_empty() {
        catalog_plugin_ids()?
    } else {
        ids.to_vec()
    };
    for id in &ids {
        validate_plugin_id(id)?;
    }
    let mut locks = Vec::new();
    if reconcile {
        for id in ids.iter().collect::<BTreeSet<_>>() {
            locks.push(native_operation_lock(id)?);
        }
    }
    let mut listings = BTreeMap::new();
    for &target in targets {
        if listings.contains_key(target.as_str()) {
            continue;
        }
        let listing = if !is_home_scope(root) && target != TargetName::Claude {
            Err(anyhow::anyhow!(
                "{target} native plugins use home scope; use --home"
            ))
        } else {
            bounded_provider_command(
                target,
                root,
                &["plugin".into(), "list".into(), "--json".into()],
            )
            .and_then(|raw| parse_listing(target, &raw))
        };
        listings.insert(
            target.as_str(),
            listing.map_err(|error| redact_text(&error.to_string())),
        );
    }
    let mut reports = Vec::new();
    let mut retry = BTreeSet::new();
    let providers: Vec<_> = listings
        .iter()
        .map(|(target, result)| match result {
            Ok(_) => json!({"target":target,"state":"queried"}),
            Err(reason) => {
                retry.insert(*target);
                json!({"target":target,"state":"unknown","reason":reason})
            }
        })
        .collect();
    for id in ids {
        let metadata = plugin_metadata(&id)?;
        let mut observations = Vec::new();
        for &target in targets {
            let key = installation_key(root, target);
            let recorded = metadata
                .get("nativeInstallations")
                .and_then(|v| v.get(&key))
                .is_some()
                || is_home_scope(root)
                    && metadata
                        .get("installedFor")
                        .and_then(Value::as_array)
                        .is_some_and(|values| values.contains(&json!(target)));
            let mut observation = match &listings[target.as_str()] {
                Ok(listing) => observe(root, &id, target, listing),
                Err(reason) => {
                    json!({"state":"unknown","installed":null,"enabled":null,"reason":reason})
                }
            };
            observation["target"] = json!(target);
            observation["recorded"] = json!(recorded);
            observation["recordedEnabled"] = metadata
                .get("nativeInstallations")
                .and_then(|v| v.get(&key))
                .and_then(|v| v.get("enabled"))
                .cloned()
                .unwrap_or(Value::Null);
            observation["reconciled"] = json!(false);
            if observation["state"] == "unknown" {
                retry.insert(target.as_str());
            } else if reconcile && (recorded || observation["installed"] == true) {
                let mutation = update_metadata(&id, |entry| {
                    if observation["installed"] == false {
                        // An absent, unrecorded resource must not create metadata merely by verification.
                        if let Some(installs) = entry
                            .get_mut("nativeInstallations")
                            .and_then(Value::as_object_mut)
                        {
                            installs.remove(&key);
                        }
                        if is_home_scope(root) {
                            if let Some(legacy) =
                                entry.get_mut("installedFor").and_then(Value::as_array_mut)
                            {
                                legacy.retain(|value| value != &json!(target));
                            }
                        }
                    } else {
                        let installs = object_at(entry, "nativeInstallations")?;
                        let installation = installs.entry(&key).or_insert_with(
                            || json!({"target":target,"root":format_home_path(root)}),
                        );
                        let installation = installation
                            .as_object_mut()
                            .context("Invalid native installation metadata")?;
                        installation
                            .insert("verifiedAt".into(), json!(chrono::Utc::now().to_rfc3339()));
                        installation
                            .insert("verificationState".into(), observation["state"].clone());
                        if let Some(enabled) = observation["enabled"].as_bool() {
                            installation.insert("enabled".into(), json!(enabled));
                            if enabled {
                                installation.remove("activationPending");
                            }
                        }
                        // Preserve any historical recorded state when the current CLI cannot
                        // expose it. A new unknown observation must not imply enabled=true.
                        installation.insert(
                            "verifiedEnabledKnown".into(),
                            json!(observation["enabled"].is_boolean()),
                        );
                    }
                    Ok(())
                });
                // Only a confirmed installation or an existing record needs a write.
                match mutation {
                    Ok(()) => observation["reconciled"] = json!(true),
                    Err(error) => {
                        observation["reconcileError"] = json!(redact_text(&error.to_string()));
                        retry.insert(target.as_str());
                    }
                }
            }
            observations.push(observation);
        }
        reports.push(json!({"id":id,"targets":observations}));
    }
    let ok = retry.is_empty();
    let mut report = json!({"ok":ok,"operation":"plugin.verify","plugins":reports,"providers":providers,"retryTargets":retry,"reconcile":reconcile});
    if !ok {
        report["error"] = json!({"code":"verification_unknown","message":"Some native plugin identities or provider states could not be verified; unknown records were retained"});
        return Err(OperationFailure { report }.into());
    }
    Ok(report)
}

/// Capability preservation is not proof that an arbitrary component executes on every provider.
pub fn compatibility_report(id: &str, targets: &[TargetName]) -> anyhow::Result<Value> {
    validate_plugin_id(id)?;
    let source = get_catalog_plugin_dir(id);
    let info = parse_plugin_dir(&source)?;
    let metadata = plugin_metadata(id)?;
    let mut capabilities = BTreeSet::new();
    if !info.skills.is_empty()
        || metadata
            .get("skills")
            .and_then(Value::as_array)
            .is_some_and(|v| !v.is_empty())
    {
        capabilities.insert("skills");
    }
    if !info.mcp_servers.is_empty() {
        capabilities.insert("mcps");
    }
    for field in ["hooks", "commands", "agents", "apps", "interface"] {
        if info.manifest.get(field).is_some() || source.join(field).exists() {
            capabilities.insert(field);
        }
    }
    let reports: Vec<_> = targets.iter().map(|target| {
        let version = match target { TargetName::Claude => "2.1.261", TargetName::Codex => "0.149.0", TargetName::Antigravity => "1.1.27", TargetName::Grok => "1.0.5" };
        let components: Vec<_> = capabilities.iter().map(|capability| {
            let (state, reason) = if *capability == "skills" {
                ("supported", "A local skills-only plugin was installed, listed and removed with this native CLI in a network-denied isolated environment; skill execution was not tested")
            } else {
                ("unknown", "Payload is preserved, but this capability was not exercised by isolated native lifecycle validation; provider-specific schemas and runtime behavior may differ")
            };
            json!({"capability":capability,"state":state,"reason":reason})
        }).collect();
        json!({"target":target,"validatedVersion":version,"capabilities":components})
    }).collect();
    Ok(
        json!({"id":id,"targets":reports,"evidence":"isolated native skills-only lifecycle, 2026-09-05","scopeNote":"Codex, Antigravity and Grok native installations use home scope; Claude also supports project scope","runtimeGuarantee":false}),
    )
}
