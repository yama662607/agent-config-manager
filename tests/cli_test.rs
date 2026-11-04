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

#[test]
fn native_home_overrides_isolate_mcp_and_delegate_claude() {
    let f = Fixture::new();
    let bin = f.providers();
    let mut paths = vec![bin];
    paths.extend(std::env::split_paths(&std::env::var_os("PATH").unwrap()));
    let claude_home = f.temp.path().join("alternate-claude");
    let codex_home = f.temp.path().join("alternate-codex");
    for (target, variable, dir) in [
        ("claude", "CLAUDE_CONFIG_DIR", &claude_home),
        ("codex", "CODEX_HOME", &codex_home),
    ] {
        let output = f
            .command()
            .env("PATH", std::env::join_paths(&paths).unwrap())
            .env(variable, dir)
            .args([
                "--home",
                "mcp",
                "add",
                "fixture",
                "--command",
                "echo",
                "-t",
                target,
            ])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    assert_eq!(
        json_file(&claude_home.join(".claude.json"))["mcpServers"]["fixture"]["command"],
        "echo"
    );
    assert!(fs::read_to_string(codex_home.join("config.toml"))
        .unwrap()
        .contains("fixture"));
    assert!(!f.home.join(".claude.json").exists());
    assert!(!f.home.join(".codex/config.toml").exists());
    let calls = fs::read_to_string(f.home.join("calls.jsonl")).unwrap();
    assert!(calls.contains("add-json"));
}

#[test]
fn profiles_isolate_mcp_targets_and_all_includes_them() {
    let f = Fixture::new();
    let bin = f.providers();
    let mut paths = vec![bin];
    paths.extend(std::env::split_paths(&std::env::var_os("PATH").unwrap()));
    write(
        &f.home.join(".acm/config.toml"),
        r#"
[[profiles]]
id = "claude-personal"
provider = "claude"
display_name = "Claude Personal"
short_code = "cp"
tui_key = "P"
home_dir = "~/.claude-personal"
[[profiles]]
id = "codex-team"
provider = "codex"
display_name = "Codex Team"
short_code = "xt"
tui_key = "T"
home_dir = "~/.codex-team"
"#,
    );
    for target in ["claude-personal", "codex-team"] {
        let output = f
            .command()
            .env("PATH", std::env::join_paths(&paths).unwrap())
            .args([
                "--home",
                "mcp",
                "add",
                "sample",
                "--command",
                "echo",
                "-t",
                target,
            ])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{target}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    assert_eq!(
        json_file(&f.home.join(".claude-personal/.claude.json"))["mcpServers"]["sample"]["command"],
        "echo"
    );
    assert!(fs::read_to_string(f.home.join(".codex-team/config.toml"))
        .unwrap()
        .contains("sample"));
    assert!(!f.home.join(".claude.json").exists());
    assert!(!f.home.join(".codex/config.toml").exists());
    let output = f
        .command()
        .args(["--home", "--json", "mcp", "list", "-t", "all"])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(
        text.contains("claude-personal") && text.contains("codex-team"),
        "{text}"
    );
}

#[test]
fn external_profile_skill_and_doctor_use_the_configured_directory() {
    let f = Fixture::new();
    let external = f.temp.path().join("outside-home");
    write(
        &f.home.join(".acm/config.toml"),
        &format!(
            r#"
[[profiles]]
id = "codex-team"
provider = "codex"
display_name = "Codex Team"
short_code = "xt"
tui_key = "T"
home_dir = {:?}
"#,
            external.display().to_string()
        ),
    );
    let source = f.skill("fixture").join("SKILL.md");
    let output = f
        .command()
        .args([
            "--home",
            "skill",
            "add",
            "fixture",
            "--file",
            source.to_str().unwrap(),
            "--no-register",
            "--copy",
            "-t",
            "codex-team",
        ])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(external.join("skills/fixture/SKILL.md").is_file());
    assert!(!f.home.join(".codex/skills/fixture").exists());
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(external.join("missing"), external.join("skills/dangling"))
            .unwrap();
        let output = f
            .command()
            .args(["--home", "--json", "doctor"])
            .output()
            .unwrap();
        let report = String::from_utf8(output.stdout).unwrap();
        assert!(report.contains("dangling"), "{report}");
        let output = f
            .command()
            .args(["--home", "doctor", "--fix"])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(fs::symlink_metadata(external.join("skills/dangling")).is_err());
    }
}

#[test]
fn project_skill_operations_deduplicate_shared_provider_paths() {
    let f = Fixture::new();
    f.file(
        "home/.acm/config.toml",
        r#"
[[profiles]]
id = "codex-team"
provider = "codex"
display_name = "Codex Team"
short_code = "xt"
tui_key = "T"
home_dir = "~/.codex-team"
"#,
    );
    let source = f.skill("fixture").join("SKILL.md");
    let output = f
        .command()
        .args([
            "--json",
            "skill",
            "add",
            "fixture",
            "--file",
            source.to_str().unwrap(),
            "--no-register",
            "--copy",
            "-t",
            "codex,codex-team",
        ])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(f.project.join(".codex/skills/fixture/SKILL.md").is_file());
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["results"].as_array().unwrap().len(), 1);
    assert!(!f.home.join(".codex-team/skills/fixture").exists());
}

