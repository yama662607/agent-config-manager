use assert_cmd::Command;
use predicates::prelude::*;
use std::fs;
use tempfile::tempdir;

#[test]
fn test_cli_help() {
    let mut cmd = Command::cargo_bin("acm").unwrap();
    cmd.arg("--help");
    cmd.assert()
        .success()
        .stdout(predicate::str::contains("Agent Configuration Manager"));
}

#[test]
fn test_cli_skill_validate_command() {
    let dir = tempdir().unwrap();
    let skill_dir = dir.path().join("my-skill");
    fs::create_dir_all(&skill_dir).unwrap();
    fs::write(
        skill_dir.join("SKILL.md"),
        r#"---
name: my-skill
description: This is a verified skill for testing CLI validate command.
---
# Guide
"#,
    )
    .unwrap();

    let mut cmd = Command::cargo_bin("acm").unwrap();
    cmd.arg("skill").arg("validate").arg(skill_dir.to_str().unwrap());
    cmd.assert()
        .success()
        .stdout(predicate::str::contains("SKILL.md is valid"));
}

#[test]
fn test_cli_doctor_json_output() {
    let dir = tempdir().unwrap();
    let mut cmd = Command::cargo_bin("acm").unwrap();
    cmd.arg("doctor").arg("--json");
    cmd.current_dir(dir.path());
    let assert = cmd.assert().success();
    let output = String::from_utf8(assert.get_output().stdout.clone()).unwrap();
    assert!(output.contains("\"checks\":"));
}
