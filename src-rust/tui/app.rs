use crate::core::doctor::{run_doctor, DiagnosticReport};
use crate::core::mcp::{get_mcp_workspace_status, mcp_disable, mcp_enable, mcp_remove};
use crate::core::skill::{get_skill_workspace_status, skill_add, skill_remove, skill_update};
use crate::paths::{get_agent_mcp_config_path, get_catalog_skill_dir, get_skill_path, home_dir};
use crate::types::{McpStatus, SkillPlacementState, SkillStatus, TargetName};
use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use crossterm::execute;
use crossterm::terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen};
use ratatui::backend::CrosstermBackend;
use ratatui::Terminal;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActiveTab {
    Skills,
    Mcp,
    Doctor,
}

pub struct App {
    pub initial_project_root: PathBuf,
    pub project_root: PathBuf,
    pub is_home_scope: bool,
    pub targets: Vec<TargetName>,
    pub active_tab: ActiveTab,
    pub running: bool,

    // Skills state
    pub skills: Vec<SkillStatus>,
    pub selected_skill_index: usize,

    // MCP state
    pub mcps: Vec<McpStatus>,
    pub selected_mcp_index: usize,

    // Doctor state
    pub doctor_report: Option<DiagnosticReport>,

    // Search / Filter
    pub search_mode: bool,
    pub search_query: String,

    // Preview scroll
    pub preview_scroll: u16,

    // Status / Message
    pub status_message: Option<String>,

    // Flag to trigger external editor
    pub pending_editor_file: Option<PathBuf>,
}

impl App {
    pub fn new(project_root: PathBuf, targets: Vec<TargetName>) -> Self {
        let is_home = project_root == home_dir();
        let mut app = Self {
            initial_project_root: project_root.clone(),
            project_root,
            is_home_scope: is_home,
            targets,
            active_tab: ActiveTab::Skills,
            running: true,
            skills: Vec::new(),
            selected_skill_index: 0,
            mcps: Vec::new(),
            selected_mcp_index: 0,
            doctor_report: None,
            search_mode: false,
            search_query: String::new(),
            preview_scroll: 0,
            status_message: None,
            pending_editor_file: None,
        };
        app.refresh();
        app
    }

    pub fn refresh(&mut self) {
        if let Ok(skill_ws) = get_skill_workspace_status(&self.project_root, &self.targets) {
            self.skills = skill_ws.skills;
        }
        if let Ok(mcp_ws) = get_mcp_workspace_status(&self.project_root, &self.targets) {
            self.mcps = mcp_ws.servers;
        }
        if let Ok(report) = run_doctor(&self.project_root, false, &self.targets) {
            self.doctor_report = Some(report);
        }
        self.clamp_indices();
    }

    fn clamp_indices(&mut self) {
        let skill_count = self.filtered_skills().len();
        if skill_count == 0 {
            self.selected_skill_index = 0;
        } else if self.selected_skill_index >= skill_count {
            self.selected_skill_index = skill_count - 1;
        }

        let mcp_count = self.filtered_mcps().len();
        if mcp_count == 0 {
            self.selected_mcp_index = 0;
        } else if self.selected_mcp_index >= mcp_count {
            self.selected_mcp_index = mcp_count - 1;
        }
    }

    pub fn toggle_scope(&mut self) {
        self.is_home_scope = !self.is_home_scope;
        if self.is_home_scope {
            self.project_root = home_dir();
            self.status_message = Some("Switched scope to Global (~/)".to_string());
        } else {
            self.project_root = self.initial_project_root.clone();
            self.status_message = Some(format!("Switched scope to Project ({})", self.project_root.display()));
        }
        self.selected_skill_index = 0;
        self.selected_mcp_index = 0;
        self.preview_scroll = 0;
        self.refresh();
    }

    pub fn filtered_skills(&self) -> Vec<&SkillStatus> {
        if self.search_query.is_empty() {
            self.skills.iter().collect()
        } else {
            let q = self.search_query.to_lowercase();
            self.skills
                .iter()
                .filter(|s| s.name.to_lowercase().contains(&q))
                .collect()
        }
    }

