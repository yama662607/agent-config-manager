use agent_config_manager::catalog::store::add_skill;
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
    let _guard = TUI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());

    let _restore = IsolatedEnvironment::capture();
    let dir = tempdir().unwrap();
    let test_home = tempdir().unwrap();
    std::env::set_var("HOME", test_home.path());
    std::env::set_var("USERPROFILE", test_home.path());
    let cat_dir = tempdir().unwrap();
    std::env::set_var("ACM_CATALOG_DIR", cat_dir.path().to_str().unwrap());

    // Populate catalog with skills
    add_skill("alpha-skill", "---\nname: alpha-skill\ndescription: Alpha description\n---\n# Header\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10").unwrap();
    add_skill(
        "beta-skill",
        "---\nname: beta-skill\ndescription: Beta description\n---\n",
    )
    .unwrap();
    add_skill(
        "gamma-skill",
        "---\nname: gamma-skill\ndescription: Gamma description\n---\n",
    )
    .unwrap();

    let targets = vec![
        TargetName::Claude,
        TargetName::Codex,
        TargetName::Antigravity,
        TargetName::Grok,
    ];
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
    assert!(dir
        .path()
        .join(".claude")
        .join("skills")
        .join("alpha-skill")
        .exists());
    assert!(!dir
        .path()
        .join(".codex")
        .join("skills")
        .join("alpha-skill")
        .exists());

    // Toggle Codex only
    app.handle_key(make_key(KeyCode::Char('x')));
    assert!(dir
        .path()
        .join(".codex")
        .join("skills")
        .join("alpha-skill")
        .exists());

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
    terminal
        .draw(|f| agent_config_manager::tui::ui::render(f, &mut app))
        .unwrap();

    app.active_tab = ActiveTab::Mcp;
    terminal
        .draw(|f| agent_config_manager::tui::ui::render(f, &mut app))
        .unwrap();

    app.active_tab = ActiveTab::Plugins;
    terminal
        .draw(|f| agent_config_manager::tui::ui::render(f, &mut app))
        .unwrap();

    app.active_tab = ActiveTab::Doctor;
    terminal
        .draw(|f| agent_config_manager::tui::ui::render(f, &mut app))
        .unwrap();

    // --- Scenario 8: Exit Key ('q') ---
    assert!(app.running);
    app.handle_key(make_key(KeyCode::Char('q')));
    assert!(!app.running);
}

mod common;
use common::{json_file, toml_file, write, Fixture};
use std::ffi::OsString;
use std::fs;

