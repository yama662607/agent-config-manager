use crate::core::doctor::{run_doctor, DiagnosticReport};
use crate::core::mcp::{get_mcp_workspace_status, mcp_disable, mcp_enable};
use crate::core::skill::{get_skill_workspace_status, skill_add, skill_remove, skill_update};
use crate::types::{McpStatus, SkillStatus, TargetName};
use crossterm::event::{self, Event, KeyCode, KeyEvent};
use crossterm::execute;
use crossterm::terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen};
use ratatui::backend::CrosstermBackend;
use ratatui::Terminal;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActiveTab {
    Skills,
    Mcp,
    Doctor,
}

pub struct App {
    pub project_root: PathBuf,
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

    // Status / Message
    pub status_message: Option<String>,
}

impl App {
    pub fn new(project_root: PathBuf, targets: Vec<TargetName>) -> Self {
        let mut app = Self {
            project_root,
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
            status_message: None,
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

    pub fn handle_key(&mut self, key: KeyEvent) {
        if self.search_mode {
            match key.code {
                KeyCode::Esc | KeyCode::Enter => {
                    self.search_mode = false;
                }
                KeyCode::Backspace => {
                    self.search_query.pop();
                    self.selected_skill_index = 0;
                    self.selected_mcp_index = 0;
                }
                KeyCode::Char(c) => {
                    self.search_query.push(c);
                    self.selected_skill_index = 0;
                    self.selected_mcp_index = 0;
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
            }
            KeyCode::Char('1') => self.active_tab = ActiveTab::Skills,
            KeyCode::Char('2') => self.active_tab = ActiveTab::Mcp,
            KeyCode::Char('3') => self.active_tab = ActiveTab::Doctor,
            KeyCode::Char('/') => {
                self.search_mode = true;
            }
            KeyCode::Char('j') | KeyCode::Down => match self.active_tab {
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
            },
            KeyCode::Char('k') | KeyCode::Up => match self.active_tab {
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
            },
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
            KeyCode::Char('f') => {
                if self.active_tab == ActiveTab::Doctor {
                    if let Ok(report) = run_doctor(&self.project_root, true, &self.targets) {
                        self.status_message = Some(format!("Fixed {} issues!", report.fixed_count));
                        self.doctor_report = Some(report);
                        self.refresh();
                    }
                }
            }
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
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut app = App::new(project_root.to_path_buf(), targets.to_vec());

    while app.running {
        terminal.draw(|f| crate::tui::ui::render(f, &mut app))?;

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