    pub fn filtered_mcps(&self) -> Vec<&McpStatus> {
        if self.search_query.is_empty() {
            self.mcps.iter().collect()
        } else {
            let q = self.search_query.to_lowercase();
            self.mcps
                .iter()
                .filter(|m| m.name.to_lowercase().contains(&q))
                .collect()
        }
    }

    pub fn nav_down(&mut self) {
        self.preview_scroll = 0;
        match self.active_tab {
            ActiveTab::Skills => {
                let count = self.filtered_skills().len();
                if count > 0 {
                    self.selected_skill_index = (self.selected_skill_index + 1) % count;
                }
            }
            ActiveTab::Mcp => {
                let count = self.filtered_mcps().len();
                if count > 0 {
                    self.selected_mcp_index = (self.selected_mcp_index + 1) % count;
                }
            }
            ActiveTab::Doctor => {}
        }
    }

    pub fn nav_up(&mut self) {
        self.preview_scroll = 0;
        match self.active_tab {
            ActiveTab::Skills => {
                let count = self.filtered_skills().len();
                if count > 0 {
                    self.selected_skill_index = if self.selected_skill_index == 0 {
                        count - 1
                    } else {
                        self.selected_skill_index - 1
                    };
                }
            }
            ActiveTab::Mcp => {
                let count = self.filtered_mcps().len();
                if count > 0 {
                    self.selected_mcp_index = if self.selected_mcp_index == 0 {
                        count - 1
                    } else {
                        self.selected_mcp_index - 1
                    };
                }
            }
            ActiveTab::Doctor => {}
        }
    }

    pub fn toggle_single_target(&mut self, target: TargetName) {
        match self.active_tab {
            ActiveTab::Skills => {
                let filtered = self.filtered_skills();
                if let Some(skill) = filtered.get(self.selected_skill_index) {
                    let name = skill.name.clone();
                    let placement = skill.placement.get(&target).copied().unwrap_or(SkillPlacementState::Missing);
                    let is_active = placement != SkillPlacementState::Missing && placement != SkillPlacementState::BrokenLink;

                    if is_active {
                        let _ = skill_remove(&self.project_root, &name, &[target]);
                        self.status_message = Some(format!("Disabled {} on {}", name, target));
                    } else {
                        let _ = skill_add(&self.project_root, &name, &[target], None);
                        self.status_message = Some(format!("Enabled {} on {}", name, target));
                    }
                    self.refresh();
                }
            }
            ActiveTab::Mcp => {
                let filtered = self.filtered_mcps();
                if let Some(mcp) = filtered.get(self.selected_mcp_index) {
                    let name = mcp.name.clone();
                    if mcp.targets.contains(&target) {
                        let _ = mcp_remove(&self.project_root, &name, &[target]);
                        self.status_message = Some(format!("Removed {} from {}", name, target));
                    } else {
                        let _ = crate::core::mcp::mcp_add(&self.project_root, &name, &[target], Some(&mcp.recipe));
                        self.status_message = Some(format!("Added {} to {}", name, target));
                    }
                    self.refresh();
                }
            }
            ActiveTab::Doctor => {}
        }
    }

    pub fn handle_key(&mut self, key: KeyEvent) {
        // Only handle Press event (guards against KeyRelease on Windows / modern terminals)
        if key.kind != KeyEventKind::Press {
            return;
        }

        // Ctrl+C immediate graceful termination
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            self.running = false;
            return;
        }

        // Ctrl+N / Ctrl+P navigation (works both in search mode and normal mode)
        if key.modifiers.contains(KeyModifiers::CONTROL) {
            match key.code {
                KeyCode::Char('n') => {
                    self.nav_down();
                    return;
                }
                KeyCode::Char('p') => {
                    self.nav_up();
                    return;
                }
                _ => {}
            }
        }

