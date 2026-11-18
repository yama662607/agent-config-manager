use agent_config_manager::catalog::store::add_skill;
use agent_config_manager::tui::{app::App, ui};
use agent_config_manager::types::TargetName;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::{backend::TestBackend, Terminal};
use std::fs;

#[test]
fn profile_badge_and_shortcut_operate_on_the_selected_home() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("home");
    let catalog = temp.path().join("catalog");
    fs::create_dir_all(home.join(".acm")).unwrap();
    fs::create_dir_all(&catalog).unwrap();
    fs::write(
        home.join(".acm/config.toml"),
        r#"
[[profiles]]
id = "claude-personal"
provider = "claude"
display_name = "Claude Personal"
short_code = "cp"
tui_key = "P"
home_dir = "~/.claude-personal"
"#,
    )
    .unwrap();
    std::env::set_var("HOME", &home);
    std::env::set_var("USERPROFILE", &home);
    std::env::set_var("ACM_CATALOG_DIR", &catalog);
    std::env::remove_var("CLAUDE_CONFIG_DIR");
    std::env::remove_var("CODEX_HOME");
    add_skill(
        "fixture",
        "---\nname: fixture\ndescription: Fixture for profile testing.\n---\n# Fixture\n",
    )
    .unwrap();
    let profile: TargetName = "claude-personal".parse().unwrap();
    let mut app = App::new(home.clone(), vec![TargetName::Claude, profile]);
    let mut terminal = Terminal::new(TestBackend::new(160, 30)).unwrap();
    terminal.draw(|frame| ui::render(frame, &mut app)).unwrap();
    let buffer = terminal.backend().buffer();
    let rendered: String = buffer.content().iter().map(|c| c.symbol()).collect();
    assert!(
        rendered.contains("cp:-"),
        "profile badge missing: {rendered}"
    );
    assert!(
        rendered.contains("/P"),
        "profile shortcut missing: {rendered}"
    );
    app.handle_key(KeyEvent::new(KeyCode::Char('P'), KeyModifiers::NONE));
    assert!(
        home.join(".claude-personal/skills/fixture/SKILL.md")
            .is_file(),
        "{:?}",
        app.status_message
    );
    assert!(!home.join(".claude/skills/fixture").exists());
}
