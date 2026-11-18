mod common;

use common::{json_file, toml_file, Fixture};
use std::fs;

#[cfg(unix)]
#[test]
fn configured_profiles_and_aliases_isolate_claude_codex_and_dsh() {
    let f = Fixture::new();
    f.providers();
    f.file("home/.dsh/profiles/web/cordis.yml", "[]\n");
    f.file("home/.dsh/profiles/headless/cordis.yml", "[]\n");
    f.file(
        "home/.acm/config.toml",
        r#"
[targets.claude-personal]
provider = "claude"
config_dir = "~/.claude-personal"
aliases = ["cp"]

[targets.claude-team]
provider = "claude"
config_dir = "~/.claude"

[targets.codex-team]
provider = "codex"
config_dir = "~/.codex-team"
aliases = ["cxt"]

[targets.dsh-web]
provider = "dsh"
config_dir = "~/.dsh"
profile = "web"
"#,
    );

    f.mock_ok(&[
        "mcp",
        "add",
        "demo",
        "--command",
        "echo",
        "--arg",
        "hello",
        "--home",
        "-t",
        "cp,claude-team,codex,cxt,dsh-web",
    ]);

    assert!(
        json_file(&f.home.join(".claude-personal/.claude.json"))["mcpServers"]
            .get("demo")
            .is_some()
    );
    assert!(json_file(&f.home.join(".claude.json"))["mcpServers"]
        .get("demo")
        .is_some());
    assert_eq!(
        toml_file(&f.home.join(".codex/config.toml"))["mcp_servers"]["demo"]["enabled"],
        true
    );
    assert_eq!(
        toml_file(&f.home.join(".codex-team/config.toml"))["mcp_servers"]["demo"]["enabled"],
        true
    );
    let web_patch = fs::read_to_string(f.home.join(".dsh/profiles/web/cordis.patch.yml")).unwrap();
    assert!(web_patch.contains("serverName: demo"));
    assert!(!f
        .home
        .join(".dsh/profiles/headless/cordis.patch.yml")
        .exists());

    // Disable only on codex-team and dsh-web; codex personal stays enabled.
    f.mock_ok(&[
        "mcp",
        "disable",
        "demo",
        "--home",
        "-t",
        "codex-team,dsh-web",
    ]);
    assert_eq!(
        toml_file(&f.home.join(".codex/config.toml"))["mcp_servers"]["demo"]["enabled"],
        true
    );
    assert_eq!(
        toml_file(&f.home.join(".codex-team/config.toml"))["mcp_servers"]["demo"]["enabled"],
        false
    );
    let web_patch_disabled =
        fs::read_to_string(f.home.join(".dsh/profiles/web/cordis.patch.yml")).unwrap();
    assert!(web_patch_disabled.contains("disabled: true"));

    // Skills deploy cleanly to custom profiles + dsh + agy.
    let skill_dir = f.skill("alpha");
    f.ok(&["skill", "import", skill_dir.to_str().unwrap(), "--catalog"]);
    f.ok(&[
        "skill",
        "add",
        "alpha",
        "--home",
        "-t",
        "claude-personal,codex-team,dsh,agy",
    ]);
    assert!(f
        .home
        .join(".claude-personal/skills/alpha/SKILL.md")
        .exists());
    assert!(f.home.join(".codex-team/skills/alpha/SKILL.md").exists());
    assert!(f.home.join(".dsh/skills/alpha/SKILL.md").exists());
    assert!(f.home.join(".gemini/config/skills/alpha/SKILL.md").exists());
}

#[cfg(unix)]
#[test]
fn environment_overrides_claude_codex_and_dsh_home() {
    let f = Fixture::new();
    f.providers();
    let custom_claude = f.home.join("env-claude");
    let custom_codex = f.home.join("env-codex");
    let custom_dsh = f.home.join("env-dsh");
    fs::create_dir_all(custom_dsh.join("profiles/web")).unwrap();
    fs::write(custom_dsh.join("profiles/web/cordis.yml"), "[]\n").unwrap();

    let mut path_entries = vec![f.temp.path().join("bin")];
    path_entries.extend(std::env::split_paths(&std::env::var_os("PATH").unwrap()));
    let output = f
        .command()
        .env("PATH", std::env::join_paths(path_entries).unwrap())
        .env("CLAUDE_CONFIG_DIR", &custom_claude)
        .env("CODEX_HOME", &custom_codex)
        .env("DSH_HOME", &custom_dsh)
        .args([
            "mcp",
            "add",
            "envprobe",
            "--command",
            "echo",
            "--home",
            "-t",
            "claude,codex,dsh",
            "--json",
        ])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(json_file(&custom_claude.join(".claude.json"))["mcpServers"]
        .get("envprobe")
        .is_some());
    assert!(toml_file(&custom_codex.join("config.toml"))["mcp_servers"]
        .get("envprobe")
        .is_some());
    let patch = fs::read_to_string(custom_dsh.join("profiles/web/cordis.patch.yml")).unwrap();
    assert!(patch.contains("serverName: envprobe"));
}

