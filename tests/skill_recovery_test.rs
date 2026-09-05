use agent_config_manager::catalog::store::add_skill;
use agent_config_manager::core::placement::{copy_dir_recursive, SkillPlacementMode};
use agent_config_manager::core::skill::*;
use agent_config_manager::paths::{get_catalog_skill_dir, get_skill_path, get_state_dir};
use agent_config_manager::types::TargetName;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Every test body runs in a subprocess with its own HOME and catalog, including API tests.
fn isolated(name: &str) -> bool {
    if std::env::var("ACM_RECOVERY_TEST").ok().as_deref() == Some(name) {
        return false;
    }
    let fixture = tempfile::tempdir().unwrap();
    for name in ["home", "project", "catalog"] {
        fs::create_dir(fixture.path().join(name)).unwrap();
    }
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", name, "--nocapture"])
        .env("ACM_RECOVERY_TEST", name)
        .env("HOME", fixture.path().join("home"))
        .env("USERPROFILE", fixture.path().join("home"))
        .env("ACM_CATALOG_DIR", fixture.path().join("catalog"))
        .current_dir(fixture.path().join("project"))
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    true
}

fn root() -> PathBuf {
    std::env::current_dir().unwrap()
}
fn catalog(id: &str, content: &str) -> PathBuf {
    add_skill(
        id,
        &format!("---\nname: {id}\ndescription: Recovery regression skill\n---\n{content}\n"),
    )
    .unwrap();
    get_catalog_skill_dir(id)
}
fn snapshot() -> BTreeMap<PathBuf, String> {
    let root = root();
    walkdir::WalkDir::new(root.parent().unwrap())
        .follow_links(false)
        .into_iter()
        .map(|entry| {
            let entry = entry.unwrap();
            let metadata = fs::symlink_metadata(entry.path()).unwrap();
            let bytes = if metadata.is_file() {
                fs::read(entry.path()).unwrap()
            } else {
                Vec::new()
            };
            (
                entry.path().to_path_buf(),
                format!(
                    "{:?}/{:?}/{bytes:?}",
                    metadata.modified().unwrap(),
                    metadata.permissions()
                ),
            )
        })
        .collect()
}
fn backup_id(root: &Path, id: &str, target: TargetName) -> String {
    list_skill_backups(root, id, &[target]).unwrap()["backups"][0]["id"]
        .as_str()
        .unwrap()
        .into()
}

#[test]
fn updates_protect_edits_and_restore_is_reversible() {
    if isolated("updates_protect_edits_and_restore_is_reversible") {
        return;
    }
    let root = root();
    let target = TargetName::Codex;
    let source = catalog("recover", "version one");
    let destination = get_skill_path(&root, target, "recover");
    fs::write(source.join("old-asset"), "kept in backup").unwrap();
    skill_add(&root, "recover", &[target], Some(SkillPlacementMode::Copy)).unwrap();
    fs::write(source.join("SKILL.md"), "version two").unwrap();
    fs::remove_file(source.join("old-asset")).unwrap();
    fs::write(source.join("new-asset"), "upstream asset").unwrap();
    let before = snapshot();
    let preview = preview_skill_update(&root, Some("recover"), &[target], false, None).unwrap();
    assert_eq!(
        before,
        snapshot(),
        "preview must not write any persistent state"
    );
    assert_eq!(
        preview["targets"][0]["changes"]["added"],
        serde_json::json!(["new-asset"])
    );
    assert_eq!(
        preview["targets"][0]["changes"]["removed"],
        serde_json::json!(["old-asset"])
    );
    assert_eq!(
        skill_update(&root, Some("recover"), &[target], false)
            .unwrap()
            .updated_count,
        1
    );
    let original = backup_id(&root, "recover", target);
    let saved_directory = root.join("temporarily-saved-copy");
    fs::rename(&destination, &saved_directory).unwrap();
    fs::write(
        &destination,
        "a regular file is never a restore destination",
    )
    .unwrap();
    assert!(restore_skill_backup(&root, "recover", &original, target, true, true).is_err());
    assert!(restore_skill_backup(&root, "recover", &original, target, true, false).is_err());
    assert!(preview_skill_add(
        &root,
        "recover",
        &[target],
        Some(SkillPlacementMode::Copy),
        true
    )
    .is_err());
    fs::remove_file(&destination).unwrap();
    fs::rename(saved_directory, &destination).unwrap();
    fs::write(destination.join("SKILL.md"), "private local edit").unwrap();
    let failure = skill_update(&root, Some("recover"), &[target], false).unwrap_err();
    assert!(failure.to_string().contains("Local edits"));
    assert_eq!(
        fs::read_to_string(destination.join("SKILL.md")).unwrap(),
        "private local edit"
    );
    skill_update(&root, Some("recover"), &[target], true).unwrap();
    let edited = backup_id(&root, "recover", target);
    let restored = restore_skill_backup(&root, "recover", &edited, target, false, false).unwrap();
    assert_eq!(
        fs::read_to_string(destination.join("SKILL.md")).unwrap(),
        "private local edit"
    );
    // Restoring locally edited content does not bless it as a deployment baseline.
    assert!(skill_update(&root, Some("recover"), &[target], false).is_err());
    let undo = restored["undoBackupId"].as_str().unwrap();
    restore_skill_backup(&root, "recover", undo, target, false, false).unwrap();
    assert_eq!(
        fs::read_to_string(destination.join("SKILL.md")).unwrap(),
        "version two"
    );
    fs::write(destination.join("new-asset"), "newer edit").unwrap();
    let before = snapshot();
    let preview = restore_skill_backup(&root, "recover", &original, target, false, true).unwrap();
    assert_eq!(preview["blocked"], true);
    assert_eq!(before, snapshot());
    assert!(restore_skill_backup(&root, "recover", &original, target, false, false).is_err());
    assert!(
        restore_skill_backup(&root, "recover", &original, TargetName::Claude, true, false).is_err()
    );
    assert!(restore_skill_backup(&root, "other", &original, target, true, false).is_err());
    let elsewhere = tempfile::tempdir().unwrap();
    assert!(
        restore_skill_backup(elsewhere.path(), "recover", &original, target, true, false).is_err()
    );
    assert!(
        restore_skill_backup(&root, "recover", "../baseline.json", target, true, false).is_err()
    );
    restore_skill_backup(&root, "recover", &original, target, true, false).unwrap();
    assert!(destination.join("old-asset").is_file());
    assert!(!destination.join("new-asset").exists());
}

