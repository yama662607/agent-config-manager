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

#[test]
fn test_deepseek_adapter_crud() {
    let dir = tempdir().unwrap();
    let config_path = dir.path().join(".dsh").join("cordis.patch.yml");

    let stdio_recipe = McpRecipe {
        command: Some("npx".to_string()),
        args: Some(vec!["-y".to_string(), "stdio-pkg".to_string()]),
        url: None,
        cwd: None,
        env: None,
        transport: Some(TransportType::Stdio),
    };

    // Add stdio server
    let key = add_mcp_to_config(
        TargetName::DeepSeek,
        &config_path,
        "stdio-pkg",
        &stdio_recipe,
    )
    .unwrap();
    let servers = get_mcp_servers(TargetName::DeepSeek, &config_path).unwrap();
    assert!(servers.contains_key(&key));
    assert!(servers[&key].enabled);
    assert_eq!(
        servers[&key].recipe.as_ref().unwrap().command.as_deref(),
        Some("npx")
    );

    // Verify YAML file contents
    let yaml_str = std::fs::read_to_string(&config_path).unwrap();
    assert!(yaml_str.contains("@deepseek-ai/dsh-mcp-client"));
    assert!(yaml_str.contains("stdio-pkg"));

    // Add HTTP server
    let http_recipe = McpRecipe {
        command: None,
        args: None,
        url: Some("https://example.com/mcp".to_string()),
        cwd: None,
        env: None,
        transport: Some(TransportType::Http),
    };
    let http_key = add_mcp_to_config(
        TargetName::DeepSeek,
        &config_path,
        "remote-mcp",
        &http_recipe,
    )
    .unwrap();
    let servers = get_mcp_servers(TargetName::DeepSeek, &config_path).unwrap();
    assert!(servers.contains_key(&http_key));
    assert_eq!(
        servers[&http_key].recipe.as_ref().unwrap().url.as_deref(),
        Some("https://example.com/mcp")
    );

    // Disable stdio server
    set_mcp_enabled(TargetName::DeepSeek, &config_path, &key, false).unwrap();
    let servers_disabled = get_mcp_servers(TargetName::DeepSeek, &config_path).unwrap();
    assert!(!servers_disabled[&key].enabled);
    assert!(servers_disabled[&http_key].enabled);

    // Re-enable
    set_mcp_enabled(TargetName::DeepSeek, &config_path, &key, true).unwrap();
    let servers_reenabled = get_mcp_servers(TargetName::DeepSeek, &config_path).unwrap();
    assert!(servers_reenabled[&key].enabled);

    // Remove stdio server
    remove_mcp_from_config(TargetName::DeepSeek, &config_path, &key).unwrap();
    let servers_removed = get_mcp_servers(TargetName::DeepSeek, &config_path).unwrap();
    assert!(!servers_removed.contains_key(&key));
    assert!(servers_removed.contains_key(&http_key));

    // Remove HTTP server
    remove_mcp_from_config(TargetName::DeepSeek, &config_path, &http_key).unwrap();
    let servers_empty = get_mcp_servers(TargetName::DeepSeek, &config_path).unwrap();
    assert!(!servers_empty.contains_key(&http_key));
}
