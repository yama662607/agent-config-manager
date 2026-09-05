use crate::adapters::{get_mcp_servers, ServerInfo};
use crate::core::doctor::{run_doctor, CheckStatus, DiagnosticReport};
use crate::core::mcp::{get_mcp_workspace_status, mcp_disable, mcp_enable};
use crate::core::plugin::{get_plugin_workspace_status, plugin_install, plugin_remove};
use crate::core::skill::{get_skill_workspace_status, skill_add, skill_remove, skill_update};
use crate::paths::{
    get_agent_mcp_config_path, get_catalog_plugin_dir, get_catalog_skill_dir, get_skill_path,
    home_dir,
};
use crate::types::{McpRecipe, McpStatus, PluginStatus, SkillStatus, TargetName};
use anyhow::{bail, Context};
use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::CrosstermBackend;
use ratatui::widgets::ListState;
use ratatui::Terminal;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActiveTab {
    Skills,
    Mcp,
    Plugins,
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
    pub skill_list_state: ListState,

    // MCP state
    pub mcps: Vec<McpStatus>,
    pub selected_mcp_index: usize,
    pub mcp_list_state: ListState,

    // Plugin state
    pub plugins: Vec<PluginStatus>,
    pub selected_plugin_index: usize,
    pub plugin_list_state: ListState,

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
    pub pending_edit_targets: Vec<TargetName>,
    pending_mcp_editor: Option<McpEditor>,
}

impl App {
    pub fn new(project_root: PathBuf, targets: Vec<TargetName>) -> Self {
        let is_home = crate::paths::is_home_scope(&project_root);
        let mut skill_list_state = ListState::default();
        skill_list_state.select(Some(0));
        let mut mcp_list_state = ListState::default();
        mcp_list_state.select(Some(0));
        let mut plugin_list_state = ListState::default();
        plugin_list_state.select(Some(0));

        let mut app = Self {
            initial_project_root: project_root.clone(),
            project_root,
            is_home_scope: is_home,
            targets,
            active_tab: ActiveTab::Skills,
            running: true,
            skills: Vec::new(),
            selected_skill_index: 0,
            skill_list_state,
            mcps: Vec::new(),
            selected_mcp_index: 0,
            mcp_list_state,
            plugins: Vec::new(),
            selected_plugin_index: 0,
            plugin_list_state,
            doctor_report: None,
            search_mode: false,
            search_query: String::new(),
            preview_scroll: 0,
            status_message: None,
            pending_editor_file: None,
            pending_edit_targets: Vec::new(),
            pending_mcp_editor: None,
        };
        app.refresh();
        app
    }

    pub fn refresh(&mut self) {
        let mut errors = Vec::new();
        match get_skill_workspace_status(&self.project_root, &self.targets) {
            Ok(status) => self.skills = status.skills,
            Err(error) => {
                self.skills.clear();
                errors.push(error.to_string());
            }
        }
        match get_mcp_workspace_status(&self.project_root, &self.targets) {
            Ok(status) => self.mcps = status.servers,
            Err(error) => {
                self.mcps.clear();
                errors.push(error.to_string());
            }
        }
        match get_plugin_workspace_status(&self.project_root, &self.targets) {
            Ok(status) => self.plugins = status.plugins,
            Err(error) => {
                self.plugins.clear();
                errors.push(error.to_string());
            }
        }
        if self.active_tab == ActiveTab::Doctor {
            match run_doctor(&self.project_root, false, &self.targets) {
                Ok(report) => self.doctor_report = Some(report),
                Err(error) => {
                    self.doctor_report = None;
                    errors.push(error.to_string());
                }
            }
        }
        if !errors.is_empty() {
            self.status_message = Some(crate::core::operations::redact_text(&format!(
                "Error: {}",
                errors.join("; ")
            )));
        }
        self.clamp_indices();
    }