#[test]
fn unknown_copies_and_explicit_modes_cannot_bypass_protection() {
    if isolated("unknown_copies_and_explicit_modes_cannot_bypass_protection") {
        return;
    }
    let root = root();
    let target = TargetName::Codex;
    let source = catalog("legacy", "catalog copy");
    let destination = get_skill_path(&root, target, "legacy");
    copy_dir_recursive(&source, &destination).unwrap();
    fs::write(destination.join("SKILL.md"), "unknown legacy edits").unwrap();
    let before = snapshot();
    let plan = preview_skill_add(
        &root,
        "legacy",
        &[target],
        Some(SkillPlacementMode::Link),
        false,
    )
    .unwrap();
    assert!(plan["targets"][0]["conflict"]
        .as_str()
        .unwrap()
        .contains("no deployment baseline"));
    assert_eq!(snapshot(), before);
    for mode in [SkillPlacementMode::Copy, SkillPlacementMode::Link] {
        assert!(
            skill_update_with_placement(&root, Some("legacy"), &[target], false, Some(mode))
                .is_err()
        );
        assert!(skill_add(&root, "legacy", &[target], Some(mode)).is_err());
    }
    skill_update_with_placement(
        &root,
        Some("legacy"),
        &[target],
        true,
        Some(SkillPlacementMode::Copy),
    )
    .unwrap();
    assert_eq!(
        list_skill_backups(&root, "legacy", &[target]).unwrap()["backups"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    fs::write(source.join("SKILL.md"), "next upstream copy").unwrap();
    skill_update(&root, Some("legacy"), &[target], false).unwrap();
    // An identical legacy copy can establish a baseline without replacing or backing it up.
    let source = catalog("matching", "same");
    copy_dir_recursive(source, get_skill_path(&root, target, "matching")).unwrap();
    skill_update(&root, Some("matching"), &[target], false).unwrap();
    fs::write(
        get_catalog_skill_dir("matching").join("SKILL.md"),
        "updated upstream",
    )
    .unwrap();
    assert_eq!(
        skill_update(&root, Some("matching"), &[target], false)
            .unwrap()
            .updated_count,
        1
    );
}

#[test]
fn known_conflicts_are_preflighted_before_other_copies_change() {
    if isolated("known_conflicts_are_preflighted_before_other_copies_change") {
        return;
    }
    let root = root();
    let targets = [TargetName::Claude, TargetName::Codex];
    let a = catalog("alpha", "old alpha");
    let b = catalog("beta", "old beta");
    for id in ["alpha", "beta"] {
        skill_add(&root, id, &targets, Some(SkillPlacementMode::Copy)).unwrap();
    }
    fs::write(a.join("SKILL.md"), "new alpha").unwrap();
    fs::write(b.join("SKILL.md"), "new beta").unwrap();
    fs::write(
        get_skill_path(&root, TargetName::Codex, "beta").join("SKILL.md"),
        "local beta",
    )
    .unwrap();
    let before = snapshot();
    assert!(skill_update(&root, None, &targets, false).is_err());
    assert_eq!(before, snapshot());
}

#[test]
fn concurrent_updates_recheck_baselines_and_preserve_single_previous_copy() {
    if isolated("concurrent_updates_recheck_baselines_and_preserve_single_previous_copy") {
        return;
    }
    let root = root();
    let target = TargetName::Codex;
    let source = catalog("concurrent", "original");
    skill_add(
        &root,
        "concurrent",
        &[target],
        Some(SkillPlacementMode::Copy),
    )
    .unwrap();
    fs::write(source.join("SKILL.md"), "updated").unwrap();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(6));
    let workers: Vec<_> = (0..6)
        .map(|_| {
            let root = root.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                skill_update(&root, Some("concurrent"), &[target], false)
            })
        })
        .collect();
    for worker in workers {
        worker.join().unwrap().unwrap();
    }
    assert_eq!(
        list_skill_backups(&root, "concurrent", &[target]).unwrap()["backups"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        fs::read_to_string(get_skill_path(&root, target, "concurrent").join("SKILL.md")).unwrap(),
        "updated"
    );
}

