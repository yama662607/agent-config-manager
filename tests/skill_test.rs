use agent_config_manager::catalog::catalog::{add_skill, get_skill, list_skills};
use agent_config_manager::core::doctor::run_doctor;
use agent_config_manager::core::skill::{skill_add, skill_link, skill_rename, skill_unlink};
use agent_config_manager::paths::get_catalog_skills_dir;
use agent_config_manager::types::TargetName;
use std::fs;
use std::sync::Mutex;
use tempfile::tempdir;

static TEST_LOCK: Mutex<()> = Mutex::new(());

#[test]
fn test_all_skill_and_catalog_operations() {
    let _guard = TEST_LOCK.lock().unwrap();

    // 1. Skill Catalog CRUD
    let catalog_dir = tempdir().unwrap();
    std::env::set_var("ACM_CATALOG_DIR", catalog_dir.path().to_str().unwrap());

    let content = r#"---
name: test-skill
description: A test skill for verifying catalog operations.
---
# Content
"#;
    let entry = add_skill("test-skill", content).unwrap();
    assert_eq!(entry.id, "test-skill");

    let skill = get_skill("test-skill").unwrap();
    assert!(skill.is_some());
    assert_eq!(skill.unwrap().display_name, "test-skill");

    let all_skills = list_skills().unwrap();
    assert_eq!(all_skills.len(), 1);

    // 2. Link and Unlink
    let dev_dir = tempdir().unwrap();
    let skill_source = dev_dir.path().join("my-dev-skill");
    fs::create_dir_all(&skill_source).unwrap();
    fs::write(
        skill_source.join("SKILL.md"),
        r#"---
name: my-dev-skill
description: Source of truth skill in development repo.
---
"#,
    )
    .unwrap();

    let id = skill_link(&skill_source, None, None, false).unwrap();
    assert_eq!(id, "my-dev-skill");

    let linked_path = get_catalog_skills_dir().join("my-dev-skill");
    assert!(fs::symlink_metadata(&linked_path).unwrap().file_type().is_symlink());

    skill_unlink("my-dev-skill").unwrap();
    assert!(!linked_path.exists());
    assert!(skill_source.exists());

    // 3. Rename (Proposal 1)
    let project_dir = tempdir().unwrap();
    let root = project_dir.path();

    add_skill(
        "coding-agent-session-recall",
        r#"---
name: coding-agent-session-recall
description: Session recall for coding agents.
---
"#,
    )
    .unwrap();

    let targets = vec![TargetName::Claude, TargetName::Codex];
    skill_add(root, "coding-agent-session-recall", &targets, None).unwrap();

    let claude_skill = root.join(".claude").join("skills").join("coding-agent-session-recall");
    assert!(claude_skill.exists());

    skill_rename(
        root,
        "coding-agent-session-recall",
        "ai-agent-archive-recall",
        None::<&std::path::Path>,
        &targets,
    )
    .unwrap();

    assert!(!get_catalog_skills_dir().join("coding-agent-session-recall").exists());
    assert!(get_catalog_skills_dir().join("ai-agent-archive-recall").exists());
    assert!(!claude_skill.exists());
    assert!(root.join(".claude").join("skills").join("ai-agent-archive-recall").exists());

    // 4. Doctor fix dangling symlink (Proposal 3)
    let temp_d = tempdir().unwrap();
    let broken_target = temp_d.path().join("deleted-folder");
    let broken_symlink = get_catalog_skills_dir().join("broken-skill");
    fs::create_dir_all(get_catalog_skills_dir()).unwrap();

    #[cfg(unix)]
    std::os::unix::fs::symlink(&broken_target, &broken_symlink).unwrap();

    let report = run_doctor(root, false, &[TargetName::Claude]).unwrap();
    assert!(report.has_warnings);

    let report_fixed = run_doctor(root, true, &[TargetName::Claude]).unwrap();
    assert!(report_fixed.fixed_count >= 1);
    assert!(!broken_symlink.exists() && fs::symlink_metadata(&broken_symlink).is_err());
}