    fn clamp_indices(&mut self) {
        let skill_count = self.filtered_skills().len();
        if skill_count == 0 {
            self.selected_skill_index = 0;
            self.skill_list_state.select(None);
        } else {
            if self.selected_skill_index >= skill_count {
                self.selected_skill_index = skill_count - 1;
            }
            self.skill_list_state
                .select(Some(self.selected_skill_index));
        }

        let mcp_count = self.filtered_mcps().len();
        if mcp_count == 0 {
            self.selected_mcp_index = 0;
            self.mcp_list_state.select(None);
        } else {
            if self.selected_mcp_index >= mcp_count {
                self.selected_mcp_index = mcp_count - 1;
            }
            self.mcp_list_state.select(Some(self.selected_mcp_index));
        }

        let plugin_count = self.filtered_plugins().len();
        if plugin_count == 0 {
            self.selected_plugin_index = 0;
            self.plugin_list_state.select(None);
        } else {
            if self.selected_plugin_index >= plugin_count {
                self.selected_plugin_index = plugin_count - 1;
            }
            self.plugin_list_state
                .select(Some(self.selected_plugin_index));
        }
    }

    pub fn toggle_scope(&mut self) {
        if self.is_home_scope && crate::paths::is_home_scope(&self.initial_project_root) {
            self.status_message = Some("Already in home scope; restart ACM from a project directory to manage project settings".into());
            return;
        }
        self.is_home_scope = !self.is_home_scope;
        if self.is_home_scope {
            self.project_root = home_dir();
            self.status_message = Some("Switched scope to Global (~/)".to_string());
        } else {
            self.project_root = self.initial_project_root.clone();
            self.status_message = Some(format!(
                "Switched scope to Project ({})",
                self.project_root.display()
            ));
        }
        self.selected_skill_index = 0;
        self.selected_mcp_index = 0;
        self.selected_plugin_index = 0;
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

    pub fn filtered_plugins(&self) -> Vec<&PluginStatus> {
        if self.search_query.is_empty() {
            self.plugins.iter().collect()
        } else {
            let q = self.search_query.to_lowercase();
            self.plugins
                .iter()
                .filter(|p| {
                    p.name.to_lowercase().contains(&q)
                        || p.description.to_lowercase().contains(&q)
                        || p.skills.iter().any(|s| s.to_lowercase().contains(&q))
                })
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
                    self.skill_list_state
                        .select(Some(self.selected_skill_index));
                }
            }
            ActiveTab::Mcp => {
                let count = self.filtered_mcps().len();
                if count > 0 {
                    self.selected_mcp_index = (self.selected_mcp_index + 1) % count;
                    self.mcp_list_state.select(Some(self.selected_mcp_index));
                }
            }
            ActiveTab::Plugins => {
                let count = self.filtered_plugins().len();
                if count > 0 {
                    self.selected_plugin_index = (self.selected_plugin_index + 1) % count;
                    self.plugin_list_state
                        .select(Some(self.selected_plugin_index));
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
                    self.skill_list_state
                        .select(Some(self.selected_skill_index));
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
                    self.mcp_list_state.select(Some(self.selected_mcp_index));
                }
            }
            ActiveTab::Plugins => {
                let count = self.filtered_plugins().len();
                if count > 0 {
                    self.selected_plugin_index = if self.selected_plugin_index == 0 {
                        count - 1
                    } else {
                        self.selected_plugin_index - 1
                    };
                    self.plugin_list_state
                        .select(Some(self.selected_plugin_index));
                }
            }
            ActiveTab::Doctor => {}
        }
    }

    fn no_selection(&mut self) {
        self.status_message = Some("No item selected; no changes made".into());
    }

    fn perform_targets(
        &mut self,
        action: &str,
        targets: &[TargetName],
        mut operation: impl FnMut(TargetName) -> anyhow::Result<String>,
    ) {
        let mut results = Vec::new();
        let mut failed = Vec::new();
        for &target in targets {
            match operation(target) {
                Ok(detail) => results.push(format!("{target}: {detail}")),
                Err(error) => {
                    results.push(format!("{target}: failed ({error:#})"));
                    failed.push(target.to_string());
                }
            }
        }
        self.status_message = Some(if results.is_empty() {
            format!("{action}: no targets selected; no changes made")
        } else if failed.is_empty() {
            format!("{action}: {}", results.join("; "))
        } else {
            format!(
                "Error during {action}: {}. Retry targets: {}",
                results.join("; "),
                failed.join(",")
            )
        });
        self.refresh_after_action();
    }

    fn refresh_after_action(&mut self) {
        // A refresh failure must not hide the action's failure or partial completion.
        let action_message = self.status_message.take();
        self.refresh();
        self.status_message = match (action_message, self.status_message.take()) {
            (Some(action), Some(refresh)) => Some(format!("{action}. Refresh: {refresh}")),
            (action, refresh) => action.or(refresh),
        }
        .map(|message| crate::core::operations::redact_text(&message));
    }

    pub fn toggle_single_target(&mut self, target: TargetName) {
        if !self.targets.contains(&target) {
            self.status_message = Some(format!(
                "Target {target} is outside the configured targets; no changes made"
            ));
            return;
        }
        self.toggle_selected(&[target], true);
    }

    fn toggle_selected(&mut self, targets: &[TargetName], individual: bool) {
        let root = self.project_root.clone();
        match self.active_tab {
            ActiveTab::Skills => {
                let Some(skill) = self
                    .filtered_skills()
                    .get(self.selected_skill_index)
                    .cloned()
                    .cloned()
                else {
                    return self.no_selection();
                };
                self.perform_targets(&format!("Toggle skill {}", skill.name), targets, |target| {
                    let disable = if individual {
                        skill.targets.contains(&target)
                    } else {
                        skill.enabled
                    };
                    if disable {
                        skill_remove(&root, &skill.name, &[target])?;
                        Ok("disabled".into())
                    } else {
                        skill_add(&root, &skill.name, &[target], None)?;
                        Ok("enabled".into())
                    }
                });
            }
            ActiveTab::Mcp => {
                let Some(mcp) = self
                    .filtered_mcps()
                    .get(self.selected_mcp_index)
                    .cloned()
                    .cloned()
                else {
                    return self.no_selection();
                };
                if mcp.plugin.is_some() {
                    self.status_message = Some("This MCP is managed by a plugin; use the Plugins tab to change its installation".into());
                    return;
                }
                self.perform_targets(&format!("Toggle MCP {}", mcp.name), targets, |target| {
                    let state = mcp
                        .state
                        .get(&target)
                        .map(String::as_str)
                        .unwrap_or("missing");
                    let disable = if individual {
                        !matches!(state, "missing" | "disabled")
                    } else {
                        mcp.enabled
                    };
                    if disable && state == "missing" {
                        return Ok("not configured; unchanged".into());
                    }
                    if state == "missing" {
                        crate::core::mcp::mcp_add(&root, &mcp.name, &[target], Some(&mcp.recipe))?;
                    } else {
                        let (key, _) = mcp_native_identity(&root, &mcp, target)?;
                        if disable {
                            mcp_disable(&root, &key, &[target])?;
                        } else {
                            mcp_enable(&root, &key, &[target])?;
                        }
                    }
                    Ok(if disable { "disabled" } else { "enabled" }.into())
                });
            }
            ActiveTab::Plugins => {
                let Some(plugin) = self
                    .filtered_plugins()
                    .get(self.selected_plugin_index)
                    .cloned()
                    .cloned()
                else {
                    return self.no_selection();
                };
                self.perform_targets(&format!("Toggle plugin {}", plugin.id), targets, |target| {
                    let disable = if individual {
                        plugin.targets.contains(&target)
                    } else {
                        plugin.enabled
                    };
                    if disable {
                        plugin_remove(&root, &plugin.id, &[target])?;
                        Ok("uninstalled".into())
                    } else {
                        plugin_install(&root, &plugin.id, &[target])?;
                        Ok("installed".into())
                    }
                });
            }
            ActiveTab::Doctor => {}
        }
    }

    /// Catalog skills are edited at their source; inline skills use a configured provider.
    pub fn skill_editor_path(&self, name: &str) -> Option<PathBuf> {
        let catalog = get_catalog_skill_dir(name).join("SKILL.md");
        std::iter::once(catalog)
            .chain(
                self.targets.iter().map(|target| {
                    get_skill_path(&self.project_root, *target, name).join("SKILL.md")
                }),
            )
            .find(|path| path.is_file())
    }

    fn edit_selected(&mut self) {
        self.pending_editor_file = None;
        self.pending_mcp_editor = None;
        match self.active_tab {
            ActiveTab::Skills => {
                let Some(skill) = self
                    .filtered_skills()
                    .get(self.selected_skill_index)
                    .cloned()
                else {
                    return self.no_selection();
                };
                self.pending_editor_file = self.skill_editor_path(&skill.name);
                if self.pending_editor_file.is_none() {
                    self.status_message = Some(
                        "Error: no editable SKILL.md in the catalog or configured targets".into(),
                    );
                }
            }
            ActiveTab::Mcp => {
                let Some(mcp) = self.filtered_mcps().get(self.selected_mcp_index).cloned() else {
                    return self.no_selection();
                };
                if mcp.plugin.is_some() {
                    self.status_message = Some("This MCP is managed by a plugin; edit the plugin source and update it from the Plugins tab".into());
                    return;
                }
                let targets: Vec<_> = self
                    .targets
                    .iter()
                    .filter(|target| mcp.targets.contains(target))
                    .copied()
                    .collect();
                match targets.as_slice() {
                    [] => {
                        self.status_message =
                            Some("No configured target contains this MCP; no changes made".into())
                    }
                    [target] => self.prepare_mcp_editor(*target),
                    _ => {
                        self.status_message = Some(format!(
                            "Edit MCP target: {}. Press c/x/a/g to choose; Esc cancels",
                            targets
                                .iter()
                                .map(ToString::to_string)
                                .collect::<Vec<_>>()
                                .join(", ")
                        ));
                        self.pending_edit_targets = targets;
                    }
                }
            }
            ActiveTab::Plugins => {
                let Some(plugin) = self
                    .filtered_plugins()
                    .get(self.selected_plugin_index)
                    .cloned()
                else {
                    return self.no_selection();
                };
                let dir = get_catalog_plugin_dir(&plugin.id);
                let mut manifests = Vec::new();
                for target in &self.targets {
                    manifests.push(match target {
                        TargetName::Claude => ".claude-plugin/plugin.json",
                        TargetName::Codex => ".codex-plugin/plugin.json",
                        TargetName::Antigravity => ".gemini-plugin/plugin.json",
                        TargetName::Grok => ".grok-plugin/plugin.json",
                    });
                }
                manifests.extend([
                    "plugin.json",
                    ".claude-plugin/plugin.json",
                    ".codex-plugin/plugin.json",
                    ".gemini-plugin/plugin.json",
                    ".grok-plugin/plugin.json",
                    "package.json",
                ]);
                self.pending_editor_file = manifests
                    .into_iter()
                    .map(|relative| dir.join(relative))
                    .find(|path| path.is_file());
                if self.pending_editor_file.is_none() {
                    self.status_message = Some("Error: no editable plugin manifest found".into());
                }
            }
            ActiveTab::Doctor => {}
        }
    }

    fn prepare_mcp_editor(&mut self, target: TargetName) {
        let result = (|| -> anyhow::Result<McpEditor> {
            let mcp = self
                .filtered_mcps()
                .get(self.selected_mcp_index)
                .cloned()
                .context("No MCP selected")?;
            let (key, original) = mcp_native_identity(&self.project_root, mcp, target)?;
            let mut file = tempfile::Builder::new()
                .prefix("acm-mcp-")
                .suffix(".json")
                .tempfile()?;
            let recipe = original
                .recipe
                .as_ref()
                .context("MCP has no editable recipe")?;
            file.write_all(serde_json::to_string_pretty(recipe)?.as_bytes())?;
            file.flush()?;
            Ok(McpEditor {
                file,
                target,
                key,
                original,
            })
        })();
        match result {
            Ok(editor) => {
                self.pending_editor_file = Some(editor.file.path().to_path_buf());
                self.status_message = Some(format!("Editing MCP recipe for {target}; validated changes will be applied through the provider adapter"));
                self.pending_mcp_editor = Some(editor);
            }
            Err(error) => {
                self.status_message = Some(crate::core::operations::redact_text(&format!(
                    "Error opening MCP editor: {error:#}"
                )))
            }
        }
    }

    /// Complete an editor action only after the editor successfully exits.
    pub fn complete_editor(&mut self, file: &Path, editor_result: anyhow::Result<()>) {
        let pending = self.pending_mcp_editor.take();
        let result = editor_result.and_then(|()| {
            if let Some(pending) = pending {
                pending.apply(&self.project_root)
            } else {
                Ok(format!("Editor closed successfully: {}", file.display()))
            }
        });
        self.status_message = Some(match result {
            Ok(message) => message,
            Err(error) => format!("Error editing: {error:#}"),
        });
        self.refresh_after_action();
    }

    fn update_selected(&mut self) {
        let root = self.project_root.clone();
        let targets = self.targets.clone();
        match self.active_tab {
            ActiveTab::Skills => {
                let Some(skill) = self
                    .filtered_skills()
                    .get(self.selected_skill_index)
                    .cloned()
                    .cloned()
                else {
                    return self.no_selection();
                };
                self.perform_targets(
                    &format!("Update skill {}", skill.name),
                    &targets,
                    |target| {
                        let result = skill_update(&root, Some(&skill.name), &[target], false)?;
                        let reasons = result
                            .details
                            .iter()
                            .map(|detail| detail.reason.as_str())
                            .collect::<Vec<_>>()
                            .join(", ");
                        Ok(format!(
                            "updated {}, skipped {}{}",
                            result.updated_count,
                            result.skipped_count,
                            if reasons.is_empty() {
                                String::new()
                            } else {
                                format!(" ({reasons})")
                            }
                        ))
                    },
                );
            }
            ActiveTab::Plugins => {
                let Some(plugin) = self
                    .filtered_plugins()
                    .get(self.selected_plugin_index)
                    .cloned()
                    .cloned()
                else {
                    return self.no_selection();
                };
                self.status_message = Some(match crate::core::plugin::plugin_update(&root, &plugin.id, &targets) {
                    Ok(result) => format!("Plugin {}: {}", plugin.id, result.message),
                    Err(error) => format!("Error updating plugin {}: {error:#}. Earlier source/provider changes may remain; inspect status before retrying", plugin.id),
                });
                self.refresh_after_action();
            }
            _ => {}
        }
    }

    fn delete_selected(&mut self) {
        let root = self.project_root.clone();
        let targets = self.targets.clone();
        match self.active_tab {
            ActiveTab::Skills => {
                let Some(skill) = self
                    .filtered_skills()
                    .get(self.selected_skill_index)
                    .cloned()
                    .cloned()
                else {
                    return self.no_selection();
                };
                self.perform_targets(
                    &format!("Remove skill {}", skill.name),
                    &targets,
                    |target| {
                        skill_remove(&root, &skill.name, &[target])?;
                        Ok("removed".into())
                    },
                );
            }
            ActiveTab::Plugins => {
                let Some(plugin) = self
                    .filtered_plugins()
                    .get(self.selected_plugin_index)
                    .cloned()
                    .cloned()
                else {
                    return self.no_selection();
                };
                self.perform_targets(
                    &format!("Remove plugin {}", plugin.id),
                    &targets,
                    |target| {
                        plugin_remove(&root, &plugin.id, &[target])?;
                        Ok("uninstalled".into())
                    },
                );
            }
            _ => {}
        }
    }

    fn repair(&mut self) {
        match run_doctor(&self.project_root, true, &self.targets) {
            Ok(report) => {
                let remaining = report
                    .checks
                    .iter()
                    .filter(|check| {
                        matches!(check.status, CheckStatus::Error | CheckStatus::Warning)
                    })
                    .count();
                self.status_message = Some(format!(
                    "Repair completed: fixed {} issues; {} warnings/errors remain",
                    report.fixed_count, remaining
                ));
                self.refresh_after_action();
                self.doctor_report = Some(report);
            }
            Err(error) => {
                self.status_message = Some(format!(
                    "Error repairing diagnostics: {error:#}. Earlier repairs may remain applied"
                ));
                self.refresh_after_action();
            }
        }
    }

    pub fn handle_key(&mut self, key: KeyEvent) {
        if key.kind != KeyEventKind::Press {
            return;
        }

        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            self.running = false;
            return;
        }

        if !self.pending_edit_targets.is_empty() {
            let target = match key.code {
                KeyCode::Char('c') => Some(TargetName::Claude),
                KeyCode::Char('x') => Some(TargetName::Codex),
                KeyCode::Char('a') => Some(TargetName::Antigravity),
                KeyCode::Char('g') => Some(TargetName::Grok),
                KeyCode::Esc => {
                    self.pending_edit_targets.clear();
                    self.status_message = Some("Editing cancelled; no changes made".into());
                    return;
                }
                _ => None,
            };
            if let Some(target) = target {
                if self.pending_edit_targets.contains(&target) {
                    self.pending_edit_targets.clear();
                    self.prepare_mcp_editor(target);
                } else {
                    self.status_message = Some(format!("{target} has no selected MCP in the configured targets; choose another target or Esc"));
                }
            }
            return;
        }

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
                    self.selected_plugin_index = 0;
                    self.preview_scroll = 0;
                    self.clamp_indices();
                }
                KeyCode::Char(c) => {
                    self.search_query.push(c);
                    self.selected_skill_index = 0;
                    self.selected_mcp_index = 0;
                    self.selected_plugin_index = 0;
                    self.preview_scroll = 0;
                    self.clamp_indices();
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
                    ActiveTab::Mcp => ActiveTab::Plugins,
                    ActiveTab::Plugins => ActiveTab::Doctor,
                    ActiveTab::Doctor => ActiveTab::Skills,
                };
                if self.active_tab == ActiveTab::Doctor {
                    self.refresh();
                }
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
                self.active_tab = ActiveTab::Plugins;
                self.preview_scroll = 0;
            }
            KeyCode::Char('4') => {
                self.active_tab = ActiveTab::Doctor;
                self.refresh();
                self.preview_scroll = 0;
            }
            KeyCode::Char('H') | KeyCode::Char('S') => {
                self.toggle_scope();
            }
            KeyCode::Char('/') => {
                self.search_mode = true;
            }
            KeyCode::Char('j') | KeyCode::Down => {
                self.nav_down();
            }
            KeyCode::Char('k') | KeyCode::Up => {
                self.nav_up();
            }
            KeyCode::PageDown | KeyCode::Char('J') => {
                self.preview_scroll = self.preview_scroll.saturating_add(5);
            }
            KeyCode::PageUp | KeyCode::Char('K') => {
                self.preview_scroll = self.preview_scroll.saturating_sub(5);
            }
            KeyCode::Char(' ') => self.toggle_selected(&self.targets.clone(), false),
            KeyCode::Char('c') => self.toggle_single_target(TargetName::Claude),
            KeyCode::Char('x') => self.toggle_single_target(TargetName::Codex),
            KeyCode::Char('a') => self.toggle_single_target(TargetName::Antigravity),
            KeyCode::Char('g') => self.toggle_single_target(TargetName::Grok),
            KeyCode::Char('e') => self.edit_selected(),
            KeyCode::Char('u') => self.update_selected(),
            KeyCode::Char('f') if self.active_tab == ActiveTab::Doctor => self.repair(),
            KeyCode::Char('d') => self.delete_selected(),
            _ => {}
        }
    }
}