struct IsolatedEnvironment(Vec<(&'static str, Option<OsString>)>);
impl IsolatedEnvironment {
    fn capture() -> Self {
        let keys = [
            "HOME",
            "USERPROFILE",
            "ACM_CATALOG_DIR",
            "PATH",
            "CODEX_HOME",
            "CLAUDE_CONFIG_DIR",
        ];
        let original = keys
            .into_iter()
            .map(|key| (key, std::env::var_os(key)))
            .collect();
        Self(original)
    }
    fn new(fixture: &Fixture) -> Self {
        let original = Self::capture();
        std::env::set_var("HOME", &fixture.home);
        std::env::set_var("USERPROFILE", &fixture.home);
        std::env::set_var("ACM_CATALOG_DIR", &fixture.catalog);
        std::env::remove_var("CODEX_HOME");
        std::env::remove_var("CLAUDE_CONFIG_DIR");
        original
    }
    #[cfg(unix)]
    fn providers(&self, fixture: &Fixture) {
        let mut paths = vec![fixture.providers()];
        paths.extend(std::env::split_paths(&std::env::var_os("PATH").unwrap()));
        std::env::set_var("PATH", std::env::join_paths(paths).unwrap());
    }
}
impl Drop for IsolatedEnvironment {
    fn drop(&mut self) {
        for (key, value) in &self.0 {
            match value {
                Some(value) => std::env::set_var(key, value),
                None => std::env::remove_var(key),
            }
        }
    }
}

fn catalog_skill() {
    add_skill(
        "alpha",
        "---\nname: alpha\ndescription: An isolated test skill.\n---\nOriginal content",
    )
    .unwrap();
}

#[test]
fn tui_deletion_preserves_partial_results_and_reports_failure() {
    let _lock = TUI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let fixture = Fixture::new();
    let _env = IsolatedEnvironment::new(&fixture);
    catalog_skill();
    let targets = vec![TargetName::Claude, TargetName::Grok];
    agent_config_manager::core::skill::skill_add(&fixture.project, "alpha", &targets, None)
        .unwrap();
    let mut app = App::new(fixture.project.clone(), targets);
    let blocked = fixture.project.join(".grok/config.toml");
    fs::write(&blocked, "invalid = [").unwrap();
    app.handle_key(make_key(KeyCode::Char('d')));
    let message = app.status_message.as_deref().unwrap();
    assert!(message.contains("claude: removed"), "{message}");
    assert!(message.contains("grok: failed"), "{message}");
    assert!(message.contains("Retry targets: grok"), "{message}");
    assert!(!fixture.project.join(".claude/skills/alpha").exists());
    assert_eq!(fs::read_to_string(blocked).unwrap(), "invalid = [");
}

#[test]
fn tui_empty_search_update_and_unconfigured_target_never_mutate() {
    let _lock = TUI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let fixture = Fixture::new();
    let _env = IsolatedEnvironment::new(&fixture);
    catalog_skill();
    let mut app = App::new(fixture.project.clone(), vec![TargetName::Codex]);
    app.handle_key(make_key(KeyCode::Char('c')));
    assert!(app
        .status_message
        .as_deref()
        .unwrap()
        .contains("outside the configured targets"));
    assert!(!fixture.project.join(".claude").exists());
    agent_config_manager::core::skill::skill_add(
        &fixture.project,
        "alpha",
        &[TargetName::Codex],
        None,
    )
    .unwrap();
    let destination = fixture.project.join(".codex/skills/alpha/SKILL.md");
    let original = fs::read(&destination).unwrap();
    write(
        &fixture.catalog.join("skills/alpha/SKILL.md"),
        "---\nname: alpha\ndescription: Changed upstream.\n---\nChanged",
    );
    app.refresh();
    app.search_query = "does-not-exist".into();
    app.handle_key(make_key(KeyCode::Char('u')));
    assert!(app
        .status_message
        .as_deref()
        .unwrap()
        .contains("No item selected"));
    assert_eq!(fs::read(&destination).unwrap(), original);
}

#[test]
fn tui_update_and_doctor_errors_replace_stale_success_messages() {
    let _lock = TUI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let fixture = Fixture::new();
    let _env = IsolatedEnvironment::new(&fixture);
    catalog_skill();
    let mut app = App::new(fixture.project.clone(), vec![TargetName::Grok]);
    write(&fixture.project.join(".grok/config.toml"), "invalid = [");
    app.status_message = Some("Previous operation succeeded".into());
    app.handle_key(make_key(KeyCode::Char('u')));
    assert!(app
        .status_message
        .as_deref()
        .unwrap()
        .contains("Error during Update skill"));
    app.active_tab = ActiveTab::Doctor;
    app.handle_key(make_key(KeyCode::Char('f')));
    let message = app.status_message.as_deref().unwrap();
    assert!(message.contains("warnings/errors remain"), "{message}");
    assert!(app.doctor_report.as_ref().unwrap().has_errors);
}

#[test]
fn tui_editor_selects_configured_target_and_preserves_disabled_state() {
    let _lock = TUI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let fixture = Fixture::new();
    let _env = IsolatedEnvironment::new(&fixture);
    write(
        &fixture.project.join(".mcp.json"),
        r#"{"mcpServers":{"echo":{"command":"echo","args":["claude"]}}}"#,
    );
    let codex = fixture.project.join(".codex/config.toml");
    write(&codex, "# keep this comment\n[mcp_servers.echo]\ncommand = 'echo'\nargs = ['codex']\nenabled = false\ncustom_field = 'retain'\n");
    let before_claude = fs::read(fixture.project.join(".mcp.json")).unwrap();
    let mut app = App::new(
        fixture.project.clone(),
        vec![TargetName::Claude, TargetName::Codex],
    );
    app.active_tab = ActiveTab::Mcp;
    app.handle_key(make_key(KeyCode::Char('e')));
    assert!(app.pending_editor_file.is_none());
    assert_eq!(app.pending_edit_targets.len(), 2);
    app.handle_key(make_key(KeyCode::Char('x')));
    assert!(app.pending_edit_targets.is_empty());
    let editor = app.pending_editor_file.take().unwrap();
    assert_ne!(editor, codex);
    assert_eq!(json_file(&editor)["args"][0], "codex");
    fs::write(&editor, r#"{"command":"echo","args":["edited"]}"#).unwrap();
    app.complete_editor(&editor, Ok(()));
    assert!(app
        .status_message
        .as_deref()
        .unwrap()
        .contains("Updated MCP echo on codex"));
    assert_eq!(
        toml_file(&codex)["mcp_servers"]["echo"]["args"][0],
        "edited"
    );
    assert_eq!(toml_file(&codex)["mcp_servers"]["echo"]["enabled"], false);
    assert_eq!(
        toml_file(&codex)["mcp_servers"]["echo"]["custom_field"],
        "retain"
    );
    assert!(fs::read_to_string(&codex)
        .unwrap()
        .contains("# keep this comment"));
    assert_eq!(
        fs::read(fixture.project.join(".mcp.json")).unwrap(),
        before_claude
    );
}

#[test]
fn tui_mcp_editor_rejects_invalid_or_concurrently_changed_recipes() {
    let _lock = TUI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let fixture = Fixture::new();
    let _env = IsolatedEnvironment::new(&fixture);
    let config = fixture.project.join(".codex/config.toml");
    write(
        &config,
        "[mcp_servers.echo]\ncommand = 'echo'\nargs = ['original']\n",
    );
    let original = fs::read(&config).unwrap();
    let mut app = App::new(fixture.project.clone(), vec![TargetName::Codex]);
    app.active_tab = ActiveTab::Mcp;
    app.handle_key(make_key(KeyCode::Char('e')));
    let file = app.pending_editor_file.take().unwrap();
    fs::write(&file, r#"{"command":"echo","argument_typo":["lost"]}"#).unwrap();
    app.complete_editor(&file, Ok(()));
    assert!(app
        .status_message
        .as_deref()
        .unwrap()
        .contains("Unknown MCP recipe field"));
    assert_eq!(fs::read(&config).unwrap(), original);
    app.handle_key(make_key(KeyCode::Char('e')));
    let file = app.pending_editor_file.take().unwrap();
    fs::write(&file, r#"{"command":"echo","args":["my edit"]}"#).unwrap();
    write(
        &config,
        "[mcp_servers.echo]\ncommand = 'echo'\nargs = ['concurrent edit']\n",
    );
    app.complete_editor(&file, Ok(()));
    assert!(app.status_message.as_deref().unwrap().contains("conflict"));
    assert_eq!(
        toml_file(&config)["mcp_servers"]["echo"]["args"][0],
        "concurrent edit"
    );
}

#[test]
fn tui_inline_skill_preview_and_plugin_edit_respect_targets() {
    let _lock = TUI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let fixture = Fixture::new();
    let _env = IsolatedEnvironment::new(&fixture);
    let skill = fixture.project.join(".codex/skills/inline/SKILL.md");
    write(
        &skill,
        "---\nname: inline\ndescription: Codex only.\n---\nCodex preview",
    );
    let mut app = App::new(fixture.project.clone(), vec![TargetName::Codex]);
    app.handle_key(make_key(KeyCode::Char('e')));
    assert_eq!(app.pending_editor_file.take().unwrap(), skill);
    assert_eq!(app.skill_editor_path("inline").unwrap(), skill);
    for target in ["claude", "codex"] {
        write(
            &fixture
                .catalog
                .join(format!("plugins/test/.{target}-plugin/plugin.json")),
            r#"{"name":"test","version":"1"}"#,
        );
    }
    app.refresh();
    app.active_tab = ActiveTab::Plugins;
    app.handle_key(make_key(KeyCode::Char('e')));
    assert_eq!(
        app.pending_editor_file.take().unwrap(),
        fixture
            .catalog
            .join("plugins/test/.codex-plugin/plugin.json")
    );
}

#[cfg(unix)]
#[test]
fn tui_native_plugin_failure_never_claims_uninstalled() {
    let _lock = TUI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let fixture = Fixture::new();
    let env = IsolatedEnvironment::new(&fixture);
    env.providers(&fixture);
    let plugin = fixture.file(
        "source/.codex-plugin/plugin.json",
        r#"{"name":"test","version":"1.0"}"#,
    );
    agent_config_manager::core::plugin::plugin_import(
        plugin.parent().unwrap().parent().unwrap(),
        None,
        false,
    )
    .unwrap();
    agent_config_manager::core::plugin::plugin_install(&fixture.home, "test", &[TargetName::Codex])
        .unwrap();
    let mut app = App::new(fixture.home.clone(), vec![TargetName::Codex]);
    app.active_tab = ActiveTab::Plugins;
    fixture.file("home/fail-provider", "fail");
    app.handle_key(make_key(KeyCode::Char('d')));
    let message = app.status_message.as_deref().unwrap();
    assert!(message.contains("codex: failed"), "{message}");
    assert!(!message.contains("codex: uninstalled"), "{message}");
    assert!(app.plugins[0].enabled);
}

#[cfg(unix)]
#[test]
fn tui_claude_home_editor_delegates_and_failed_editor_does_not_apply() {
    let _lock = TUI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let fixture = Fixture::new();
    let env = IsolatedEnvironment::new(&fixture);
    env.providers(&fixture);
    let config = fixture.home.join(".claude.json");
    write(
        &config,
        r#"{"mcpServers":{"echo":{"command":"echo","args":["original"],"custom":"keep"}},"runtimeState":{"keep":true}}"#,
    );
    let mut app = App::new(fixture.home.clone(), vec![TargetName::Claude]);
    app.active_tab = ActiveTab::Mcp;
    app.handle_key(make_key(KeyCode::Char('e')));
    let file = app.pending_editor_file.take().unwrap();
    fs::write(&file, r#"{"command":"echo","args":["cancelled"]}"#).unwrap();
    app.complete_editor(&file, Err(anyhow::anyhow!("editor failed")));
    assert!(app
        .status_message
        .as_deref()
        .unwrap()
        .contains("editor failed"));
    assert!(!fixture.home.join("calls.jsonl").exists());
    assert_eq!(
        json_file(&config)["mcpServers"]["echo"]["args"][0],
        "original"
    );
    app.handle_key(make_key(KeyCode::Char('e')));
    let file = app.pending_editor_file.take().unwrap();
    fs::write(&file, r#"{"command":"echo","args":["applied"]}"#).unwrap();
    app.complete_editor(&file, Ok(()));
    assert!(app
        .status_message
        .as_deref()
        .unwrap()
        .contains("Updated MCP echo on claude"));
    let calls = fs::read_to_string(fixture.home.join("calls.jsonl")).unwrap();
    assert!(calls.contains("add-json"));
    assert_eq!(
        json_file(&config)["mcpServers"]["echo"]["args"][0],
        "applied"
    );
    assert_eq!(json_file(&config)["mcpServers"]["echo"]["custom"], "keep");
    fixture.file("home/fail-provider", "fail");
    app.handle_key(make_key(KeyCode::Char('e')));
    let file = app.pending_editor_file.take().unwrap();
    fs::write(&file, r#"{"command":"echo","args":["failed apply"]}"#).unwrap();
    app.complete_editor(&file, Ok(()));
    assert!(app
        .status_message
        .as_deref()
        .unwrap()
        .contains("Error editing"));
    assert_eq!(
        json_file(&config)["mcpServers"]["echo"]["args"][0],
        "applied"
    );
}

#[cfg(unix)]
#[test]
fn external_editor_checks_exit_status_spawn_errors_and_quoted_arguments() {
    use agent_config_manager::tui::app::run_external_editor;
    use std::os::unix::fs::PermissionsExt;
    let fixture = Fixture::new();
    let file = fixture.temp.path().join("file with spaces.json");
    let editor = fixture.file(
        "editor with spaces",
        "#!/bin/sh\nprintf '%s' \"$1\" > \"$2\"\n",
    );
    fs::set_permissions(&editor, fs::Permissions::from_mode(0o755)).unwrap();
    run_external_editor(
        &format!("'{}' 'argument with spaces'", editor.display()),
        &file,
    )
    .unwrap();
    assert_eq!(fs::read_to_string(&file).unwrap(), "argument with spaces");
    assert!(run_external_editor("/bin/sh -c 'exit 23'", &file)
        .unwrap_err()
        .to_string()
        .contains("unsuccessfully"));
    assert!(run_external_editor("/missing/editor", &file)
        .unwrap_err()
        .to_string()
        .contains("Could not start"));
    assert!(run_external_editor("", &file)
        .unwrap_err()
        .to_string()
        .contains("empty"));
    assert!(run_external_editor("'unterminated", &file)
        .unwrap_err()
        .to_string()
        .contains("unterminated"));
}

#[cfg(unix)]
#[test]
fn tui_repair_filesystem_failure_is_visible() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let _lock = TUI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let fixture = Fixture::new();
    let _env = IsolatedEnvironment::new(&fixture);
    let dir = fixture.project.join(".codex/skills");
    fs::create_dir_all(&dir).unwrap();
    symlink(fixture.temp.path().join("missing"), dir.join("dangling")).unwrap();
    let mut app = App::new(fixture.project.clone(), vec![TargetName::Codex]);
    app.active_tab = ActiveTab::Doctor;
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o555)).unwrap();
    app.handle_key(make_key(KeyCode::Char('f')));
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
    // Root can remove entries despite directory permissions; ordinary users exercise the failure.
    if fs::symlink_metadata(dir.join("dangling")).is_ok() {
        let message = app.status_message.as_deref().unwrap();
        assert!(message.contains("Error repairing diagnostics"), "{message}");
        assert!(!message.contains("Repair completed"), "{message}");
    }
}

#[test]
fn tui_home_scope_cannot_be_mislabelled_as_project() {
    let _lock = TUI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let fixture = Fixture::new();
    let _env = IsolatedEnvironment::new(&fixture);
    let mut app = App::new(fixture.home.clone(), vec![TargetName::Codex]);
    app.handle_key(make_key(KeyCode::Char('H')));
    assert!(app.is_home_scope);
    assert_eq!(app.project_root, fixture.home);
    assert!(app
        .status_message
        .unwrap()
        .contains("restart ACM from a project"));
}

#[test]
fn tui_plugin_update_failure_is_visible_and_preserves_catalog() {
    let _lock = TUI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let fixture = Fixture::new();
    let _env = IsolatedEnvironment::new(&fixture);
    let source = fixture.file(
        "source/.codex-plugin/plugin.json",
        r#"{"name":"test","version":"1.0"}"#,
    );
    agent_config_manager::core::plugin::plugin_import(
        source.parent().unwrap().parent().unwrap(),
        None,
        false,
    )
    .unwrap();
    let catalog_manifest = fixture
        .catalog
        .join("plugins/test/.codex-plugin/plugin.json");
    let before = fs::read(&catalog_manifest).unwrap();
    let mut app = App::new(fixture.home.clone(), vec![TargetName::Codex]);
    app.active_tab = ActiveTab::Plugins;
    fs::write(&source, "invalid JSON").unwrap();
    app.handle_key(make_key(KeyCode::Char('u')));
    assert!(app
        .status_message
        .as_deref()
        .unwrap()
        .contains("Error updating plugin test"));
    assert_eq!(fs::read(&catalog_manifest).unwrap(), before);
}

#[cfg(unix)]
#[test]
fn tui_disabled_claude_recipe_can_be_edited_without_activation() {
    let _lock = TUI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let fixture = Fixture::new();
    let env = IsolatedEnvironment::new(&fixture);
    env.providers(&fixture);
    let config = fixture.home.join(".claude.json");
    write(
        &config,
        r#"{"mcpServers":{"echo":{"command":"echo","args":["original"]}}}"#,
    );
    agent_config_manager::adapters::set_mcp_enabled(TargetName::Claude, &config, "echo", false)
        .unwrap();
    let calls = fs::read(fixture.home.join("calls.jsonl")).unwrap();
    let mut app = App::new(fixture.home.clone(), vec![TargetName::Claude]);
    app.active_tab = ActiveTab::Mcp;
    app.handle_key(make_key(KeyCode::Char('e')));
    let file = app.pending_editor_file.take().unwrap();
    fs::write(&file, r#"{"command":"echo","args":["saved edit"]}"#).unwrap();
    app.complete_editor(&file, Ok(()));
    assert!(app
        .status_message
        .as_deref()
        .unwrap()
        .contains("Updated MCP echo on claude"));
    assert_eq!(fs::read(fixture.home.join("calls.jsonl")).unwrap(), calls);
    assert!(json_file(&config)["mcpServers"].get("echo").is_none());
    let servers =
        agent_config_manager::adapters::get_mcp_servers(TargetName::Claude, &config).unwrap();
    assert!(!servers["echo"].enabled);
    assert_eq!(
        servers["echo"]
            .recipe
            .as_ref()
            .unwrap()
            .args
            .as_ref()
            .unwrap()[0],
        "saved edit"
    );
}