        if self.search_mode {
            match key.code {
                KeyCode::Esc | KeyCode::Enter => {
                    self.search_mode = false;
                }
                KeyCode::Down => {
                    self.nav_down();
                }
                KeyCode::Up => {
                    self.nav_up();
                }
                KeyCode::Backspace => {
                    self.search_query.pop();
                    self.selected_skill_index = 0;
                    self.selected_mcp_index = 0;
                    self.preview_scroll = 0;
                }
                KeyCode::Char(c) => {
                    self.search_query.push(c);
                    self.selected_skill_index = 0;
                    self.selected_mcp_index = 0;
                    self.preview_scroll = 0;
                }
                _ => {}
            }
            return;
        }

        match key.code {
            KeyCode::Char('q') | KeyCode::Esc => {
                self.running = false;
            }
            KeyCode::Tab => {
                self.active_tab = match self.active_tab {
                    ActiveTab::Skills => ActiveTab::Mcp,
                    ActiveTab::Mcp => ActiveTab::Doctor,
                    ActiveTab::Doctor => ActiveTab::Skills,
                };
                self.preview_scroll = 0;
            }
            KeyCode::Char('1') => {
                self.active_tab = ActiveTab::Skills;
                self.preview_scroll = 0;
            }
            KeyCode::Char('2') => {
                self.active_tab = ActiveTab::Mcp;
                self.preview_scroll = 0;
            }
            KeyCode::Char('3') => {
                self.active_tab = ActiveTab::Doctor;
                self.preview_scroll = 0;
            }
            // Scope toggle
            KeyCode::Char('H') | KeyCode::Char('S') => {
                self.toggle_scope();
            }
            // Realtime search
            KeyCode::Char('/') => {
                self.search_mode = true;
            }
            // List navigation (j, k, Down, Up)
            KeyCode::Char('j') | KeyCode::Down => {
                self.nav_down();
            }
            KeyCode::Char('k') | KeyCode::Up => {
                self.nav_up();
            }
            // Preview scrolling
            KeyCode::PageDown | KeyCode::Char('J') => {
                self.preview_scroll = self.preview_scroll.saturating_add(5);
            }
            KeyCode::PageUp | KeyCode::Char('K') => {
                self.preview_scroll = self.preview_scroll.saturating_sub(5);
            }
            // Toggle all targets
            KeyCode::Char(' ') => match self.active_tab {
                ActiveTab::Skills => {
                    let filtered = self.filtered_skills();
                    if let Some(skill) = filtered.get(self.selected_skill_index) {
                        let name = skill.name.clone();
                        let is_enabled = skill.enabled;
                        if is_enabled {
                            let _ = skill_remove(&self.project_root, &name, &self.targets);
                            self.status_message = Some(format!("Disabled skill: {}", name));
                        } else {
                            let _ = skill_add(&self.project_root, &name, &self.targets, None);
                            self.status_message = Some(format!("Enabled skill: {}", name));
                        }
                        self.refresh();
                    }
                }
                ActiveTab::Mcp => {
                    let filtered = self.filtered_mcps();
                    if let Some(mcp) = filtered.get(self.selected_mcp_index) {
                        let name = mcp.name.clone();
                        if mcp.enabled {
                            let _ = mcp_disable(&self.project_root, &name, &self.targets);
                            self.status_message = Some(format!("Disabled MCP server: {}", name));
                        } else {
                            let _ = mcp_enable(&self.project_root, &name, &self.targets);
                            self.status_message = Some(format!("Enabled MCP server: {}", name));
                        }
                        self.refresh();
                    }
                }
                ActiveTab::Doctor => {}
            },
            // Target specific toggles
            KeyCode::Char('c') => self.toggle_single_target(TargetName::Claude),
            KeyCode::Char('x') => self.toggle_single_target(TargetName::Codex),
            KeyCode::Char('a') => self.toggle_single_target(TargetName::Antigravity),
            KeyCode::Char('g') => self.toggle_single_target(TargetName::Grok),
            // Edit in external editor
            KeyCode::Char('e') => match self.active_tab {
                ActiveTab::Skills => {
                    let filtered = self.filtered_skills();
                    if let Some(skill) = filtered.get(self.selected_skill_index) {
                        let skill_md = get_catalog_skill_dir(&skill.name).join("SKILL.md");
                        if skill_md.exists() {
                            self.pending_editor_file = Some(skill_md);
                        } else {
                            let target_md = get_skill_path(&self.project_root, TargetName::Claude, &skill.name).join("SKILL.md");
                            if target_md.exists() {
                                self.pending_editor_file = Some(target_md);
                            }
                        }
                    }
                }
                ActiveTab::Mcp => {
                    let config_path = get_agent_mcp_config_path(&self.project_root, TargetName::Claude);
                    if config_path.exists() {
                        self.pending_editor_file = Some(config_path);
                    }
                }
                ActiveTab::Doctor => {}
            },
            // Update stale copies
            KeyCode::Char('u') => {
                if self.active_tab == ActiveTab::Skills {
                    let filtered = self.filtered_skills();
                    let skill_filter = filtered.get(self.selected_skill_index).map(|s| s.name.as_str());
                    if let Ok(res) = skill_update(&self.project_root, skill_filter, &self.targets, false) {
                        self.status_message = Some(format!("Updated {} skill copies (skipped {})", res.updated_count, res.skipped_count));
                        self.refresh();
                    }
                }
            }
            // Auto fix doctor
            KeyCode::Char('f') => {
                if self.active_tab == ActiveTab::Doctor {
                    if let Ok(report) = run_doctor(&self.project_root, true, &self.targets) {
                        self.status_message = Some(format!("Fixed {} issues!", report.fixed_count));
                        self.doctor_report = Some(report);
                        self.refresh();
                    }
                }
            }
            // Delete
            KeyCode::Char('d') => {
                if self.active_tab == ActiveTab::Skills {
                    let filtered = self.filtered_skills();
                    if let Some(skill) = filtered.get(self.selected_skill_index) {
                        let name = skill.name.clone();
                        let _ = skill_remove(&self.project_root, &name, &self.targets);
                        self.status_message = Some(format!("Removed skill: {}", name));
                        self.refresh();
                    }
                }
            }
            _ => {}
        }
    }
}