struct McpEditor {
    file: tempfile::NamedTempFile,
    target: TargetName,
    key: String,
    original: ServerInfo,
}

impl McpEditor {
    fn apply(self, root: &Path) -> anyhow::Result<String> {
        let value: serde_json::Value = serde_json::from_slice(&std::fs::read(self.file.path())?)
            .context("Edited MCP recipe must be valid JSON; provider settings were not changed")?;
        for field in value
            .as_object()
            .context("MCP recipe must be a JSON object")?
            .keys()
        {
            if !["command", "args", "url", "cwd", "env", "transport"].contains(&field.as_str()) {
                bail!("Unknown MCP recipe field: {field}; provider settings were not changed");
            }
        }
        let recipe: McpRecipe = serde_json::from_value(value)
            .context("Invalid MCP recipe; provider settings were not changed")?;
        crate::adapters::validate_recipe(&recipe)?;
        if self.original.recipe.as_ref() == Some(&recipe) {
            return Ok(format!("MCP {} on {} unchanged", self.key, self.target));
        }
        let path = get_agent_mcp_config_path(root, self.target);
        crate::adapters::replace_mcp_recipe(
            self.target,
            &path,
            &self.key,
            &self.original,
            &recipe,
        )?;
        Ok(format!("Updated MCP {} on {}", self.key, self.target))
    }
}