#[cfg(unix)]
#[test]
fn recovery_preserves_hidden_assets_permissions_and_links_without_following_them() {
    if isolated("recovery_preserves_hidden_assets_permissions_and_links_without_following_them") {
        return;
    }
    use std::os::unix::fs::{symlink, PermissionsExt};
    let root = root();
    let target = TargetName::Codex;
    let source = catalog("payload", "old");
    fs::create_dir(source.join("empty")).unwrap();
    fs::set_permissions(source.join("empty"), fs::Permissions::from_mode(0o711)).unwrap();
    fs::create_dir(source.join("readonly")).unwrap();
    fs::write(source.join("readonly/asset"), "read-only directory asset").unwrap();
    fs::set_permissions(source.join("readonly"), fs::Permissions::from_mode(0o511)).unwrap();
    fs::write(source.join("run.sh"), "#!/bin/sh\n").unwrap();
    fs::set_permissions(source.join("run.sh"), fs::Permissions::from_mode(0o751)).unwrap();
    skill_add(&root, "payload", &[target], Some(SkillPlacementMode::Copy)).unwrap();
    let destination = get_skill_path(&root, target, "payload");
    fs::write(destination.join(".private"), "local secret asset").unwrap();
    fs::write(destination.join(".DS_Store"), "local binary data").unwrap();
    let external = root.join("external");
    fs::write(&external, "must remain intact").unwrap();
    symlink(&external, destination.join("reference")).unwrap();
    fs::write(source.join("SKILL.md"), "new").unwrap();
    skill_update(&root, Some("payload"), &[target], true).unwrap();
    let id = backup_id(&root, "payload", target);
    assert_eq!(
        fs::read_dir(destination.parent().unwrap()).unwrap().count(),
        1,
        "temporary old copies must be cleaned up"
    );
    for entry in walkdir::WalkDir::new(get_state_dir().join("skill-state")).max_depth(3) {
        let entry = entry.unwrap();
        if entry.file_type().is_dir() {
            assert_eq!(
                fs::metadata(entry.path()).unwrap().permissions().mode() & 0o077,
                0
            );
        }
    }
    restore_skill_backup(&root, "payload", &id, target, false, false).unwrap();
    assert_eq!(
        fs::read_to_string(destination.join(".private")).unwrap(),
        "local secret asset"
    );
    assert_eq!(
        fs::read_to_string(destination.join(".DS_Store")).unwrap(),
        "local binary data"
    );
    assert_eq!(
        fs::read_link(destination.join("reference")).unwrap(),
        external
    );
    assert_eq!(
        fs::metadata(destination.join("run.sh"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o751
    );
    assert_eq!(
        fs::metadata(destination.join("empty"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o711
    );
    assert_eq!(
        fs::metadata(destination.join("readonly"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o511
    );
    fs::set_permissions(
        destination.join("readonly"),
        fs::Permissions::from_mode(0o711),
    )
    .unwrap();
    fs::remove_dir_all(&destination).unwrap();
    let external_dir = root.join("unrelated");
    fs::create_dir(&external_dir).unwrap();
    fs::write(external_dir.join("SKILL.md"), "unrelated payload").unwrap();
    symlink(&external_dir, &destination).unwrap();
    assert!(restore_skill_backup(&root, "payload", &id, target, true, false).is_err());
    assert_eq!(
        fs::read_to_string(external_dir.join("SKILL.md")).unwrap(),
        "unrelated payload"
    );
    assert_eq!(fs::read_to_string(external).unwrap(), "must remain intact");
}

#[test]
fn previews_do_not_initialize_machine_state_and_missing_restore_can_be_undone() {
    if isolated("previews_do_not_initialize_machine_state_and_missing_restore_can_be_undone") {
        return;
    }
    let root = root();
    let target = TargetName::Codex;
    let source = catalog("fresh", "one");
    let before = snapshot();
    preview_skill_add(
        &root,
        "fresh",
        &[target],
        Some(SkillPlacementMode::Copy),
        false,
    )
    .unwrap();
    list_skill_backups(&root, "fresh", &[target]).unwrap();
    assert_eq!(before, snapshot());
    assert!(!get_state_dir().join("skill-state").exists());
    skill_add(&root, "fresh", &[target], Some(SkillPlacementMode::Copy)).unwrap();
    fs::write(source.join("SKILL.md"), "two").unwrap();
    skill_update(&root, Some("fresh"), &[target], false).unwrap();
    let id = backup_id(&root, "fresh", target);
    let destination = get_skill_path(&root, target, "fresh");
    fs::remove_dir_all(&destination).unwrap();
    let restored = restore_skill_backup(&root, "fresh", &id, target, true, false).unwrap();
    assert!(destination.is_dir());
    restore_skill_backup(
        &root,
        "fresh",
        restored["undoBackupId"].as_str().unwrap(),
        target,
        false,
        false,
    )
    .unwrap();
    assert!(!destination.exists());
}

#[test]
fn renaming_preserves_deployment_baselines_and_scoped_recovery() {
    if isolated("renaming_preserves_deployment_baselines_and_scoped_recovery") {
        return;
    }
    let root = root();
    let target = TargetName::Codex;
    let source = catalog("alpha", "original alpha");
    skill_add(&root, "alpha", &[target], Some(SkillPlacementMode::Copy)).unwrap();
    fs::write(source.join("SKILL.md"), "second alpha").unwrap();
    skill_update(&root, Some("alpha"), &[target], false).unwrap();
    let id = backup_id(&root, "alpha", target);
    skill_rename(&root, "alpha", "beta", None::<&PathBuf>, &[target]).unwrap();
    assert_eq!(backup_id(&root, "beta", target), id);
    assert!(
        list_skill_backups(&root, "alpha", &[target]).unwrap()["backups"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    fs::write(get_catalog_skill_dir("beta").join("SKILL.md"), "third beta").unwrap();
    assert_eq!(
        skill_update(&root, Some("beta"), &[target], false)
            .unwrap()
            .updated_count,
        1
    );
    restore_skill_backup(&root, "beta", &id, target, true, false).unwrap();
    assert!(
        fs::read_to_string(get_skill_path(&root, target, "beta").join("SKILL.md"))
            .unwrap()
            .contains("original alpha")
    );
    assert!(!get_skill_path(&root, target, "alpha").exists());
}

#[test]
fn placements_reject_nested_sources_before_mutation_or_recursive_copy() {
    if isolated("placements_reject_nested_sources_before_mutation_or_recursive_copy") {
        return;
    }
    use agent_config_manager::core::placement::copy_skill_dir_to_config_with_options;
    use agent_config_manager::core::skill_history::preview_skill_placement;
    let root = root();
    let target = TargetName::Codex;
    let destination = get_skill_path(&root, target, "nested");
    fs::create_dir_all(destination.join("child")).unwrap();
    fs::write(destination.join("SKILL.md"), "parent").unwrap();
    fs::write(destination.join("child/SKILL.md"), "child").unwrap();
    fs::write(root.join("SKILL.md"), "ancestor").unwrap();
    let before = snapshot();
    for source in [&destination, &destination.join("child"), &root] {
        for mode in [SkillPlacementMode::Link, SkillPlacementMode::Copy] {
            assert!(preview_skill_placement(&root, target, "nested", source, mode, true).is_err());
            assert!(copy_skill_dir_to_config_with_options(
                &root, target, "nested", source, mode, true
            )
            .is_err());
        }
    }
    assert_eq!(before, snapshot());
    #[cfg(unix)]
    {
        let alias = root.parent().unwrap().join("source-alias");
        std::os::unix::fs::symlink(&root, &alias).unwrap();
        assert!(copy_dir_recursive(&alias, root.join("recursive-copy")).is_err());
        assert!(!root.join("recursive-copy").exists());
    }
}
