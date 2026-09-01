use agent_config_manager::core::validate::{validate_skill_content, validate_skill_directory, validate_skill_name};
use agent_config_manager::types::IssueSeverity;
use std::fs;
use tempfile::tempdir;

#[test]
fn test_validate_skill_name() {
    assert!(validate_skill_name("frontend-design").is_ok());
    assert!(validate_skill_name("ai_agent_recall").is_ok());
    assert!(validate_skill_name("tool.v1").is_ok());

    assert!(validate_skill_name("").is_err());
    assert!(validate_skill_name("my/skill").is_err());
    assert!(validate_skill_name("..").is_err());
    assert!(validate_skill_name("-invalid").is_err());
}

#[test]
fn test_validate_skill_frontmatter_valid() {
    let content = r#"---
name: my-skill
description: This is a great skill that assists with coding and testing.
---
# Content
"#;
    let issues = validate_skill_content(content, "my-skill");
    assert!(issues.is_empty(), "Expected no issues, got: {:?}", issues);
}

#[test]
fn test_validate_skill_frontmatter_missing_description() {
    let content = r#"---
name: my-skill
---
# Content
"#;
    let issues = validate_skill_content(content, "my-skill");
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].severity, IssueSeverity::Error);
    assert!(issues[0].message.contains("Missing required 'description'"));
}

#[test]
fn test_validate_skill_directory() {
    let dir = tempdir().unwrap();
    let skill_path = dir.path().join("test-skill");
    fs::create_dir_all(&skill_path).unwrap();

    let skill_md = skill_path.join("SKILL.md");
    fs::write(
        &skill_md,
        r#"---
name: test-skill
description: Comprehensive testing skill for AI agent workflow validation.
---
# Guide
"#,
    )
    .unwrap();

    let issues = validate_skill_directory(&skill_path).unwrap();
    assert!(issues.is_empty(), "Expected valid directory, got: {:?}", issues);
}
