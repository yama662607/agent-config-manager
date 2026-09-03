use agent_config_manager::catalog::catalog::add_skill;
use agent_config_manager::paths::home_dir;
use agent_config_manager::tui::app::{ActiveTab, App};
use agent_config_manager::types::TargetName;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::backend::TestBackend;
use ratatui::Terminal;
use std::sync::Mutex;
use tempfile::tempdir;

static TUI_TEST_LOCK: Mutex<()> = Mutex::new(());

fn make_key(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::NONE)
}

fn make_ctrl_key(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::CONTROL)
}

#[test]
fn test_tui_full_interaction_scenarios() {
    let _guard = TUI_TEST_LOCK.lock().unwrap();

    let dir = tempdir().unwrap();
    let cat_dir = tempdir().unwrap();
    std::env::set_var("ACM_CATALOG_DIR", cat_dir.path().to_str().unwrap());

    // Populate catalog with skills
    add_skill("alpha-skill", "---\nname: alpha-skill\ndescription: Alpha description\n---\n# Header\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10").unwrap();
    add_skill("beta-skill", "---\nname: beta-skill\ndescription: Beta description\n---\n").unwrap();
    add_skill("gamma-skill", "---\nname: gamma-skill\ndescription: Gamma description\n---\n").unwrap();

    let targets = vec![TargetName::Claude, TargetName::Codex, TargetName::Antigravity, TargetName::Grok];
    let mut app = App::new(dir.path().to_path_buf(), targets);

    // --- Scenario 1: Initial State & Tab Navigation ---
    assert_eq!(app.active_tab, ActiveTab::Skills);
    assert_eq!(app.skills.len(), 3);
    assert!(!app.is_home_scope);

    // --- Scenario 2: Scope Switching ('H') ---
    app.handle_key(make_key(KeyCode::Char('H')));
    assert!(app.is_home_scope);
    assert_eq!(app.project_root, home_dir());

    app.handle_key(make_key(KeyCode::Char('H')));
    assert!(!app.is_home_scope);
    assert_eq!(app.project_root, dir.path());

    // --- Scenario 3: Ctrl+N / Ctrl+P Navigation ---
    assert_eq!(app.selected_skill_index, 0);
    app.handle_key(make_ctrl_key(KeyCode::Char('n')));
    assert_eq!(app.selected_skill_index, 1);
    app.handle_key(make_ctrl_key(KeyCode::Char('n')));
    assert_eq!(app.selected_skill_index, 2);
    app.handle_key(make_ctrl_key(KeyCode::Char('p')));
    assert_eq!(app.selected_skill_index, 1);
    app.handle_key(make_ctrl_key(KeyCode::Char('p')));
    assert_eq!(app.selected_skill_index, 0);

    // --- Scenario 4: Target Specific Toggle ('c', 'x', 'a', 'g') ---
    app.selected_skill_index = 0; // alpha-skill
    assert_eq!(app.filtered_skills()[0].targets.len(), 0);

    // Toggle Claude only
    app.handle_key(make_key(KeyCode::Char('c')));
    assert!(dir.path().join(".claude").join("skills").join("alpha-skill").exists());
    assert!(!dir.path().join(".codex").join("skills").join("alpha-skill").exists());

    // Toggle Codex only
    app.handle_key(make_key(KeyCode::Char('x')));
    assert!(dir.path().join(".codex").join("skills").join("alpha-skill").exists());

    // --- Scenario 5: Preview Scrolling ('J' / 'K') ---
    assert_eq!(app.preview_scroll, 0);
    app.handle_key(make_key(KeyCode::Char('J')));
    assert!(app.preview_scroll > 0);
    app.handle_key(make_key(KeyCode::Char('K')));
    assert_eq!(app.preview_scroll, 0);

    // --- Scenario 6: Realtime Incremental Search with Ctrl+N ---
    app.handle_key(make_key(KeyCode::Char('/')));
    assert!(app.search_mode);

    app.handle_key(make_key(KeyCode::Char('s')));
    app.handle_key(make_key(KeyCode::Char('k')));
    app.handle_key(make_key(KeyCode::Char('i')));
    app.handle_key(make_key(KeyCode::Char('l')));
    app.handle_key(make_key(KeyCode::Char('l')));
    assert_eq!(app.filtered_skills().len(), 3);

    // Navigate inside search mode with Ctrl+N
    app.handle_key(make_ctrl_key(KeyCode::Char('n')));
    assert_eq!(app.selected_skill_index, 1);

    // Exit search mode
    app.handle_key(make_key(KeyCode::Enter));
    assert!(!app.search_mode);

    // --- Scenario 7: Render Layouts (No Panics) ---
    let backend = TestBackend::new(140, 45);
    let mut terminal = Terminal::new(backend).unwrap();

    app.active_tab = ActiveTab::Skills;
    terminal.draw(|f| agent_config_manager::tui::ui::render(f, &mut app)).unwrap();

    app.active_tab = ActiveTab::Mcp;
    terminal.draw(|f| agent_config_manager::tui::ui::render(f, &mut app)).unwrap();

    app.active_tab = ActiveTab::Plugins;
    terminal.draw(|f| agent_config_manager::tui::ui::render(f, &mut app)).unwrap();

    app.active_tab = ActiveTab::Doctor;
    terminal.draw(|f| agent_config_manager::tui::ui::render(f, &mut app)).unwrap();

    // --- Scenario 8: Exit Key ('q') ---
    assert!(app.running);
    app.handle_key(make_key(KeyCode::Char('q')));
    assert!(!app.running);
}
