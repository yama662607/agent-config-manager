mod common;
use agent_config_manager::core::operations::{redact_text, redact_value};
use common::*;
use serde_json::{json, Value};
use std::fs;

#[test]
fn json_failures_are_single_documents_and_verbose_keeps_stdout_clean() {
    let f = Fixture::new();
    for args in [
        vec!["--json", "--unknown-option"],
        vec!["mcp", "show", "absent", "--json"],
        vec!["doctor", "--strict", "--json"],
    ] {
        if args[0] == "doctor" {
            f.file("project/.codex/config.toml", "this is invalid toml[");
        }
        let output = f.run(&args);
        assert!(!output.status.success());
        let value: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(value["ok"], false);
        assert!(value["error"]["code"].is_string());
    }
    let output = f.run(&["--catalog", "mcp", "list", "--json", "--verbose"]);
    assert!(output.status.success());
    assert!(serde_json::from_slice::<Value>(&output.stdout)
        .unwrap()
        .is_array());
    assert!(String::from_utf8_lossy(&output.stderr).contains("scope=catalog"));
}

#[test]
fn credentials_are_redacted_without_relying_on_known_token_prefixes() {
    let value = json!({"recipe":{"env":{"NORMAL":"arbitrary-private-value"},"args":["--token","arbitrary-private-value","--api-key=arbitrary-private-value"],"apiKey":"arbitrary-private-value","api-key":"arbitrary-private-value"}});
    assert!(!redact_value(&value)
        .to_string()
        .contains("arbitrary-private-value"));
    for text in [
        r#"{"token":"arbitrary-private-value"}"#,
        r#"password="arbitrary private value""#,
        "--token arbitrary-private-value",
        "https://example.test/mcp?apiKey=arbitrary-private-value",
    ] {
        let text = redact_text(text);
        assert!(!text.contains("arbitrary-private-value"), "{text}");
        assert!(!text.contains("arbitrary private value"), "{text}");
    }
    assert!(!redact_text(
        r#"provider failed: {"env":{"INTERNAL_SETTING":"arbitrary-private-value"}}"#
    )
    .contains("arbitrary-private-value"));
}

#[test]
fn transport_differences_update_and_missing_disable_preview_fails() {
    let f = Fixture::new();
    f.ok(&[
        "mcp",
        "add",
        "remote",
        "--url",
        "https://example.test/mcp",
        "--catalog",
    ]);
    let catalog = f.catalog.join("catalog.toml");
    let text = fs::read_to_string(&catalog)
        .unwrap()
        .replace("transport = \"http\"", "transport = \"sse\"");
    fs::write(catalog, text).unwrap();
    f.file(
        "project/.mcp.json",
        r#"{"mcpServers":{"remote":{"type":"http","url":"https://example.test/mcp"}}}"#,
    );
    assert_eq!(
        f.json(&["mcp", "list", "--targets", "claude"])["servers"][0]["state"]["claude"],
        "differs"
    );
    f.ok(&["mcp", "update", "remote", "--targets", "claude"]);
    assert_eq!(
        json_file(&f.project.join(".mcp.json"))["mcpServers"]["remote"]["type"],
        "sse"
    );
    let output = f.run(&[
        "mcp",
        "disable",
        "absent",
        "--targets",
        "codex",
        "--dry-run",
        "--json",
    ]);
    assert!(!output.status.success());
    assert_eq!(
        serde_json::from_slice::<Value>(&output.stdout).unwrap()["ok"],
        false
    );
}