#[test]
fn dsh_cordis_patch_preserves_existing_entries_js_tags_and_supports_http() {
    let f = Fixture::new();
    f.file("home/.dsh/profiles/headless/cordis.yml", "[]\n");
    f.file(
        "home/.dsh/profiles/web/cordis.patch.yml",
        r#"- id: ui-chat
  name: "@deepseek-ai/dsh-client-ui-chat"
  config:
    transcriptView: standard
- id: custom-js
  name: "@deepseek-ai/dsh-plugin-manager"
  disabled: !!js "!ctx.get('profileContext')"
"#,
    );

    f.ok(&[
        "mcp",
        "add",
        "remote-api",
        "--url",
        "https://example.com/mcp",
        "--home",
        "-t",
        "dsh",
    ]);

    let web_patch = fs::read_to_string(f.home.join(".dsh/profiles/web/cordis.patch.yml")).unwrap();
    let headless_patch =
        fs::read_to_string(f.home.join(".dsh/profiles/headless/cordis.patch.yml")).unwrap();
    assert!(web_patch.contains("@deepseek-ai/dsh-client-ui-chat"));
    assert!(web_patch.contains("!!js"), "web_patch:\n{web_patch}");
    assert!(web_patch.contains("transport: streamable-http"));
    assert!(web_patch.contains("url: https://example.com/mcp"));
    assert!(headless_patch.contains("serverName: remote-api"));

    let listed = f.json(&["mcp", "list", "--home", "-t", "dsh"]);
    assert_eq!(listed["servers"][0]["name"], "remote-api");
    assert_eq!(listed["servers"][0]["state"]["dsh"], "synced");

    f.ok(&["mcp", "remove", "remote-api", "--home", "-t", "dsh"]);
    let after_remove =
        fs::read_to_string(f.home.join(".dsh/profiles/web/cordis.patch.yml")).unwrap();
    assert!(!after_remove.contains("remote-api"));
    assert!(after_remove.contains("@deepseek-ai/dsh-client-ui-chat"));
}

#[cfg(unix)]
#[test]
fn dsh_plugin_install_verify_and_remove() {
    let f = Fixture::new();
    f.providers();
    f.file("home/.dsh/profiles/web/cordis.yml", "[]\n");
    f.file(
        "sources/my-dsh-plugin/package.json",
        r#"{"name":"@example/dsh-probe","version":"1.0.0"}"#,
    );
    f.file(
        "sources/my-dsh-plugin/plugin.json",
        r#"{"name":"my-dsh-plugin","version":"1.0.0","description":"DSH plugin"}"#,
    );
    f.file(
        "sources/my-dsh-plugin/skills/helper/SKILL.md",
        "---\nname: helper\ndescription: Helper skill for dsh plugin.\n---\n",
    );

    let src = f.temp.path().join("sources/my-dsh-plugin");
    f.ok(&[
        "plugin",
        "import",
        src.to_str().unwrap(),
        "--as",
        "my-dsh-plugin",
    ]);
    let status = f.mock_ok(&["plugin", "install", "my-dsh-plugin", "--home", "-t", "dsh"]);
    assert_eq!(status["targets"][0], "dsh");

    let calls = fs::read_to_string(f.home.join("calls.jsonl")).unwrap();
    assert!(calls.contains("\"dsh\", \"plugin\", \"--profile\", \"web\", \"add\""));

    // Simulate pnpm updating package.json dependencies in the dsh profile.
    f.file(
        "home/.dsh/profiles/web/package.json",
        r#"{"name":"web","dependencies":{"@example/dsh-probe":"1.0.0"}}"#,
    );
    let verified = f.json(&["plugin", "verify", "my-dsh-plugin", "--home", "-t", "dsh"]);
    assert_eq!(verified["plugins"][0]["targets"][0]["state"], "installed");

    f.mock_ok(&["plugin", "remove", "my-dsh-plugin", "--home", "-t", "dsh"]);
    let calls_after = fs::read_to_string(f.home.join("calls.jsonl")).unwrap();
    assert!(calls_after.contains(
        "\"dsh\", \"plugin\", \"--profile\", \"web\", \"remove\", \"@example/dsh-probe\""
    ));
}