fn mcp_native_identity(
    root: &Path,
    mcp: &McpStatus,
    target: TargetName,
) -> anyhow::Result<(String, ServerInfo)> {
    let entries = crate::catalog::store::list_mcps()?;
    let servers = get_mcp_servers(target, get_agent_mcp_config_path(root, target))?;
    let mut matches = servers.into_iter().filter(|(name, info)| {
        let canonical = info
            .recipe
            .as_ref()
            .and_then(|recipe| crate::core::mcp::match_entry(&entries, name, recipe))
            .map(|entry| entry.id.as_str())
            .unwrap_or(name.as_str());
        canonical == mcp.name
    });
    let selected = matches
        .next()
        .context("MCP definition no longer exists on this target; refresh and try again")?;
    if matches.next().is_some() {
        bail!("Multiple native MCP definitions match this item; resolve the ambiguity using the CLI first");
    }
    Ok(selected)
}

/// Run an external editor without a shell, preserving quoted program paths and arguments.
pub fn run_external_editor(editor: &str, file: &Path) -> anyhow::Result<()> {
    let args = editor_arguments(editor)?;
    let status = Command::new(&args[0])
        .args(&args[1..])
        .arg(file)
        .status()
        .context("Could not start the configured editor")?;
    if !status.success() {
        bail!("Editor exited unsuccessfully ({status}); no MCP recipe changes were applied");
    }
    Ok(())
}

