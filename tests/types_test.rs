use agent_config_manager::types::{McpRecipe, TargetName, TransportType};
use std::str::FromStr;

#[test]
fn test_target_name_parsing() {
    assert_eq!(TargetName::from_str("claude").unwrap(), TargetName::Claude);
    assert_eq!(TargetName::from_str("c").unwrap(), TargetName::Claude);
    assert_eq!(TargetName::from_str("codex").unwrap(), TargetName::Codex);
    assert_eq!(TargetName::from_str("x").unwrap(), TargetName::Codex);
    assert_eq!(
        TargetName::from_str("antigravity").unwrap(),
        TargetName::Antigravity
    );
    assert_eq!(
        TargetName::from_str("agy").unwrap(),
        TargetName::Antigravity
    );
    assert_eq!(TargetName::from_str("a").unwrap(), TargetName::Antigravity);
    assert_eq!(TargetName::from_str("g").unwrap(), TargetName::Antigravity);
    assert_eq!(TargetName::from_str("grok").unwrap(), TargetName::Grok);
    assert_eq!(TargetName::from_str("k").unwrap(), TargetName::Grok);
}

#[test]
fn test_mcp_recipe_serialization() {
    let recipe = McpRecipe {
        command: Some("npx".to_string()),
        args: Some(vec![
            "-y".to_string(),
            "@modelcontextprotocol/server-github".to_string(),
        ]),
        url: None,
        cwd: None,
        env: None,
        transport: Some(TransportType::Stdio),
    };

    let json = serde_json::to_string(&recipe).unwrap();
    assert!(json.contains("npx"));
    assert!(json.contains("@modelcontextprotocol/server-github"));
}
