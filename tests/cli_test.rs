mod common;
use common::*;
use std::fs;

#[test]
fn help_and_command_inventory() {
    let f = Fixture::new();
    for args in [
        vec![],
        vec!["mcp"],
        vec!["skill"],
        vec!["plugin"],
        vec!["catalog"],
        vec!["catalog", "publish"],
        vec!["mcp", "add"],
        vec!["skill", "meta"],
        vec!["skill", "outdated"],
        vec!["plugin", "repair"],
        vec!["plugin", "discover"],
    ] {
        let mut args = args;
        args.push("--help");
        assert!(f.ok(&args).contains("Usage:"));
    }
    assert!(f.ok(&["--version"]).contains(env!("CARGO_PKG_VERSION")));
    assert!(f.fail(&["init"]).contains("terminal"));
    assert!(f
        .fail(&["--home", "--catalog", "mcp", "list"])
        .contains("cannot be used"));
    assert!(fs::read_dir(&f.catalog).unwrap().next().is_none());
}

#[test]
fn catalog_configuration_defaults_and_nested_project_discovery() {
    let f = Fixture::new();
    let configured = f.temp.path().join("configured");
    write(
        &f.home.join(".acm/config.toml"),
        &format!(
            "catalog_dir = {:?}\ndefault_targets = [\"codex\"]\n",
            configured.display().to_string()
        ),
    );
    fs::create_dir_all(f.project.join(".git")).unwrap();
    let nested = f.project.join("src/deep");
    fs::create_dir_all(&nested).unwrap();
    let output = f
        .command()
        .env_remove("ACM_CATALOG_DIR")
        .current_dir(nested)
        .args([
            "mcp",
            "add",
            "fixture",
            "--command",
            "echo",
            "--args",
            "[\"hello\"]",
        ])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(configured.join("catalog.toml").is_file());
    assert!(f.project.join(".codex/config.toml").is_file());
    assert!(!f.project.join(".mcp.json").exists());
    assert!(f
        .json(&["--catalog", "mcp", "list"])
        .as_array()
        .unwrap()
        .is_empty());
    let output = f
        .command()
        .current_dir(&f.home)
        .args(["mcp", "list"])
        .output()
        .unwrap();
    assert!(!output.status.success());
}

#[test]
fn legacy_catalog_metadata_and_concurrent_updates_survive() {
    let f = Fixture::new();
    f.file("catalog/catalog.json", r#"{"version":"1.0","custom":{"keep":true},"mcps":{"old":{"id":"old","displayName":"Old","description":"","addedAt":"2020","recipe":{"command":"echo"},"unknown":99}},"skills":{"legacy":{"id":"legacy","displayName":"legacy","description":"","addedAt":"2000"}}}"#);
    f.file(
        "catalog/skills/legacy/SKILL.md",
        "---\nname: legacy\ndescription: Legacy data\n---\n",
    );
    f.file(
        "catalog/skills-metadata.toml",
        "custom = 'keep'\n[skills.legacy]\npinned = true\nunknown = 42\n",
    );
    assert_eq!(f.json(&["-g", "mcp", "list"])[0]["id"], "old");
    assert!(
        !f.catalog.join("catalog.toml").exists(),
        "Read-only list must not migrate data"
    );
    let mut children = Vec::new();
    for n in 0..10 {
        children.push(
            f.command()
                .args([
                    "-g",
                    "mcp",
                    "add",
                    &format!("parallel-{n}"),
                    "--command",
                    "echo",
                ])
                .stdout(std::process::Stdio::null())
                .spawn()
                .unwrap(),
        );
    }
    for mut child in children {
        assert!(child.wait().unwrap().success());
    }
    let catalog = toml_file(&f.catalog.join("catalog.toml"));
    assert_eq!(catalog["mcps"].as_object().unwrap().len(), 11);
    assert_eq!(catalog["mcps"]["old"]["unknown"], 99);
    assert_eq!(catalog["custom"]["keep"], true);
    assert!(catalog.get("skills").is_none());
    let meta = toml_file(&f.catalog.join("skills-metadata.toml"));
    assert_eq!(meta["skills"]["legacy"]["installedAt"], "2000");
    assert_eq!(meta["skills"]["legacy"]["unknown"], 42);
    assert!(f.catalog.join("catalog.json.bak").is_file());
}

#[test]
fn malformed_files_are_not_repaired_or_replaced() {
    let f = Fixture::new();
    let invalid = "[mcp_servers\nsecret = keep\n";
    f.file("project/.codex/config.toml", invalid);
    assert!(f
        .fail(&["mcp", "add", "test", "--command", "echo", "-t", "codex"])
        .contains("Invalid TOML"));
    assert_eq!(
        fs::read_to_string(f.project.join(".codex/config.toml")).unwrap(),
        invalid
    );
    let output = f.run(&["doctor", "--json", "--fix", "-t", "codex"]);
    assert!(!output.status.success());
    let report: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["has_errors"], true);
    assert_eq!(
        fs::read_to_string(f.project.join(".codex/config.toml")).unwrap(),
        invalid
    );
    f.file("catalog/catalog.toml", "version = '99.0'\n");
    assert!(f
        .fail(&["-g", "mcp", "add", "x"])
        .contains("Unsupported catalog version"));
}

