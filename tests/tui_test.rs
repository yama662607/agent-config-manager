use agent_config_manager::catalog::catalog::add_skill;
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

#[test]
fn test_tui_full_interaction_scenarios() {
    let _guard = TUI_TEST_LOCK.lock().unwrap();

    let dir = tempdir().unwrap();
    let cat_dir = tempdir().unwrap();
    std::env::set_var("ACM_CATALOG_DIR", cat_dir.path().to_str().unwrap());

    // Populate catalog with skills
    add_skill("alpha-skill", "---\nname: alpha-skill\ndescription: Alpha description\n---\n").unwrap();
    add_skill("beta-skill", "---\nname: beta-skill\ndescription: Beta description\n---\n").unwrap();
    add_skill("gamma-skill", "---\nname: gamma-skill\ndescription: Gamma description\n---\n").unwrap();

    let targets = vec![TargetName::Claude, TargetName::Codex];
    let mut app = App::new(dir.path().to_path_buf(), targets);

    // --- Scenario 1: Initial State & Tab Navigation ---
    assert_eq!(app.active_tab, ActiveTab::Skills);
    assert_eq!(app.skills.len(), 3);

    app.handle_key(make_key(KeyCode::Tab));
    assert_eq!(app.active_tab, ActiveTab::Mcp);

    app.handle_key(make_key(KeyCode::Tab));
    assert_eq!(app.active_tab, ActiveTab::Doctor);

    app.handle_key(make_key(KeyCode::Char('1')));
    assert_eq!(app.active_tab, ActiveTab::Skills);

    // --- Scenario 2: List Navigation ---
    assert_eq!(app.selected_skill_index, 0);
    app.handle_key(make_key(KeyCode::Char('j')));
    assert_eq!(app.selected_skill_index, 1);
    app.handle_key(make_key(KeyCode::Char('j')));
    assert_eq!(app.selected_skill_index, 2);
    app.handle_key(make_key(KeyCode::Char('j'))); // wraps around
    assert_eq!(app.selected_skill_index, 0);
    app.handle_key(make_key(KeyCode::Char('k'))); // wraps to end
    assert_eq!(app.selected_skill_index, 2);
    app.handle_key(make_key(KeyCode::Char('k')));
    assert_eq!(app.selected_skill_index, 1);

    // --- Scenario 3: Realtime Incremental Search ---
    app.handle_key(make_key(KeyCode::Char('/')));
    assert!(app.search_mode);

    app.handle_key(make_key(KeyCode::Char('g')));
    app.handle_key(make_key(KeyCode::Char('a')));
    app.handle_key(make_key(KeyCode::Char('m')));
    assert_eq!(app.search_query, "gam");

    let filtered = app.filtered_skills();
    assert_eq!(filtered.len(), 1);
    assert_eq!(filtered[0].name, "gamma-skill");

    // Exit search mode
    app.handle_key(make_key(KeyCode::Enter));
    assert!(!app.search_mode);

    // Clear search
    app.handle_key(make_key(KeyCode::Char('/')));
    app.handle_key(make_key(KeyCode::Backspace));
    app.handle_key(make_key(KeyCode::Backspace));
    app.handle_key(make_key(KeyCode::Backspace));
    assert_eq!(app.search_query, "");
    app.handle_key(make_key(KeyCode::Esc));
    assert_eq!(app.filtered_skills().len(), 3);

    // --- Scenario 4: Space Key Toggle (Add / Enable skill) ---
    app.selected_skill_index = 0; // alpha-skill
    assert_eq!(app.filtered_skills()[0].enabled, false);

    app.handle_key(make_key(KeyCode::Char(' ')));
    assert_eq!(app.filtered_skills()[0].enabled, true);
    assert!(dir.path().join(".claude").join("skills").join("alpha-skill").exists());

    // Toggle off
    app.handle_key(make_key(KeyCode::Char(' ')));
    assert_eq!(app.filtered_skills()[0].enabled, false);

    // --- Scenario 5: Render Layouts (No Panics) ---
    let backend = TestBackend::new(120, 40);
    let mut terminal = Terminal::new(backend).unwrap();

    app.active_tab = ActiveTab::Skills;
    terminal.draw(|f| agent_config_manager::tui::ui::render(f, &mut app)).unwrap();

    app.active_tab = ActiveTab::Mcp;
    terminal.draw(|f| agent_config_manager::tui::ui::render(f, &mut app)).unwrap();

    app.active_tab = ActiveTab::Doctor;
    terminal.draw(|f| agent_config_manager::tui::ui::render(f, &mut app)).unwrap();

    // --- Scenario 6: Doctor Auto-fix Action ('f') ---
    app.handle_key(make_key(KeyCode::Char('f')));
    assert!(app.status_message.is_some());

    // --- Scenario 7: Exit Key ('q') ---
    assert!(app.running);
    app.handle_key(make_key(KeyCode::Char('q')));
    assert!(!app.running);
}