#[test]
fn ambiguous_package_alias_is_not_adopted_over_an_existing_tenant() {
    let f = Fixture::new();
    f.ok(&[
        "mcp",
        "add",
        "tenant-a",
        "--from-package",
        "@org/pkg",
        "--env",
        "TENANT=a",
        "--catalog",
    ]);
    f.ok(&[
        "mcp",
        "add",
        "tenant-b",
        "--from-package",
        "@org/pkg",
        "--env",
        "TENANT=b",
        "--catalog",
    ]);
    f.file("project/.mcp.json",r#"{"mcpServers":{"custom":{"command":"npx","args":["-y","@org/pkg"],"env":{"TENANT":"other"}}}}"#);
    let status = f.json(&["mcp", "list", "--targets", "claude"]);
    assert_eq!(status["servers"][0]["name"], "custom");
    assert_eq!(status["servers"][0]["source"], "inline");
    let before = fs::read(f.project.join(".mcp.json")).unwrap();
    f.ok(&["mcp", "update", "--targets", "claude"]);
    assert_eq!(fs::read(f.project.join(".mcp.json")).unwrap(), before);
    f.ok(&["mcp", "adopt", "custom", "--targets", "claude"]);
    assert_eq!(
        f.json(&["mcp", "show", "tenant-a", "--catalog"])["recipe"]["env"]["TENANT"],
        "a"
    );
    assert_eq!(
        f.json(&["mcp", "show", "custom", "--catalog"])["recipe"]["env"]["TENANT"],
        "other"
    );
}

#[test]
fn plain_markdown_force_matches_preview_and_preserves_backup() {
    let f = Fixture::new();
    let file = f.file("ordinary.md", "# original");
    f.ok(&[
        "skill",
        "add",
        "plain",
        "--file",
        file.to_str().unwrap(),
        "--no-register",
        "--targets",
        "codex",
    ]);
    fs::write(&file, "# replacement").unwrap();
    let args = [
        "skill",
        "add",
        "plain",
        "--file",
        file.to_str().unwrap(),
        "--no-register",
        "--targets",
        "codex",
        "--force",
    ];
    let mut preview = args.to_vec();
    preview.push("--dry-run");
    assert_eq!(f.json(&preview)["blocked"], false);
    assert_eq!(f.json(&args)["results"][0]["status"], "success");
    assert_eq!(
        fs::read_to_string(f.project.join(".codex/skills/plain/SKILL.md")).unwrap(),
        "# replacement"
    );
}

#[test]
fn mcp_dry_run_reports_changes_and_never_writes() {
    let f = Fixture::new();
    let value = f.json(&[
        "mcp",
        "add",
        "example",
        "--command",
        "echo",
        "--env",
        "TOKEN=arbitrary-private-value",
        "--arg=--token",
        "--arg=arbitrary-private-value",
        "--targets",
        "codex",
        "--dry-run",
    ]);
    assert_eq!(value["dryRun"], true);
    assert_eq!(value["changes"].as_array().unwrap().len(), 2);
    assert!(!value.to_string().contains("arbitrary-private-value"));
    assert!(!f.project.join(".codex").exists());
    assert!(fs::read_dir(&f.catalog).unwrap().next().is_none());
    assert!(fs::read_dir(&f.home).unwrap().next().is_none());
    f.ok(&[
        "mcp",
        "add",
        "example",
        "--command",
        "echo",
        "--targets",
        "codex",
    ]);
    let path = f.project.join(".codex/config.toml");
    let before = fs::read(&path).unwrap();
    let value = f.json(&[
        "mcp",
        "edit",
        "example",
        "--args",
        "[\"changed\"]",
        "--targets",
        "codex",
        "--dry-run",
    ]);
    assert_eq!(value["changes"][0]["changed"], true);
    assert_eq!(fs::read(path).unwrap(), before);
}

#[cfg(unix)]
#[test]
fn mcp_partial_failure_preserves_success_and_identifies_retry_target() {
    let f = Fixture::new();
    f.providers();
    f.file("home/fail-provider", "");
    let output = f.mocked(&[
        "mcp",
        "add",
        "partial",
        "--command",
        "echo",
        "--targets",
        "codex,claude",
        "--home",
        "--json",
    ]);
    assert!(!output.status.success());
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["results"][0]["target"], "codex");
    assert_eq!(report["results"][0]["status"], "success");
    assert_eq!(report["results"][1]["status"], "failed");
    assert_eq!(report["retryTargets"], json!(["claude"]));
    assert!(toml_file(&f.home.join(".codex/config.toml"))["mcp_servers"]["partial"].is_object());
}

