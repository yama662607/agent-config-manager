use agent_config_manager::adapters::{
    add_mcp_to_config, get_mcp_servers, remove_mcp_from_config, set_mcp_enabled,
};
use agent_config_manager::types::{McpRecipe, TargetName, TransportType};
use tempfile::tempdir;

#[test]
fn test_claude_adapter_crud() {
    let dir = tempdir().unwrap();
    let config_path = dir.path().join(".mcp.json");

    let recipe = McpRecipe {
        command: Some("npx".to_string()),
        args: Some(vec!["-y".to_string(), "test-server".to_string()]),
        url: None,
        cwd: None,
        env: None,
        transport: Some(TransportType::Stdio),
    };

    // Add
    add_mcp_to_config(TargetName::Claude, &config_path, "test-server", &recipe).unwrap();
    let servers = get_mcp_servers(TargetName::Claude, &config_path).unwrap();
    assert!(servers.contains_key("test-server"));
    assert!(servers["test-server"].enabled);

    // Remove
    remove_mcp_from_config(TargetName::Claude, &config_path, "test-server").unwrap();
    let servers_after = get_mcp_servers(TargetName::Claude, &config_path).unwrap();
    assert!(!servers_after.contains_key("test-server"));
}

#[test]
fn test_codex_adapter_crud() {
    let dir = tempdir().unwrap();
    let config_path = dir.path().join(".codex").join("config.toml");

    let recipe = McpRecipe {
        command: Some("npx".to_string()),
        args: Some(vec!["-y".to_string(), "my-pkg".to_string()]),
        url: None,
        cwd: None,
        env: None,
        transport: Some(TransportType::Stdio),
    };

    // Add
    let key = add_mcp_to_config(TargetName::Codex, &config_path, "my-pkg", &recipe).unwrap();
    let servers = get_mcp_servers(TargetName::Codex, &config_path).unwrap();
    assert!(servers.contains_key(&key));
    assert!(servers[&key].enabled);

    // Disable
    set_mcp_enabled(TargetName::Codex, &config_path, &key, false).unwrap();
    let servers_disabled = get_mcp_servers(TargetName::Codex, &config_path).unwrap();
    assert!(!servers_disabled[&key].enabled);

    // Remove
    remove_mcp_from_config(TargetName::Codex, &config_path, &key).unwrap();
    let servers_removed = get_mcp_servers(TargetName::Codex, &config_path).unwrap();
    assert!(!servers_removed.contains_key(&key));
}
