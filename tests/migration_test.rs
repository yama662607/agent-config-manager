mod common;
use common::*;
use std::fs;
#[test]
fn skills_preserve_payload_metadata_filters_and_local_edits_on_rename() {
    let f = Fixture::new();
    let source = f.skill("complete");
    f.ok(&[
        "skill",
        "import",
        source.to_str().unwrap(),
        "-t",
        "claude,codex",
    ]);
    assert!(f
        .project
        .join(".claude/skills/complete/scripts/run.sh")
        .is_file());
    f.file(
        "catalog/skills-metadata.toml",
        "[skills.complete]\nunknown = 'retained'\ninstalledAt = '2020'\n",
    );
    f.ok(&[
        "skill",
        "meta",
        "complete",
        "--pin",
        "--category",
        "coding",
        "--tags",
        "rust,cli",
    ]);
    assert_eq!(
        f.json(&["-g", "skill", "list", "--pinned", "--category", "coding"])
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        f.json(&["skill", "meta", "complete"])["unknown"],
        "retained"
    );
    f.file(
        "project/.claude/skills/complete/local.txt",
        "keep local edit",
    );
    f.ok(&[
        "skill",
        "rename",
        "complete",
        "renamed",
        "-t",
        "claude,codex",
    ]);
    assert!(f.project.join(".claude/skills/renamed/local.txt").is_file());
    assert_eq!(f.json(&["skill", "meta", "renamed"])["installedAt"], "2020");
    assert!(!f.catalog.join("skills/complete").exists());
    f.file("project/.codex/skills/collision/SKILL.md", "keep");
    f.fail(&[
        "skill",
        "rename",
        "renamed",
        "collision",
        "-t",
        "claude,codex",
    ]);
    assert!(f.catalog.join("skills/renamed/SKILL.md").is_file());
    assert!(f.project.join(".claude/skills/renamed/local.txt").is_file());
}
#[test]
fn grok_registration_toggles_and_targeted_update() {
    let f = Fixture::new();
    let source = f.skill("registered");
    f.ok(&["skill", "import", source.to_str().unwrap(), "-t", "grok"]);
    assert_eq!(
        f.json(&["skill", "list", "-t", "grok"])["skills"][0]["placement"]["grok"],
        "registered"
    );
    f.ok(&["skill", "disable", "registered", "-t", "grok"]);
    assert!(f.json(&["skill", "list", "-t", "grok"])["skills"]
        .as_array()
        .unwrap()
        .is_empty());
    f.ok(&["skill", "enable", "registered", "-t", "grok"]);
    assert_eq!(
        f.json(&["skill", "list", "-t", "grok"])["skills"][0]["enabled"],
        true
    );
    f.ok(&["skill", "update", "registered", "--force", "-t", "codex"]);
    assert!(f
        .project
        .join(".codex/skills/registered/scripts/run.sh")
        .is_file());
    f.file("catalog/skills/registered/scripts/run.sh", "new source");
    f.ok(&["skill", "update", "registered", "-t", "codex"]);
    assert_eq!(
        fs::read_to_string(f.project.join(".codex/skills/registered/scripts/run.sh")).unwrap(),
        "new source"
    );
}
#[cfg(unix)]
#[test]
fn github_install_fetches_full_directory_and_records_revision() {
    use std::os::unix::fs::PermissionsExt;
    let f = Fixture::new();
    f.providers();
    f.mock_ok(&[
        "-g",
        "skill",
        "install",
        "https://github.com/example/skills/tree/main/skills/remote",
    ]);
    let script = f.catalog.join("skills/remote/scripts/run.sh");
    assert!(script.is_file());
    assert!(fs::metadata(script).unwrap().permissions().mode() & 0o111 != 0);
    let metadata = f.json(&["skill", "meta", "remote"]);
    assert_eq!(metadata["sourceRef"], "b".repeat(40));
    assert_eq!(metadata["sourceKind"], "github");
    let outdated = f.mock_ok(&["skill", "outdated", "remote"]);
    assert_eq!(outdated[0]["state"], "up-to-date");
}
#[cfg(unix)]
#[test]
fn config_symlink_and_failed_skill_copy_preserve_original_data() {
    let f = Fixture::new();
    let original = f.file("shared/config.toml", "# shared config\nmodel = 'keep'\n");
    fs::create_dir_all(f.project.join(".codex")).unwrap();
    std::os::unix::fs::symlink(&original, f.project.join(".codex/config.toml")).unwrap();
    f.ok(&["mcp", "add", "linked", "--command", "echo", "-t", "codex"]);
    assert!(fs::symlink_metadata(f.project.join(".codex/config.toml"))
        .unwrap()
        .file_type()
        .is_symlink());
    assert_eq!(
        toml_file(&original)["mcp_servers"]["linked"]["command"],
        "echo"
    );
    let source = f.skill("safe");
    f.ok(&["-g", "skill", "import", source.to_str().unwrap()]);
    std::os::unix::fs::symlink(&source, source.join("loop")).unwrap();
    f.fail(&["-g", "skill", "import", source.to_str().unwrap(), "--force"]);
    assert!(f.catalog.join("skills/safe/SKILL.md").is_file());
}
#[test]
fn allowlisted_publication_dry_run_secret_refusal_and_destination_preservation() {
    let f = Fixture::new();
    let source = f.skill("public");
    f.ok(&["-g", "skill", "import", source.to_str().unwrap()]);
    f.file("catalog/PUBLIC.txt", "skill/public\n");
    f.ok(&["catalog", "publish", "--dry-run"]);
    assert!(!f.catalog.join("dist-public").exists());
    f.file(
        "catalog/skills/public/secret.txt",
        &format!("ghp_{}", "0".repeat(30)),
    );
    assert!(f
        .fail(&["catalog", "publish"])
        .contains("Publication refused"));
    assert!(!f.catalog.join("dist-public").exists());
    fs::remove_file(f.catalog.join("skills/public/secret.txt")).unwrap();
    let destination = f.temp.path().join("public-checkout");
    fs::create_dir_all(&destination).unwrap();
    let git = |args: &[&str]| {
        let result = std::process::Command::new("git")
            .current_dir(&destination)
            .args(args)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
    };
    git(&["init", "--quiet"]);
    git(&["config", "user.name", "Fixture"]);
    git(&["config", "user.email", "fixture@example.invalid"]);
    write(
        &destination.join("README.md"),
        "Keep the public repository readme",
    );
    git(&["add", "README.md"]);
    git(&["commit", "--quiet", "-m", "fixture"]);
    f.ok(&[
        "catalog",
        "publish",
        "--to",
        destination.to_str().unwrap(),
        "--commit",
    ]);
    assert!(destination.join("skills/public/scripts/run.sh").is_file());
    assert_eq!(
        fs::read_to_string(destination.join("README.md")).unwrap(),
        "Keep the public repository readme"
    );
}
#[test]
fn scan_dry_run_and_doctor_are_read_only() {
    let f = Fixture::new();
    f.file(
        "project/.mcp.json",
        r#"{"mcpServers":{"scan-me":{"command":"command-that-does-not-exist"}}}"#,
    );
    let report = f.json(&["scan", "--dry-run", "-t", "claude"]);
    assert_eq!(report["imported"][0]["id"], "scan-me");
    assert!(fs::read_dir(&f.catalog).unwrap().next().is_none());
    f.fail(&["doctor", "--strict", "--offline", "-t", "claude"]);
    assert!(fs::read_dir(&f.catalog).unwrap().next().is_none());
    f.ok(&["scan", "-t", "claude"]);
    assert_eq!(f.json(&["-g", "mcp", "list"])[0]["id"], "scan-me");
}