#[test]
fn skill_update_cli_dry_run_and_restore_are_scoped() {
    let f = Fixture::new();
    let source = f.skill("preview");
    f.ok(&["skill", "import", source.to_str().unwrap(), "--catalog"]);
    f.ok(&["skill", "add", "preview", "--targets", "codex"]);
    write(
        &f.catalog.join("skills/preview/scripts/run.sh"),
        "#!/bin/sh\necho updated\n",
    );
    let dest = f.project.join(".codex/skills/preview/scripts/run.sh");
    let before = fs::read(&dest).unwrap();
    let plan = f.json(&[
        "skill",
        "update",
        "preview",
        "--targets",
        "codex",
        "--dry-run",
    ]);
    assert_eq!(plan["dryRun"], true);
    assert_eq!(fs::read(&dest).unwrap(), before);
    let result = f.json(&["skill", "update", "preview", "--targets", "codex"]);
    assert_eq!(result["results"][0]["status"], "success");
    assert!(String::from_utf8(fs::read(dest).unwrap())
        .unwrap()
        .contains("updated"));
    let backups = f.json(&["skill", "backups", "preview", "--targets", "codex"]);
    assert!(backups.to_string().contains("backup"));
}

#[test]
fn invalid_mcp_batch_is_rejected_before_writes_and_preview_detects_collisions() {
    let f = Fixture::new();
    for id in ["alpha", "beta"] {
        f.ok(&[
            "mcp",
            "add",
            id,
            "--command",
            "echo",
            "--arg=new",
            "--targets",
            "codex",
        ]);
    }
    let path = f.project.join(".codex/config.toml");
    let before = fs::read_to_string(&path).unwrap().replace("new", "old");
    fs::write(&path, &before).unwrap();
    let catalog = f.catalog.join("catalog.toml");
    let mut value = toml_file(&catalog);
    value["mcps"]["beta"]["recipe"]["url"] = json!("https://example.test/mcp");
    fs::write(&catalog, toml::to_string_pretty(&value).unwrap()).unwrap();
    for dry in [false, true] {
        let mut args = vec!["mcp", "update", "--targets", "codex", "--json"];
        if dry {
            args.push("--dry-run");
        }
        let output = f.run(&args);
        assert!(!output.status.success());
        assert_eq!(fs::read_to_string(&path).unwrap(), before);
    }
    f.file(
        "project/.mcp.json",
        r#"{"mcpServers":{"a_b":{"command":"npx","args":["-y","a/b"]}}}"#,
    );
    for dry in [false, true] {
        let mut args = vec!["mcp", "add", "a_b", "--targets", "claude", "--json"];
        if dry {
            args.push("--dry-run");
        }
        // An exact existing name is an explicit replacement, so use a different name with the same sanitized key.
        args[2] = "a@b";
        let output = f.run(&args);
        assert!(
            !output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stdout)
        );
    }
}

#[cfg(unix)]
#[test]
fn provider_echo_of_escaped_environment_is_redacted() {
    use std::os::unix::fs::PermissionsExt;
    let f = Fixture::new();
    let provider = f.file(
        "echo-provider",
        "#!/bin/sh\nprintf '%s\\n' \"$@\" >&2\nexit 19\n",
    );
    fs::set_permissions(&provider, fs::Permissions::from_mode(0o755)).unwrap();
    let secret = "unusual-private-start\n\"private-end";
    let env = json!({"NORMAL":secret}).to_string();
    let output = f
        .command()
        .env("ACM_CLAUDE_BIN", provider)
        .args([
            "mcp",
            "add",
            "private",
            "--command",
            "echo",
            "--env",
            &env,
            "--home",
            "--targets",
            "claude",
            "--json",
        ])
        .output()
        .unwrap();
    assert!(!output.status.success());
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["ok"], false);
    for output in [&output.stdout, &output.stderr] {
        let text = String::from_utf8_lossy(output);
        assert!(!text.contains("unusual-private-start"), "{text}");
        assert!(!text.contains("private-end"), "{text}");
    }
}

