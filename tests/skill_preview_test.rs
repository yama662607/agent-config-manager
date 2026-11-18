mod common;
use common::*;
use std::fs;

#[cfg(unix)]
#[test]
fn development_link_preview_matches_home_links_and_grok_registration() {
    let f = Fixture::new();
    let source = f.skill("probe");
    let args = [
        "skill",
        "link",
        source.to_str().unwrap(),
        "--as",
        "probe",
        "--distribute",
        "--home",
        "-t",
        "claude,grok",
    ];
    let mut preview = args.to_vec();
    preview.push("--dry-run");
    let plan = f.json(&preview);
    let targets = plan["distribution"]["targets"].as_array().unwrap();
    assert_eq!(targets[0]["action"], "link");
    assert_eq!(
        targets[0]["linkTarget"],
        f.catalog.join("skills/probe").to_str().unwrap()
    );
    assert_eq!(targets[1]["action"], "register");
    assert_eq!(
        targets[1]["directory"],
        f.catalog.join("skills").to_str().unwrap()
    );
    assert!(!f.catalog.join("skills/probe").exists());
    f.ok(&args);
    assert_eq!(
        fs::read_link(f.home.join(".claude/skills/probe")).unwrap(),
        f.catalog.join("skills/probe")
    );
    assert!(!f.home.join(".grok/skills/probe").exists());
    assert_eq!(
        toml_file(&f.home.join(".grok/config.toml"))["skills"]["paths"][0],
        f.catalog.join("skills").to_str().unwrap()
    );
}

#[cfg(unix)]
#[test]
fn registered_import_preview_names_the_catalog_link_target() {
    let f = Fixture::new();
    let source = f.skill("probe");
    let args = [
        "skill",
        "import",
        source.to_str().unwrap(),
        "--as",
        "probe",
        "--home",
        "-t",
        "claude",
    ];
    let mut preview = args.to_vec();
    preview.push("--dry-run");
    let plan = f.json(&preview);
    assert_eq!(plan["targets"][0]["action"], "link");
    let destination = f.catalog.join("skills/probe");
    assert_eq!(
        plan["targets"][0]["linkTarget"],
        destination.to_str().unwrap()
    );
    f.ok(&args);
    assert_eq!(
        fs::read_link(f.home.join(".claude/skills/probe")).unwrap(),
        destination
    );
}

#[cfg(unix)]
#[test]
fn direct_add_honors_persistent_link_and_refuses_temporary_link() {
    let f = Fixture::new();
    let source = f.skill("probe");
    let file = source.join("SKILL.md");
    let args = [
        "skill",
        "add",
        "probe",
        "--file",
        file.to_str().unwrap(),
        "--no-register",
        "--link",
        "--home",
        "-t",
        "claude",
    ];
    let mut preview = args.to_vec();
    preview.push("--dry-run");
    let plan = f.json(&preview);
    assert_eq!(plan["targets"][0]["action"], "link");
    f.ok(&args);
    let actual = fs::read_link(f.home.join(".claude/skills/probe")).unwrap();
    assert_eq!(plan["targets"][0]["linkTarget"], actual.to_str().unwrap());
    let ordinary = f.file("ordinary.md", "Standalone Markdown");
    let args = [
        "skill",
        "add",
        "ordinary",
        "--file",
        ordinary.to_str().unwrap(),
        "--no-register",
        "--link",
        "-t",
        "claude",
    ];
    assert!(f.fail(&args).contains("requires a SKILL.md"));
    let mut preview = args.to_vec();
    preview.push("--dry-run");
    assert!(f.fail(&preview).contains("requires a SKILL.md"));
    assert!(!f.project.join(".claude/skills/ordinary").exists());
}

#[cfg(unix)]
#[test]
fn link_preview_propagates_distribution_conflicts_and_allows_link_repointing() {
    let f = Fixture::new();
    let source = f.skill("probe");
    f.file(
        "home/.claude/skills/probe/SKILL.md",
        "Locally authored content",
    );
    let plan = f.json(&[
        "skill",
        "link",
        source.to_str().unwrap(),
        "--as",
        "probe",
        "--distribute",
        "--home",
        "-t",
        "claude",
        "--dry-run",
    ]);
    assert_eq!(plan["blocked"], true);
    assert_eq!(plan["distribution"]["blocked"], true);
    f.ok(&[
        "skill",
        "link",
        source.to_str().unwrap(),
        "--as",
        "probe",
        "--catalog",
    ]);
    let replacement = f.skill("replacement");
    let plan = f.json(&[
        "skill",
        "link",
        replacement.to_str().unwrap(),
        "--as",
        "probe",
        "--catalog",
        "--dry-run",
    ]);
    assert_eq!(plan["blocked"], false);
    f.ok(&[
        "skill",
        "link",
        replacement.to_str().unwrap(),
        "--as",
        "probe",
        "--catalog",
    ]);
    assert_eq!(
        fs::read_link(f.catalog.join("skills/probe")).unwrap(),
        replacement.canonicalize().unwrap()
    );
}