#[cfg(unix)]
#[test]
fn direct_skill_install_does_not_create_catalog_entries() {
    let f = Fixture::new();
    f.providers();
    f.mock_ok(&[
        "skill",
        "install",
        "https://github.com/example/skills/tree/main/skills/remote",
        "--no-catalog",
        "-t",
        "codex",
    ]);
    assert!(f
        .project
        .join(".codex/skills/remote/scripts/run.sh")
        .is_file());
    assert!(fs::read_dir(&f.catalog).unwrap().next().is_none());
}

#[test]
fn publication_handles_scoped_recipes_and_rejects_reserved_history() {
    let f = Fixture::new();
    f.ok(&["-g", "mcp", "add", "@scope/server-public"]);
    f.file("catalog/PUBLIC.txt", "mcp/@scope/server-public\n");
    f.ok(&["catalog", "publish"]);
    assert!(f
        .catalog
        .join("dist-public/mcp-servers/public.toml")
        .is_file());
    let destination = f.temp.path().join("public-repo");
    fs::create_dir_all(&destination).unwrap();
    for args in [
        vec!["init", "--quiet"],
        vec!["config", "user.name", "Fixture"],
        vec!["config", "user.email", "fixture@example.invalid"],
    ] {
        assert!(std::process::Command::new("git")
            .current_dir(&destination)
            .args(args)
            .status()
            .unwrap()
            .success());
    }
    write(&destination.join(".acm-publish.json"), "[\".git\"]");
    for args in [
        vec!["add", ".acm-publish.json"],
        vec!["commit", "--quiet", "-m", "fixture"],
    ] {
        assert!(std::process::Command::new("git")
            .current_dir(&destination)
            .args(args)
            .status()
            .unwrap()
            .success());
    }
    assert!(f
        .fail(&["catalog", "publish", "--to", destination.to_str().unwrap()])
        .contains("Invalid publication record"));
    assert!(destination.join(".git").is_dir());
}
