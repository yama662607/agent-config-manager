use crate::catalog::metadata::{load_skills_metadata, update_skill_metadata};
use crate::catalog::store::{get_skill, parse_skill_frontmatter};
use crate::core::placement::{copy_dir_recursive, replace_directory};
use crate::paths::{format_home_path, get_catalog_skill_dir};
use crate::storage::{read_value, validate_id};
use anyhow::{bail, Context};
use reqwest::blocking::Client;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io::Read;
use std::path::{Component, Path};
use std::process::Command;
use std::time::Duration;

const MAX_DOWNLOAD: u64 = 16 * 1024 * 1024;

fn http_bytes(url: &str) -> anyhow::Result<Vec<u8>> {
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent(concat!("acm/", env!("CARGO_PKG_VERSION")))
        .build()?;
    let response = client.get(url).send()?.error_for_status()?;
    let mut bytes = Vec::new();
    response.take(MAX_DOWNLOAD + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_DOWNLOAD {
        bail!("Download exceeded 16 MiB: {url}");
    }
    Ok(bytes)
}

fn github_json(endpoint: &str) -> anyhow::Result<Value> {
    if let Ok(output) = Command::new("gh").args(["api", endpoint]).output() {
        if output.status.success() {
            return Ok(serde_json::from_slice(&output.stdout)?);
        }
    }
    Ok(serde_json::from_slice(&http_bytes(&format!(
        "https://api.github.com/{endpoint}"
    ))?)?)
}

fn github_file(source: &GitHubSource, sha: &str, file: &str) -> anyhow::Result<Vec<u8>> {
    let mut endpoint = Url::parse(&format!(
        "https://api.github.com/repos/{}/{}/contents/",
        source.owner, source.repo
    ))?;
    endpoint
        .path_segments_mut()
        .unwrap()
        .pop_if_empty()
        .extend(file.split('/'));
    endpoint.query_pairs_mut().append_pair("ref", sha);
    let relative = endpoint
        .as_str()
        .strip_prefix("https://api.github.com/")
        .unwrap();
    if let Ok(output) = Command::new("gh")
        .args([
            "api",
            relative,
            "-H",
            "Accept: application/vnd.github.raw+json",
        ])
        .output()
    {
        if output.status.success() {
            if output.stdout.len() as u64 > MAX_DOWNLOAD {
                bail!("Skill file exceeded 16 MiB");
            }
            return Ok(output.stdout);
        }
    }
    let mut url = Url::parse(&format!(
        "https://raw.githubusercontent.com/{}/{}/{sha}/",
        source.owner, source.repo
    ))?;
    url.path_segments_mut()
        .unwrap()
        .pop_if_empty()
        .extend(file.split('/'));
    http_bytes(url.as_str())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubSource {
    pub owner: String,
    pub repo: String,
    pub reference: String,
    pub path: String,
}

pub fn parse_github_source(url: &str) -> anyhow::Result<GitHubSource> {
    let parsed = Url::parse(url)?;
    if parsed.scheme() != "https"
        || !["github.com", "www.github.com", "raw.githubusercontent.com"]
            .contains(&parsed.host_str().unwrap_or_default())
    {
        bail!("Only HTTPS GitHub URLs are supported");
    }
    let parts: Vec<_> = parsed
        .path_segments()
        .context("Missing GitHub path")?
        .filter(|p| !p.is_empty())
        .collect();
    if parts.len() < 2 {
        bail!("Expected a GitHub repository URL");
    }
    let (reference, start) = if parsed.host_str() == Some("raw.githubusercontent.com") {
        (*parts.get(2).context("Missing GitHub revision")?, 3)
    } else if parts.len() == 2 {
        ("HEAD", 2)
    } else {
        if !["tree", "blob"].contains(&parts[2]) {
            bail!("Expected a GitHub tree or blob URL");
        }
        (*parts.get(3).context("Missing GitHub revision")?, 4)
    };
    let path = parts[start..].join("/");
    let path = path.strip_suffix("/SKILL.md").unwrap_or(&path);
    let path = if path == "SKILL.md" { "" } else { path };
    Ok(GitHubSource {
        owner: parts[0].into(),
        repo: parts[1].trim_end_matches(".git").into(),
        reference: reference.into(),
        path: path.into(),
    })
}

pub fn latest_commit(source: &GitHubSource) -> anyhow::Result<String> {
    let mut query = Url::parse(&format!(
        "https://api.github.com/repos/{}/{}/commits",
        source.owner, source.repo
    ))?;
    query
        .query_pairs_mut()
        .append_pair("sha", &source.reference)
        .append_pair("per_page", "1");
    if !source.path.is_empty() {
        query.query_pairs_mut().append_pair("path", &source.path);
    }
    let commits = github_json(
        query
            .as_str()
            .strip_prefix("https://api.github.com/")
            .unwrap(),
    )?;
    commits
        .get(0)
        .and_then(|v| v.get("sha"))
        .and_then(Value::as_str)
        .map(str::to_owned)
        .context("No commit found for this skill path")
}

pub fn search_skills(query: &str) -> anyhow::Result<Value> {
    let mut url = Url::parse("https://api.skills-directory.com/v1/search")?;
    url.query_pairs_mut().append_pair("q", query);
    let result: Value = serde_json::from_slice(&http_bytes(url.as_str())?)?;
    Ok(result.get("skills").cloned().unwrap_or_else(|| json!([])))
}

pub fn import_skill(source: &Path, name: Option<&str>, force: bool) -> anyhow::Result<String> {
    let source = source
        .canonicalize()
        .context("Skill source does not exist")?;
    let source = if source.is_file() {
        source.parent().unwrap().to_path_buf()
    } else {
        source
    };
    if !source.join("SKILL.md").is_file() {
        bail!("No SKILL.md in {}", source.display());
    }
    let id = name
        .map(str::to_owned)
        .unwrap_or_else(|| source.file_name().unwrap().to_string_lossy().into_owned());
    validate_id(&id)?;
    let destination = get_catalog_skill_dir(&id);
    if destination.canonicalize().ok().as_ref() == Some(&source) {
        return Ok(id);
    }
    if fs::symlink_metadata(&destination).is_ok() && !force {
        bail!("Skill {id} already exists; use --force to replace it");
    }
    replace_directory(&destination, |stage| copy_dir_recursive(&source, stage))?;
    update_skill_metadata(&id, |meta| {
        meta["sourceUrl"] = json!(format_home_path(&source));
        meta["sourceKind"] = json!("local");
        meta["installedAt"] = json!(chrono::Utc::now().to_rfc3339());
        Ok(())
    })?;
    Ok(id)
}

pub struct DownloadedSkill {
    pub directory: tempfile::TempDir,
    pub id: String,
    pub source_url: String,
    pub source_ref: String,
}

pub fn install_skill(input: &str, name: Option<&str>, force: bool) -> anyhow::Result<String> {
    let skill = download_skill(input, name)?;
    import_skill(skill.directory.path(), Some(&skill.id), force)?;
    update_skill_metadata(&skill.id, |meta| {
        meta["sourceUrl"] = json!(skill.source_url);
        meta["sourceKind"] = json!("github");
        meta["sourceRef"] = json!(skill.source_ref);
        meta["forked"] = json!(false);
        Ok(())
    })?;
    Ok(skill.id)
}

pub fn download_skill(input: &str, name: Option<&str>) -> anyhow::Result<DownloadedSkill> {
    let url = if input.starts_with("https://") {
        input.to_owned()
    } else {
        let mut url = Url::parse("https://api.skills-directory.com/v1/skills/")?;
        url.path_segments_mut().unwrap().pop_if_empty().push(input);
        let info: Value = serde_json::from_slice(&http_bytes(url.as_str())?)?;
        info.get("skill_md")
            .or_else(|| info.get("links").and_then(|v| v.get("skill_md")))
            .and_then(Value::as_str)
            .context("Registry entry has no GitHub skill URL")?
            .to_owned()
    };
    let source = parse_github_source(&url)?;
    let sha = latest_commit(&source)?;
    let tree = github_json(&format!(
        "repos/{}/{}/git/trees/{sha}?recursive=1",
        source.owner, source.repo
    ))?;
    if tree.get("truncated").and_then(Value::as_bool) == Some(true) {
        bail!("GitHub returned a truncated tree; import a local checkout to preserve the complete skill");
    }
    let nodes = tree
        .get("tree")
        .and_then(Value::as_array)
        .context("GitHub tree missing")?;
    let prefix = if source.path.is_empty() {
        String::new()
    } else {
        format!("{}/", source.path)
    };
    let temporary = tempfile::tempdir()?;
    let mut total = 0;
    for node in nodes {
        let Some(file) = node.get("path").and_then(Value::as_str) else {
            continue;
        };
        let Some(relative) = file.strip_prefix(&prefix) else {
            continue;
        };
        if relative.is_empty() || node.get("type").and_then(Value::as_str) != Some("blob") {
            continue;
        }
        if Path::new(relative)
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
        {
            bail!("Invalid path from GitHub: {relative}");
        }
        if node.get("mode").and_then(Value::as_str) == Some("120000") {
            bail!(
                "Skill contains a symlink; import a local checkout to resolve its complete payload"
            );
        }
        let content = github_file(&source, &sha, file)?;
        total += content.len();
        if total > 64 * 1024 * 1024 {
            bail!("Skill directory exceeded 64 MiB");
        }
        let destination = temporary.path().join(relative);
        fs::create_dir_all(destination.parent().unwrap())?;
        fs::write(&destination, content)?;
        #[cfg(unix)]
        if node.get("mode").and_then(Value::as_str) == Some("100755") {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&destination, fs::Permissions::from_mode(0o755))?;
        }
    }
    let content = fs::read_to_string(temporary.path().join("SKILL.md"))
        .context("No SKILL.md at this GitHub path; specify the directory containing the skill")?;
    let frontmatter = parse_skill_frontmatter(&content);
    let id = name.map(str::to_owned).unwrap_or(frontmatter.name);
    validate_id(&id)?;
    Ok(DownloadedSkill {
        directory: temporary,
        id,
        source_url: format!(
            "https://github.com/{}/{}/tree/{}/{}",
            source.owner, source.repo, source.reference, source.path
        ),
        source_ref: sha,
    })
}

pub fn skill_outdated(id: Option<&str>, all: bool) -> anyhow::Result<Value> {
    let metadata = load_skills_metadata()?;
    let skills = crate::catalog::store::list_skills()?;
    if let Some(id) = id {
        get_skill(id)?.context("Skill not found in catalog")?;
    }
    let mut statuses = Vec::new();
    for skill in skills {
        if id.is_some_and(|id| id != skill.id) {
            continue;
        }
        let meta = metadata.skills.get(&skill.id).cloned().unwrap_or_default();
        if !all && id.is_none() && meta.source_url.is_none() {
            continue;
        }
        let mut status = json!({"skillId": skill.id, "state": "unknown", "sourceUrl": meta.source_url, "recordedRef": meta.source_ref});
        if meta.forked == Some(true) {
            status["state"] = json!("forked");
        } else if let Some(url) = &meta.source_url {
            if let Ok(source) = parse_github_source(url) {
                match latest_commit(&source) {
                    Ok(latest) => {
                        status["state"] = json!(match meta.source_ref.as_deref() {
                            Some(old) if old == latest => "up-to-date",
                            Some(_) => "behind",
                            None => "unknown",
                        });
                        status["latestRef"] = json!(latest);
                    }
                    Err(error) => {
                        status["state"] = json!("unreachable");
                        status["detail"] = json!(error.to_string());
                    }
                }
                update_skill_metadata(&skill.id, |value| {
                    value["upstreamCheckedAt"] = json!(chrono::Utc::now().to_rfc3339());
                    Ok(())
                })?;
            }
        }
        statuses.push(status);
    }
    Ok(json!(statuses))
}

pub fn skill_metadata(id: &str) -> anyhow::Result<Value> {
    get_skill(id)?.context("Skill not found in catalog")?;
    Ok(read_value(&crate::paths::get_skills_metadata_path())?
        .get("skills")
        .and_then(|v| v.get(id))
        .cloned()
        .unwrap_or_else(|| json!({})))
}