fn editor_arguments(editor: &str) -> anyhow::Result<Vec<String>> {
    let mut args = Vec::new();
    let mut word = String::new();
    let mut quote = None;
    let mut escaped = false;
    let mut started = false;
    let mut chars = editor.chars().peekable();
    while let Some(ch) = chars.next() {
        if escaped {
            word.push(ch);
            escaped = false;
            started = true;
        } else if ch == '\\'
            && quote != Some('\'')
            && chars
                .peek()
                .is_some_and(|next| matches!(next, '\\' | '\'' | '"') || next.is_whitespace())
        {
            escaped = true;
            started = true;
        } else if Some(ch) == quote {
            quote = None;
        } else if quote.is_none() && matches!(ch, '\'' | '"') {
            quote = Some(ch);
            started = true;
        } else if quote.is_none() && ch.is_whitespace() {
            if started {
                args.push(std::mem::take(&mut word));
                started = false;
            }
        } else {
            word.push(ch);
            started = true;
        }
    }
    if escaped || quote.is_some() {
        bail!("Invalid editor command: unterminated quote or escape");
    }
    if started {
        args.push(word);
    }
    if args.first().is_none_or(|program| program.is_empty()) {
        bail!("Configured editor command is empty");
    }
    Ok(args)
}

pub fn run_tui(project_root: &Path, targets: &[TargetName]) -> anyhow::Result<()> {
    run_tui_tab(project_root, targets, ActiveTab::Skills)
}

