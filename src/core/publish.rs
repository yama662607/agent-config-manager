use crate::catalog::store::get_mcp;
use crate::core::placement::{copy_dir_recursive, remove_path, replace_directory};
use crate::paths::{get_catalog_dir, get_catalog_skill_dir};
use crate::storage::{atomic_write, validate_id};
use anyhow::{bail, Context};
use regex::Regex;
use serde_json::{json, Value};
use std::fs;
use std::path::Path;
use std::process::Command;

fn git(root: &Path, args: &[&str]) -> anyhow::Result<String> {
    let out = Command::new("git").current_dir(root).args(args).output()?;
    if !out.status.success() {
        bail!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr)
        );
    }
    Ok(String::from_utf8(out.stdout)?)
}

fn prune(stage: &Path) -> anyhow::Result<()> {
    let mut excluded = Vec::new();
    for entry in walkdir::WalkDir::new(stage).min_depth(1) {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy();
        if [
            ".git",
            "node_modules",
            "__pycache__",
            ".venv",
            "tests",
            "evals",
            "browser_data",
        ]
        .contains(&name.as_ref())
            || name.ends_with(".pyc")
            || name.ends_with(".log")
        {
            excluded.push(entry.path().to_path_buf());
        }
    }
    for path in excluded {
        if fs::symlink_metadata(&path).is_ok() {
            remove_path(&path)?;
        }
    }
    Ok(())
}

fn inspect(stage: &Path) -> anyhow::Result<()> {
    let secret = Regex::new(
        r"(?i)(sk-[a-z0-9_-]{20,}|gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|npm_[a-z0-9]{20,}|AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|_authToken\s*=\s*[^\s$]+)",
    )?;
    let personal = Regex::new(r"/(?:Users|home)/([a-zA-Z0-9._-]+)")?;
    for entry in walkdir::WalkDir::new(stage).min_depth(1) {
        let entry = entry?;
        if !entry.file_type().is_file() {
            continue;
        }
        let bytes = fs::read(entry.path())?;
        let text = String::from_utf8_lossy(&bytes);
        let private_path = personal
            .captures_iter(&text)
            .any(|cap| !["username", "user", "example"].contains(&&cap[1]));
        if secret.is_match(&text) || private_path {
            bail!("Publication refused: possible secret or personal absolute path in {}. Replace it with an environment reference before publishing.", entry.path().strip_prefix(stage)?.display());
        }
    }
    Ok(())
}