#[cfg(unix)]
#[test]
fn mcp_batch_provider_failure_retains_successful_resource_results() {
    let f = Fixture::new();
    let bin = f.providers();
    for id in ["alpha", "beta"] {
        f.ok(&[
            "mcp",
            "add",
            id,
            "--command",
            "echo",
            "--arg=new",
            "--catalog",
        ]);
    }
    f.file("home/.claude.json",r#"{"mcpServers":{"alpha":{"command":"echo","args":["old"]},"beta":{"command":"echo","args":["old"]}}}"#);
    let provider = bin.join("claude");
    let script=fs::read_to_string(&provider).unwrap().replace("if (home / 'fail-provider').exists():","if (home / 'fail-provider').exists() or (len(args)>2 and args[1]=='add-json' and args[2]=='beta'):");
    fs::write(provider, script).unwrap();
    let output = f.mocked(&["mcp", "update", "--home", "--targets", "claude", "--json"]);
    assert!(!output.status.success());
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    let details = &report["results"][0]["detail"];
    assert_eq!(details["results"][0]["resource"], "alpha");
    assert_eq!(details["results"][0]["status"], "success");
    assert_eq!(details["retryResources"], json!(["beta"]));
    assert_eq!(
        json_file(&f.home.join(".claude.json"))["mcpServers"]["alpha"]["args"],
        json!(["new"])
    );
}

#[test]
fn sanitized_mcp_alias_cannot_mutate_another_package() {
    let f = Fixture::new();
    for id in ["@left/server-tool", "@right/server-tool"] {
        f.ok(&["mcp", "add", id, "--catalog"]);
    }
    let path = f.file(
        "project/.codex/config.toml",
        "[mcp_servers.tool]\ncommand = 'npx'\nargs = ['-y', '@right/server-tool']\n",
    );
    let before = fs::read(&path).unwrap();
    for action in ["remove", "disable", "enable", "edit"] {
        for dry in [false, true] {
            let mut args = vec![
                "mcp",
                action,
                "@left/server-tool",
                "--targets",
                "codex",
                "--json",
            ];
            if dry {
                args.push("--dry-run");
            }
            let output = f.run(&args);
            assert!(!output.status.success(), "{args:?}");
            assert_eq!(fs::read(&path).unwrap(), before);
        }
    }
    f.ok(&["mcp", "remove", "tool", "--targets", "codex"]);
    assert!(toml_file(&path)["mcp_servers"]["tool"].is_null());
}

#[test]
fn ambiguous_url_mcp_alias_requires_an_exact_native_key() {
    let f = Fixture::new();
    f.ok(&[
        "mcp",
        "add",
        "@left/api",
        "--url",
        "https://left.test/mcp",
        "--catalog",
    ]);
    f.ok(&[
        "mcp",
        "add",
        "@right/api",
        "--url",
        "https://right.test/mcp",
        "--catalog",
    ]);
    for url in ["https://right.test/mcp", "https://locally-edited.test/mcp"] {
        let path = f.file(
            "project/.codex/config.toml",
            &format!("[mcp_servers.api]\nurl = '{url}'\n"),
        );
        let before = fs::read(&path).unwrap();
        for dry in [false, true] {
            let mut args = vec!["mcp", "remove", "@left/api", "--targets", "codex", "--json"];
            if dry {
                args.push("--dry-run");
            }
            assert!(!f.run(&args).status.success());
            assert_eq!(fs::read(&path).unwrap(), before);
        }
    }
}