pub fn run_tui_tab(
    project_root: &Path,
    targets: &[TargetName],
    tab: ActiveTab,
) -> anyhow::Result<()> {
    let default_panic = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let _ = disable_raw_mode();
        let _ = execute!(io::stdout(), LeaveAlternateScreen);
        default_panic(info);
    }));

    enable_raw_mode()?;
    struct TerminalCleanup;
    impl Drop for TerminalCleanup {
        fn drop(&mut self) {
            let _ = disable_raw_mode();
            let _ = execute!(io::stdout(), LeaveAlternateScreen);
        }
    }
    let _cleanup = TerminalCleanup;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut app = App::new(project_root.to_path_buf(), targets.to_vec());
    app.active_tab = tab;
    app.refresh();

    while app.running {
        terminal.draw(|f| crate::tui::ui::render(f, &mut app))?;

        if let Some(file_to_edit) = app.pending_editor_file.take() {
            disable_raw_mode()?;
            execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
            terminal.show_cursor()?;

            let editor_env = std::env::var("VISUAL")
                .or_else(|_| std::env::var("EDITOR"))
                .unwrap_or_else(|_| "nano".to_string());

            let editor_result = run_external_editor(&editor_env, &file_to_edit);

            enable_raw_mode()?;
            execute!(terminal.backend_mut(), EnterAlternateScreen)?;
            terminal.hide_cursor()?;
            terminal.clear()?;

            app.complete_editor(&file_to_edit, editor_result);
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