pub fn run_tui(project_root: &Path, targets: &[TargetName]) -> anyhow::Result<()> {
    // Install panic hook to restore terminal if panic occurs
    let default_panic = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let _ = disable_raw_mode();
        let _ = execute!(io::stdout(), LeaveAlternateScreen);
        default_panic(info);
    }));

    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut app = App::new(project_root.to_path_buf(), targets.to_vec());

    while app.running {
        terminal.draw(|f| crate::tui::ui::render(f, &mut app))?;

        if let Some(file_to_edit) = app.pending_editor_file.take() {
            disable_raw_mode()?;
            execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
            terminal.show_cursor()?;

            let editor_env = std::env::var("VISUAL")
                .or_else(|_| std::env::var("EDITOR"))
                .unwrap_or_else(|_| "nano".to_string());

            let mut parts = editor_env.split_whitespace();
            if let Some(cmd) = parts.next() {
                let mut cmd_builder = Command::new(cmd);
                for arg in parts {
                    cmd_builder.arg(arg);
                }
                cmd_builder.arg(&file_to_edit);
                let _ = cmd_builder.status();
            }

            enable_raw_mode()?;
            execute!(terminal.backend_mut(), EnterAlternateScreen)?;
            terminal.hide_cursor()?;
            terminal.clear()?;

            app.status_message = Some(format!("Edited {}", file_to_edit.file_name().unwrap_or_default().to_string_lossy()));
            app.refresh();
        }

        if event::poll(std::time::Duration::from_millis(50))? {
            if let Event::Key(key) = event::read()? {
                app.handle_key(key);
            }
        }
    }

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;

    Ok(())
}