pub fn publish(
    allowlist: Option<&Path>,
    destination: Option<&Path>,
    commit: bool,
    dry_run: bool,
) -> anyhow::Result<Value> {
    if commit && destination.is_none() {
        bail!("--commit requires --to <git checkout>");
    }
    let catalog = get_catalog_dir();
    let allowlist = allowlist
        .map(Path::to_path_buf)
        .unwrap_or_else(|| catalog.join("PUBLIC.txt"));
    let content = fs::read_to_string(&allowlist)
        .with_context(|| format!("Cannot read allowlist {}", allowlist.display()))?;
    let temporary = tempfile::tempdir()?;
    let mut assets = Vec::new();
    let mut origins = std::collections::HashMap::new();
    for line in content.lines() {
        let line = line.split('#').next().unwrap_or_default().trim();
        if line.is_empty() {
            continue;
        }
        let (kind, id) = line
            .split_once('/')
            .context("Allowlist entries must be skill/<id>, mcp/<id>, or plugin/<id>")?;
        if kind == "mcp" {
            for part in id.split('/') {
                validate_id(part)?;
            }
        } else {
            validate_id(id)?;
        }
        let relative = match kind {
            "skill" => format!("skills/{id}"),
            "mcp" => format!(
                "mcp-servers/{}.toml",
                crate::adapters::sanitize_server_key(id)
            ),
            "plugin" => format!("plugins/{id}"),
            _ => bail!("Unknown allowlist resource: {kind}"),
        };
        if let Some(previous) = origins.insert(relative.clone(), id.to_owned()) {
            if previous != id {
                bail!("Publication name collision between {previous} and {id}");
            }
            continue;
        }
        let target = temporary.path().join(&relative);
        match kind {
            "skill" => copy_dir_recursive(get_catalog_skill_dir(id), &target)?,
            "plugin" => {
                crate::core::plugin::assemble_plugin(id, &target)?;
            }
            _ => {
                fs::create_dir_all(target.parent().unwrap())?;
                if let Some(entry) = get_mcp(id)? {
                    atomic_write(&target, toml::to_string_pretty(&entry)?.as_bytes())?;
                } else {
                    fs::copy(
                        catalog.join("mcp-servers").join(format!("{id}.toml")),
                        &target,
                    )
                    .context("Allowlisted MCP not found")?;
                }
            }
        }
        assets.push(relative);
    }
    if assets.is_empty() {
        bail!("Allowlist contains no resources");
    }
    let bundle = catalog.join("publish/bundle");
    if bundle.is_dir() {
        copy_dir_recursive(&bundle, temporary.path())?;
    }
    prune(temporary.path())?;
    inspect(temporary.path())?;
    let mut previous = Vec::<String>::new();
    if temporary.path().join(".acm-publish.json").exists() {
        bail!("Reserved publication path: .acm-publish.json");
    }
    if let Some(destination) = destination {
        let canonical = destination
            .canonicalize()
            .context("Publication destination must be an existing Git checkout")?;
        let git_root = git(&canonical, &["rev-parse", "--show-toplevel"])?;
        if Path::new(git_root.trim()).canonicalize()? != canonical {
            bail!("--to must name the root of a Git checkout");
        }
        if !git(&canonical, &["status", "--porcelain"])?
            .trim()
            .is_empty()
        {
            bail!("Publication destination has uncommitted changes; commit or stash them before publishing");
        }
        if canonical.starts_with(&catalog) || catalog.starts_with(&canonical) {
            bail!("Publication destination must be separate from the private catalog");
        }
        let record = destination.join(".acm-publish.json");
        if record.is_file() {
            previous = serde_json::from_slice(&fs::read(&record)?)?;
        }
        for item in &previous {
            let parts: Vec<_> = item.split('/').collect();
            if parts.len() != 2 || !["skills", "mcp-servers", "plugins"].contains(&parts[0]) {
                bail!("Invalid publication record");
            }
            validate_id(parts[1])?;
        }
        let mut planned: Vec<_> = walkdir::WalkDir::new(temporary.path())
            .min_depth(1)
            .into_iter()
            .map(|entry| Ok(entry?.path().strip_prefix(temporary.path())?.to_path_buf()))
            .collect::<anyhow::Result<_>>()?;
        planned.extend(previous.iter().map(std::path::PathBuf::from));
        planned.push(std::path::PathBuf::from(".acm-publish.json"));
        for relative in planned {
            let mut path = destination.to_path_buf();
            for part in relative.components() {
                path.push(part);
                if fs::symlink_metadata(&path).is_ok_and(|meta| meta.file_type().is_symlink()) {
                    bail!(
                        "Publication refuses a symlink destination: {}",
                        path.display()
                    );
                }
            }
        }
    }
    if dry_run {
        return Ok(json!({"dryRun": true, "assets": assets, "destination": destination}));
    }
    let stage = catalog.join("dist-public");
    replace_directory(&stage, |path| copy_dir_recursive(temporary.path(), path))?;
    if let Some(destination) = destination {
        // Only replace paths ACM previously published; unrelated repository files survive.
        let record = destination.join(".acm-publish.json");
        for item in previous {
            let path = Path::new(&item);
            if !assets.contains(&item) {
                remove_path(&destination.join(path))?;
            }
        }
        for entry in fs::read_dir(&stage)? {
            let entry = entry?;
            let dest = destination.join(entry.file_name());
            if [".git", ".acm-publish.json"].contains(&entry.file_name().to_string_lossy().as_ref())
            {
                bail!("Reserved publication path");
            }
            if entry.path().is_dir() {
                // Merge each resource independently to preserve non-ACM assets.
                fs::create_dir_all(&dest)?;
                for resource in fs::read_dir(entry.path())? {
                    let resource = resource?;
                    let target = dest.join(resource.file_name());
                    if resource.path().is_dir() {
                        replace_directory(&target, |path| {
                            copy_dir_recursive(resource.path(), path)
                        })?;
                    } else {
                        atomic_write(&target, &fs::read(resource.path())?)?;
                    }
                }
            } else {
                atomic_write(&dest, &fs::read(entry.path())?)?;
            }
        }
        atomic_write(&record, &serde_json::to_vec_pretty(&assets)?)?;
        if commit {
            git(destination, &["add", "--", "."])?;
            if !git(destination, &["diff", "--cached", "--name-only"])?
                .trim()
                .is_empty()
            {
                git(
                    destination,
                    &["commit", "-m", "chore: publish allowlisted ACM catalog"],
                )?;
            }
        }
    }
    Ok(
        json!({"dryRun": false, "assets": assets, "stage": stage, "destination": destination, "committed": commit}),
    )
}