#[test]
fn mcp_lifecycle_drift_and_unknown_fields() {
    let f = Fixture::new();
    f.file("project/.codex/config.toml", "# keep header\nmodel = 'test' # keep model\n[mcp_servers.custom]\ncommand = 'echo'\nargs = ['before']\nstartup_timeout_sec = 90 # keep timeout\n");
    f.ok(&["mcp", "adopt", "custom", "-t", "codex"]);
    f.ok(&[
        "mcp",
        "edit",
        "custom",
        "--args",
        "[\"after\"]",
        "-t",
        "codex",
    ]);
    let status = f.json(&["mcp", "list", "-t", "codex"]);
    assert_eq!(status["servers"][0]["state"]["codex"], "differs");
    f.ok(&["mcp", "update", "custom", "-t", "codex"]);
    let content = fs::read_to_string(f.project.join(".codex/config.toml")).unwrap();
    assert!(content.contains("# keep model") && content.contains("# keep timeout"));
    assert_eq!(
        toml_file(&f.project.join(".codex/config.toml"))["mcp_servers"]["custom"]["args"][0],
        "before"
    );
    f.ok(&["mcp", "disable", "custom", "-t", "codex"]);
    f.ok(&["mcp", "enable", "custom", "-t", "codex"]);
    assert_eq!(
        toml_file(&f.project.join(".codex/config.toml"))["mcp_servers"]["custom"]
            ["startup_timeout_sec"],
        90
    );
    f.ok(&[
        "mcp",
        "add",
        "temporary",
        "--command",
        "echo",
        "--no-register",
        "-t",
        "claude",
    ]);
    f.ok(&["mcp", "disable", "temporary", "-t", "claude"]);
    assert!(json_file(&f.project.join(".mcp.json"))["mcpServers"]
        .get("temporary")
        .is_none());
    f.ok(&["mcp", "enable", "temporary", "-t", "claude"]);
    assert_eq!(
        json_file(&f.project.join(".mcp.json"))["mcpServers"]["temporary"]["command"],
        "echo"
    );
    assert!(f
        .fail(&["mcp", "enable", "missing", "-t", "claude"])
        .contains("No saved"));
}

#[cfg(unix)]
#[test]
fn claude_home_uses_native_cli_and_preserves_full_definition() {
    let f = Fixture::new();
    f.providers();
    f.file("home/.claude.json", r#"{"runtimeState":{"keep":true},"mcpServers":{"custom":{"command":"echo","args":["hello"],"customField":42}}}"#);
    f.mock_ok(&["--home", "mcp", "disable", "custom", "-t", "claude"]);
    f.mock_ok(&["--home", "mcp", "enable", "custom", "-t", "claude"]);
    let value = json_file(&f.home.join(".claude.json"));
    assert_eq!(value["mcpServers"]["custom"]["customField"], 42);
    assert_eq!(value["runtimeState"]["keep"], true);
    let calls = fs::read_to_string(f.home.join("calls.jsonl")).unwrap();
    assert!(calls.contains("add-json") && calls.contains("remove"));
    f.file("home/fail-provider", "fail");
    let output = f.mocked(&[
        "--home",
        "mcp",
        "add",
        "another",
        "--command",
        "echo",
        "-t",
        "claude",
    ]);
    assert!(!output.status.success());
    assert!(json_file(&f.home.join(".claude.json"))["mcpServers"]
        .get("another")
        .is_none());
}

#[test]
fn local_recipes_and_validation() {
    let f = Fixture::new();
    let package = f.file(
        "local/package.json",
        r#"{"bin":{"fixture":"bin/server.js"}}"#,
    );
    f.ok(&[
        "-g",
        "mcp",
        "add",
        "local",
        "--local",
        package.parent().unwrap().to_str().unwrap(),
    ]);
    assert_eq!(
        f.json(&["-g", "mcp", "show", "local"])["recipe"]["command"],
        "node"
    );
    f.fail(&[
        "mcp",
        "add",
        "bad",
        "--command",
        "echo",
        "--args",
        "not-json",
        "-t",
        "codex",
    ]);
    assert!(!f.project.join(".codex/config.toml").exists());
    f.fail(&[
        "mcp",
        "add",
        "bad",
        "--url",
        "file:///private",
        "-t",
        "codex",
    ]);
}

#[test]
fn scoped_package_identity_and_legacy_remote_environment() {
    let f = Fixture::new();
    f.ok(&[
        "-g",
        "mcp",
        "add",
        "@scope/server-tools",
        "--env",
        "{\"TOKEN\":\"example\"}",
    ]);
    f.ok(&["mcp", "add", "@scope/server-tools", "-t", "codex,claude"]);
    let status = f.json(&["mcp", "-t", "codex,claude"]);
    assert_eq!(status["totalCount"], 1);
    assert_eq!(status["servers"][0]["name"], "@scope/server-tools");
    assert_eq!(status["servers"][0]["state"]["codex"], "synced");
    f.file(
        "project/.codex/config.toml",
        "[mcp_servers.legacy]\nhttpUrl = 'https://example.com/mcp'\n",
    );
    assert_eq!(
        f.json(&["mcp", "-t", "codex"])["servers"][0]["deployed"]["codex"]["url"],
        "https://example.com/mcp"
    );
    f.fail(&[
        "-g",
        "mcp",
        "add",
        "bad-env",
        "--command",
        "echo",
        "--env",
        "1BAD=value",
    ]);
}
