use agent_config_manager::targets::TargetRegistry;
use agent_config_manager::types::TargetName;
use std::path::Path;

fn registry(input: &str) -> anyhow::Result<TargetRegistry> {
    let config: toml::Table = toml::from_str(input)?;
    TargetRegistry::from_config(&config, Path::new("/fixture/home"), None, None)
}

#[test]
fn builtins_keep_legacy_paths_and_aliases() {
    let registry = registry("").unwrap();
    assert_eq!(registry.all().len(), 5);
    assert_eq!(
        registry.resolve("c").unwrap().mcp_config,
        Path::new("/fixture/home/.claude.json")
    );
    assert_eq!(
        registry.resolve("x").unwrap().skills_dir,
        Path::new("/fixture/home/.codex/skills")
    );
}

#[test]
fn profiles_are_distinct_and_paths_are_resolved() {
    let registry = registry(
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
home_dir = "/other/codex"
skills_dir = "~/shared-skills"
"#,
    )
    .unwrap();
    assert_eq!(registry.all().len(), 7);
    let claude = registry.resolve("claude-personal").unwrap();
    assert_eq!(claude.provider, TargetName::Claude);
    assert_eq!(
        claude.mcp_config,
        Path::new("/fixture/home/.claude-personal/.claude.json")
    );
    assert_eq!(
        claude.plugins_dir.as_deref(),
        Some(Path::new("/fixture/home/.claude-personal/plugins"))
    );
    let codex = registry.resolve("codex-team").unwrap();
    assert_eq!(codex.mcp_config, Path::new("/other/codex/config.toml"));
    assert_eq!(codex.skills_dir, Path::new("/fixture/home/shared-skills"));
    assert!(codex.plugins_dir.is_none());
}

#[test]
fn standard_instances_respect_environment_overrides() {
    let registry = TargetRegistry::from_config(
        &toml::Table::new(),
        Path::new("/fixture/home"),
        Some(Path::new("/fixture/claude")),
        Some(Path::new("/fixture/codex")),
    )
    .unwrap();
    assert_eq!(
        registry.resolve("claude").unwrap().mcp_config,
        Path::new("/fixture/claude/.claude.json")
    );
    assert_eq!(
        registry.resolve("codex").unwrap().skills_dir,
        Path::new("/fixture/codex/skills")
    );
}

#[test]
fn invalid_profiles_fail_before_use() {
    let profile = |id: &str, provider: &str, code: &str, key: &str, home: &str| {
        format!("[[profiles]]\nid = '{id}'\nprovider = '{provider}'\ndisplay_name = 'Profile'\nshort_code = '{code}'\ntui_key = '{key}'\nhome_dir = '{home}'\n")
    };
    for input in [
        profile("c", "claude", "cp", "P", "/profile"),
        profile("all", "claude", "cp", "P", "/profile"),
        profile("extra", "grok", "cp", "P", "/profile"),
        profile("extra", "claude", "cl", "P", "/profile"),
        profile("extra", "claude", "cp", "q", "/profile"),
        profile("extra", "claude", "cp", "P", "relative"),
        format!(
            "{}{}",
            profile("extra", "claude", "cp", "P", "/profile"),
            profile("extra", "codex", "xt", "T", "/profile")
        ),
    ] {
        assert!(registry(&input).is_err(), "accepted: {input}");
    }
}

#[test]
fn target_selection_handles_profiles_defaults_aliases_and_all() {
    let input = r#"
default_targets = ["c", "codex-team", "claude"]
[[profiles]]
id = "codex-team"
provider = "codex"
display_name = "Codex Team"
short_code = "xt"
tui_key = "T"
home_dir = "/fixture/team"
"#;
    let config: toml::Table = toml::from_str(input).unwrap();
    let registry = registry(input).unwrap();
    let selected = registry.select(None, &config).unwrap();
    assert_eq!(
        selected.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(),
        ["claude", "codex-team"]
    );
    let selected = registry
        .select(Some(&["codex-team".into(), "all".into()]), &config)
        .unwrap();
    assert_eq!(selected.len(), 6);
    assert_eq!(selected[0].id, "codex-team");
    assert!(registry.select(Some(&["missing".into()]), &config).is_err());
    assert!(registry.select(Some(&[]), &config).is_err());
    let invalid: toml::Table = toml::from_str("default_targets = [4]").unwrap();
    assert!(registry.select(None, &invalid).is_err());
    assert_eq!(registry.select(None, &toml::Table::new()).unwrap().len(), 5);
}

#[test]
fn duplicate_target_homes_and_resource_overrides_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path();
    let actual = home.join("shared");
    std::fs::create_dir(&actual).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(&actual, home.join("alias")).unwrap();
    #[cfg(not(unix))]
    std::fs::create_dir(home.join("alias")).unwrap();
    let config: toml::Table = toml::from_str(
        r#"
[[profiles]]
id = "codex-a"
provider = "codex"
display_name = "A"
short_code = "aa"
tui_key = "A"
home_dir = "~/shared"
[[profiles]]
id = "codex-b"
provider = "codex"
display_name = "B"
short_code = "bb"
tui_key = "B"
home_dir = "~/alias"
skills_dir = "~/shared/skills"
"#,
    )
    .unwrap();
    let registry = TargetRegistry::from_config(&config, home, None, None).unwrap();
    assert!(registry.select(Some(&["codex-a".into()]), &config).is_ok());
    let error = registry
        .select(Some(&["codex-a".into(), "codex-b".into()]), &config)
        .unwrap_err();
    assert!(error.to_string().contains("share the same"));
}
