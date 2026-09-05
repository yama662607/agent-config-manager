mod common;
use common::*;
use std::fs;
fn source(f: &Fixture) -> std::path::PathBuf {
    f.file("plugin/.claude-plugin/plugin.json", r#"{"name":"fixture-plugin","version":"1.0.0","interface":{"displayName":"Useful plugin","capabilities":["tools"]},"futureField":{"keep":true}}"#);
    f.file(
        "plugin/skills/alpha/SKILL.md",
        "---\nname: alpha\ndescription: Complete plugin skill with files.\n---\n",
    );
    f.file(
        "plugin/skills/alpha/scripts/run.sh",
        "#!/bin/sh\necho alpha\n",
    );
    f.file("plugin/commands/command.md", "A command");
    f.file("plugin/hooks/hooks.json", r#"{"hooks":{}}"#);
    f.file(
        "plugin/.mcp.json",
        r#"{"mcpServers":{"test":{"command":"echo","args":["fixture"],"customField":42}}}"#,
    );
    f.temp.path().join("plugin")
}
#[test]
fn complete_import_conversion_and_snapshot() {
    let f = Fixture::new();
    let source = source(&f);
    f.ok(&[
        "plugin",
        "import",
        source.to_str().unwrap(),
        "--as",
        "alias",
    ]);
    assert!(f
        .catalog
        .join("plugins/alias/skills/alpha/scripts/run.sh")
        .is_file());
    f.ok(&["plugin", "convert", "alias", "--assemble-only"]);
    let path = f.catalog.join("marketplace/plugins/alias");
    for name in [
        ".codex-plugin/plugin.json",
        ".claude-plugin/plugin.json",
        ".grok-plugin/plugin.json",
        "plugin.json",
        "commands/command.md",
        "hooks/hooks.json",
        "skills/alpha/scripts/run.sh",
    ] {
        assert!(path.join(name).is_file(), "{name}");
    }
    let manifest = json_file(&path.join(".codex-plugin/plugin.json"));
    assert_eq!(manifest["name"], "alias");
    assert_eq!(manifest["futureField"]["keep"], true);
    assert_eq!(
        json_file(&path.join(".mcp.json"))["mcpServers"]["test"]["customField"],
        42
    );
    assert!(!source.join("plugin.json").exists());
    f.ok(&["plugin", "snapshot"]);
    let diff = f.json(&["plugin", "scan", "--diff"]);
    assert!(diff["added"].as_array().unwrap().is_empty());
    assert!(diff["changed"].as_array().unwrap().is_empty());
}
#[cfg(unix)]
#[test]
fn native_lifecycle_calls_providers_and_propagates_failures() {
    let f = Fixture::new();
    f.providers();
    let source = source(&f);
    f.ok(&["plugin", "import", source.to_str().unwrap()]);
    let status = f.mock_ok(&["plugin", "install", "fixture-plugin", "-t", "all"]);
    assert_eq!(status["targets"].as_array().unwrap().len(), 4);
    let calls = fs::read_to_string(f.home.join("calls.jsonl")).unwrap();
    assert!(calls.contains("\"codex\", \"plugin\", \"add\", \"fixture-plugin@acm-catalog\""));
    assert!(calls.contains("--trust"));
    assert!(
        !f.home.join(".codex/skills/alpha").exists(),
        "Native install must not independently inject extracted skills"
    );
    f.mock_ok(&["plugin", "remove", "fixture-plugin", "-t", "all"]);
    assert_eq!(
        f.json(&["plugin", "show", "fixture-plugin"])["plugin"]["enabled"],
        false
    );
    f.file("home/fail-provider", "fail");
    assert!(!f
        .mocked(&["plugin", "install", "fixture-plugin", "-t", "codex"])
        .status
        .success());
    assert_eq!(
        f.json(&["plugin", "show", "fixture-plugin"])["plugin"]["enabled"],
        false
    );
    assert!(f
        .fail(&[
            "plugin",
            "install",
            "fixture-plugin",
            "--project",
            "-t",
            "codex"
        ])
        .contains("scope"));
}
#[cfg(unix)]
#[test]
fn source_update_and_legacy_extracted_skill_payload() {
    let f = Fixture::new();
    f.providers();
    let source = source(&f);
    f.ok(&["plugin", "import", source.to_str().unwrap()]);
    f.mock_ok(&["plugin", "install", "fixture-plugin", "-t", "codex"]);
    f.file(
        "plugin/skills/beta/SKILL.md",
        "---\nname: beta\ndescription: New upstream skill\n---\n",
    );
    let updated = f.mock_ok(&["plugin", "update", "fixture-plugin", "-t", "codex"]);
    assert_eq!(updated[0]["updated"], true);
    assert!(f
        .catalog
        .join("marketplace/plugins/fixture-plugin/skills/beta/SKILL.md")
        .is_file());
    fs::remove_dir_all(f.catalog.join("plugins/fixture-plugin/skills/alpha")).unwrap();
    // Simulate old TypeScript layouts that extracted skills to the central catalog.
    fs::remove_file(f.catalog.join("skills/alpha")).unwrap();
    f.file(
        "catalog/skills/alpha/SKILL.md",
        "---\nname: alpha\ndescription: Legacy extracted skill\n---\n",
    );
    f.file("catalog/skills/alpha/scripts/legacy.sh", "echo legacy");
    f.ok(&["plugin", "convert", "fixture-plugin", "--assemble-only"]);
    assert!(f
        .catalog
        .join("marketplace/plugins/fixture-plugin/skills/alpha/scripts/legacy.sh")
        .is_file());
}
#[test]
fn discovery_and_repair_preserve_existing_payload() {
    let f = Fixture::new();
    let source = source(&f);
    let discovered = f.json(&[
        "plugin",
        "discover",
        "--root",
        source.to_str().unwrap(),
        "--import",
    ]);
    assert_eq!(discovered[0]["name"], "fixture-plugin");
    fs::remove_file(
        f.catalog
            .join("plugins/fixture-plugin/skills/alpha/scripts/run.sh"),
    )
    .unwrap();
    f.file(
        "catalog/plugins/fixture-plugin/commands/command.md",
        "local edit",
    );
    f.ok(&["plugin", "repair"]);
    assert!(!f
        .catalog
        .join("plugins/fixture-plugin/skills/alpha/scripts/run.sh")
        .exists());
    f.ok(&["plugin", "repair", "--apply"]);
    assert!(f
        .catalog
        .join("plugins/fixture-plugin/skills/alpha/scripts/run.sh")
        .is_file());
    assert_eq!(
        fs::read_to_string(f.catalog.join("plugins/fixture-plugin/commands/command.md")).unwrap(),
        "local edit"
    );
}

#[test]
fn moved_application_source_and_downgrade_guard() {
    let f = Fixture::new();
    f.file(
        "home/.acm/config.toml",
        "discovery_roots = ['~/Applications']\n",
    );
    let bundle = f.home.join("Applications/Fixture.app");
    let old = bundle.join("Contents/Resources/plugins/old");
    write(
        &old.join(".claude-plugin/plugin.json"),
        r#"{"name":"movable","version":"2.0"}"#,
    );
    write(
        &bundle.join("Contents/Info.plist"),
        "<key>CFBundleShortVersionString</key><string>2.0</string>",
    );
    f.ok(&[
        "plugin",
        "import",
        old.to_str().unwrap(),
        "--as",
        "qualified",
    ]);
    fs::remove_dir_all(&old).unwrap();
    let new = bundle.join("Contents/Resources/plugins/new");
    write(
        &new.join(".claude-plugin/plugin.json"),
        r#"{"name":"movable","version":"3.0"}"#,
    );
    write(&new.join("commands/new.md"), "new command");
    write(
        &bundle.join("Contents/Info.plist"),
        "<key>CFBundleShortVersionString</key><string>3.0</string>",
    );
    f.ok(&["plugin", "update", "qualified", "--dry-run"]);
    assert!(!f.catalog.join("plugins/qualified/commands/new.md").exists());
    f.ok(&["plugin", "update", "qualified"]);
    assert!(f
        .catalog
        .join("plugins/qualified/commands/new.md")
        .is_file());
    assert_eq!(
        f.json(&["plugin", "show", "qualified"])["metadata"]["sourceAppVersion"],
        "3.0"
    );
    write(
        &bundle.join("Contents/Info.plist"),
        "<key>CFBundleShortVersionString</key><string>1.0</string>",
    );
    assert!(f.fail(&["plugin", "update", "qualified"]).contains("older"));
}

#[cfg(unix)]
#[test]
fn catalog_scope_never_installs_providers_and_removal_keeps_source() {
    let f = Fixture::new();
    f.providers();
    let source = source(&f);
    f.ok(&["plugin", "import", source.to_str().unwrap()]);
    let output = f.mocked(&["--catalog", "plugin", "install", "fixture-plugin"]);
    assert!(!output.status.success());
    assert!(!f.home.join("calls.jsonl").exists());
    f.mock_ok(&["--catalog", "plugin", "convert", "fixture-plugin"]);
    assert!(!f.home.join("calls.jsonl").exists());
    f.ok(&["--catalog", "plugin", "remove", "fixture-plugin"]);
    assert!(source.join("skills/alpha/SKILL.md").is_file());
    assert!(!f.catalog.join("plugins/fixture-plugin").exists());
    assert!(fs::symlink_metadata(f.catalog.join("skills/alpha")).is_err());
}