#[test]
fn overlapping_profile_selection_fails_before_mutation() {
    let f = Fixture::new();
    f.file(
        "home/.acm/config.toml",
        r#"
[[profiles]]
id = "claude-personal"
provider = "claude"
display_name = "Claude Personal"
short_code = "cp"
tui_key = "P"
home_dir = "~/.shared"
"#,
    );
    let output = f
        .command()
        .env("CLAUDE_CONFIG_DIR", f.home.join(".shared"))
        .args([
            "--home",
            "mcp",
            "add",
            "fixture",
            "--command",
            "echo",
            "-t",
            "claude,claude-personal",
        ])
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("share the same home"));
    assert!(!f.home.join(".shared").exists());
    assert!(fs::read_dir(&f.catalog).unwrap().next().is_none());
}

#[test]
fn claude_custom_mcp_path_is_rejected_by_preview_and_mutation() {
    let f = Fixture::new();
    f.providers();
    f.file(
        "home/.acm/config.toml",
        r#"
[[profiles]]
id = "claude-custom"
provider = "claude"
display_name = "Claude Custom"
short_code = "cc"
tui_key = "C"
home_dir = "~/.claude-custom"
mcp_config = "~/.custom-mcp.json"
"#,
    );
    for preview in [false, true] {
        let mut cmd = f.command();
        cmd.args([
            "--home",
            "mcp",
            "add",
            "fixture",
            "--command",
            "echo",
            "-t",
            "claude-custom",
        ]);
        if preview {
            cmd.arg("--dry-run");
        }
        let out = cmd.output().unwrap();
        assert!(!out.status.success());
        assert!(String::from_utf8_lossy(&out.stderr).contains("Claude CLI cannot select"));
    }
    assert!(!f.home.join(".custom-mcp.json").exists());
    assert!(!f.home.join(".claude-custom").exists());
    assert!(!f.home.join("calls.jsonl").exists());
}

#[test]
fn profile_default_targets_apply_without_explicit_target_option() {
    let f = Fixture::new();
    f.file(
        "home/.acm/config.toml",
        r#"
default_targets = ["codex-team"]
[[profiles]]
id = "codex-team"
provider = "codex"
display_name = "Codex Team"
short_code = "xt"
tui_key = "T"
home_dir = "~/.codex-team"
"#,
    );
    let result = f
        .command()
        .args(["--home", "mcp", "add", "fixture", "--command", "echo"])
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    assert!(fs::read_to_string(f.home.join(".codex-team/config.toml"))
        .unwrap()
        .contains("fixture"));
    assert!(!f.home.join(".codex/config.toml").exists());
    assert!(!f.home.join(".claude.json").exists());
}

#[cfg(unix)]
#[test]
fn doctor_repairs_profile_plugin_and_skill_links() {
    use std::os::unix::fs::symlink;
    let f = Fixture::new();
    f.file(
        "home/.acm/config.toml",
        r#"
[[profiles]]
id = "claude-personal"
provider = "claude"
display_name = "Claude Personal"
short_code = "cp"
tui_key = "P"
home_dir = "~/.claude-personal"
"#,
    );
    for dir in ["skills", "plugins"] {
        let parent = f.home.join(".claude-personal").join(dir);
        fs::create_dir_all(&parent).unwrap();
        symlink(f.temp.path().join("missing"), parent.join("broken")).unwrap();
    }
    let out = f
        .command()
        .args(["doctor", "--fix", "--json"])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let report: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(report["fixed_count"], 2);
    for dir in ["skills", "plugins"] {
        assert!(
            fs::symlink_metadata(f.home.join(".claude-personal").join(dir).join("broken")).is_err()
        );
    }
}

#[test]
fn unsupported_claude_disable_does_not_create_a_saved_definition() {
    let f = Fixture::new();
    f.file(
        "home/.acm/config.toml",
        r#"
[[profiles]]
id = "claude-custom"
provider = "claude"
display_name = "Claude Custom"
short_code = "cc"
tui_key = "C"
home_dir = "~/.claude-custom"
mcp_config = "~/.custom-mcp.json"
"#,
    );
    let config = f.file(
        "home/.custom-mcp.json",
        r#"{"mcpServers":{"fixture":{"command":"echo"}}}"#,
    );
    let before = fs::read(&config).unwrap();
    let out = f
        .command()
        .args(["--home", "mcp", "disable", "fixture", "-t", "claude-custom"])
        .output()
        .unwrap();
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("Claude CLI cannot select"));
    assert_eq!(fs::read(&config).unwrap(), before);
    let home_entries: Vec<_> = fs::read_dir(&f.home)
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert_eq!(home_entries.len(), 2, "unexpected files: {home_entries:?}");
}

#[test]
fn all_distributes_to_builtins_and_profiles() {
    let f = Fixture::new();
    let bin = f.providers();
    f.file(
        "home/.acm/config.toml",
        r#"
[[profiles]]
id = "claude-personal"
provider = "claude"
display_name = "Claude Personal"
short_code = "cp"
tui_key = "P"
home_dir = "~/.claude-personal"
[[profiles]]
id = "codex-team"
provider = "codex"
display_name = "Codex Team"
short_code = "xt"
tui_key = "T"
home_dir = "~/.codex-team"
"#,
    );
    let mut paths = vec![bin];
    paths.extend(std::env::split_paths(&std::env::var_os("PATH").unwrap()));
    let output = f
        .command()
        .env("PATH", std::env::join_paths(paths).unwrap())
        .args([
            "--home",
            "--json",
            "mcp",
            "add",
            "fixture",
            "--command",
            "echo",
            "-t",
            "all",
        ])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let report: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["results"].as_array().unwrap().len(), 7);
    for path in [
        ".claude.json",
        ".claude-personal/.claude.json",
        ".codex/config.toml",
        ".codex-team/config.toml",
        ".gemini/config/mcp_config.json",
        ".grok/config.toml",
        ".dsh/cordis.patch.yml",
    ] {
        assert!(f.home.join(path).is_file(), "missing {path}");
    }
}
