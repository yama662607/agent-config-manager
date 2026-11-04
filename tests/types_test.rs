use agent_config_manager::providers::ALL_PROVIDER_SPECS;
use agent_config_manager::types::{McpRecipe, TargetName, TransportType};
use std::collections::HashSet;
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
    assert_eq!(
        TargetName::from_str("deepseek").unwrap(),
        TargetName::DeepSeek
    );
    assert_eq!(TargetName::from_str("dsh").unwrap(), TargetName::DeepSeek);
    assert_eq!(
        TargetName::from_str("deepseek-harness").unwrap(),
        TargetName::DeepSeek
    );
    assert_eq!(TargetName::from_str("ds").unwrap(), TargetName::DeepSeek);
    assert_eq!(TargetName::from_str("s").unwrap(), TargetName::DeepSeek);
}

#[test]
fn test_provider_registry_invariants() {
    assert_eq!(TargetName::all().len(), ALL_PROVIDER_SPECS.len());

    let mut ids = HashSet::new();
    let mut short_codes = HashSet::new();
    let mut tui_keys = HashSet::new();
    let mut aliases = HashSet::new();

    for &target in TargetName::all() {
        let spec = target.spec();
        assert_eq!(spec.target, target);
        assert!(ids.insert(spec.id), "duplicate provider id: {}", spec.id);
        assert!(
            short_codes.insert(spec.short_code),
            "duplicate short_code: {}",
            spec.short_code
        );
        assert!(
            tui_keys.insert(spec.tui_key),
            "duplicate tui_key: {}",
            spec.tui_key
        );
        assert_eq!(TargetName::from_tui_key(spec.tui_key), Some(target));
        assert!(
            spec.aliases.contains(&spec.id),
            "provider {} must include its id in aliases",
            spec.id
        );
        for &alias in spec.aliases {
            assert!(
                aliases.insert(alias),
                "duplicate alias across providers: {}",
                alias
            );
            assert_eq!(TargetName::from_str(alias).unwrap(), target);
        }
    }
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
