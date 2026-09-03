use agent_config_manager::core::plugin::{
    get_plugin_status, get_plugin_workspace_status, parse_plugin_dir, plugin_add_to_catalog,
    plugin_install, plugin_remove,
};
use agent_config_manager::types::{PluginPlacementState, TargetName};
use std::fs;
use std::sync::Mutex;
use tempfile::tempdir;

static PLUGIN_TEST_LOCK: Mutex<()> = Mutex::new(());

#[test]
fn test_plugin_full_lifecycle_and_conversion() {
    let _guard = PLUGIN_TEST_LOCK.lock().unwrap();

    let work_dir = tempdir().unwrap();
    let cat_dir = tempdir().unwrap();
    std::env::set_var("ACM_CATALOG_DIR", cat_dir.path().to_str().unwrap());

    // 1. Create a mock Claude plugin directory (original format)
    let plugin_src = tempdir().unwrap();
    let claude_plugin_dir = plugin_src.path().join(".claude-plugin");
    fs::create_dir_all(&claude_plugin_dir).unwrap();
    fs::write(
        claude_plugin_dir.join("plugin.json"),
        r#"{
            "name": "test-dev-suite",
            "description": "Comprehensive developer test suite",
            "version": "1.0.0"
        }"#,
    )
    .unwrap();

    // Add skills to plugin
    let skill_a = plugin_src.path().join("skills").join("skill-alpha");
    fs::create_dir_all(&skill_a).unwrap();
    fs::write(
        skill_a.join("SKILL.md"),
        "---\nname: skill-alpha\ndescription: Alpha skill\n---\n# Alpha Skill\n",
    )
    .unwrap();

    let skill_b = plugin_src.path().join("skills").join("skill-beta");
    fs::create_dir_all(&skill_b).unwrap();
    fs::write(
        skill_b.join("SKILL.md"),
        "---\nname: skill-beta\ndescription: Beta skill\n---\n# Beta Skill\n",
    )
    .unwrap();

    // Add .mcp.json to plugin
    fs::write(
        plugin_src.path().join(".mcp.json"),
        r#"{
            "mcpServers": {
                "test-mcp": {
                    "command": "npx",
                    "args": ["-y", "test-mcp-server"],
                    "env": { "TEST_KEY": "test_val" }
                }
            }
        }"#,
    )
    .unwrap();

    // 2. Parse plugin
    let parsed = parse_plugin_dir(plugin_src.path()).unwrap();
    assert_eq!(parsed.name, "test-dev-suite");
    assert_eq!(parsed.skills.len(), 2);
    assert!(parsed.skills.contains(&"skill-alpha".to_string()));
    assert!(parsed.skills.contains(&"skill-beta".to_string()));
    assert!(parsed.mcp_servers.contains_key("test-mcp"));

    // 3. Register plugin into catalog
    let plugin_id = plugin_add_to_catalog(plugin_src.path(), Some("my-plugin")).unwrap();
    assert_eq!(plugin_id, "my-plugin");

    let targets = vec![
        TargetName::Claude,
        TargetName::Antigravity,
        TargetName::Codex,
        TargetName::Grok,
    ];

    // Initial status: Missing
    let status_before = get_plugin_status(work_dir.path(), "my-plugin", &targets).unwrap();
    assert!(!status_before.enabled);
    assert_eq!(status_before.placement.get(&TargetName::Claude), Some(&PluginPlacementState::Missing));
    assert_eq!(status_before.placement.get(&TargetName::Antigravity), Some(&PluginPlacementState::Missing));
    assert_eq!(status_before.placement.get(&TargetName::Codex), Some(&PluginPlacementState::Missing));

    // 4. Install / Convert across all targets
    let installed = plugin_install(work_dir.path(), "my-plugin", &targets).unwrap();
    assert!(installed.enabled);

    // Verify Claude target: plugin directory linked
    let claude_plugin_path = work_dir.path().join(".claude").join("plugins").join("my-plugin");
    assert!(claude_plugin_path.exists());

    // Verify Antigravity target: converted & linked, plugin.json and mcp_config.json generated
    let agy_plugin_path = work_dir.path().join(".agents").join("plugins").join("my-plugin");
    assert!(agy_plugin_path.exists());
    assert!(agy_plugin_path.join("plugin.json").exists());
    assert!(agy_plugin_path.join("mcp_config.json").exists());

    // Verify Codex target: skills linked into .codex/skills, MCP injected into config.toml
    let codex_skills = work_dir.path().join(".codex").join("skills");
    assert!(codex_skills.join("skill-alpha").exists());
    assert!(codex_skills.join("skill-beta").exists());
    let codex_toml = fs::read_to_string(work_dir.path().join(".codex").join("config.toml")).unwrap();
    assert!(codex_toml.contains("test-mcp"));

    // Verify Grok target: MCP injected into config.toml
    let grok_toml = fs::read_to_string(work_dir.path().join(".grok").join("config.toml")).unwrap();
    assert!(grok_toml.contains("test-mcp"));

    // Verify workspace status
    let ws = get_plugin_workspace_status(work_dir.path(), &targets).unwrap();
    assert_eq!(ws.total_count, 1);
    assert_eq!(ws.enabled_count, 1);

    // 5. Remove plugin across all targets
    plugin_remove(work_dir.path(), "my-plugin", &targets).unwrap();

    let status_after = get_plugin_status(work_dir.path(), "my-plugin", &targets).unwrap();
    assert!(!status_after.enabled);
    assert!(!claude_plugin_path.exists());
    assert!(!agy_plugin_path.exists());
    assert!(!codex_skills.join("skill-alpha").exists());
    assert!(!codex_skills.join("skill-beta").exists());
}
