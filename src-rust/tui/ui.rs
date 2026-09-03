use crate::core::doctor::CheckStatus;
use crate::paths::{get_agent_mcp_config_path, get_catalog_skill_dir, get_skill_path};
use crate::tui::app::{ActiveTab, App};
use crate::types::{PluginPlacementState, SkillPlacementState, TargetName};
use ratatui::layout::{Alignment, Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, List, ListItem, Paragraph, Tabs, Wrap};
use ratatui::Frame;
use std::fs;

pub fn render(f: &mut Frame, app: &mut App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3), // Header & Tabs
            Constraint::Min(10),   // Body (2-pane)
            Constraint::Length(3), // Footer & Help
        ])
        .split(f.area());

    render_header(f, app, chunks[0]);
    render_body(f, app, chunks[1]);
    render_footer(f, app, chunks[2]);
}

fn render_header(f: &mut Frame, app: &App, area: Rect) {
    let header_layout = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Min(40), Constraint::Length(35)])
        .split(area);

    let titles = vec![
        Span::raw("[1] Skills"),
        Span::raw("[2] MCP Servers"),
        Span::raw("[3] Plugins"),
        Span::raw("[4] Doctor & Health"),
    ];

    let selected_index = match app.active_tab {
        ActiveTab::Skills => 0,
        ActiveTab::Mcp => 1,
        ActiveTab::Plugins => 2,
        ActiveTab::Doctor => 3,
    };

    let tabs = Tabs::new(titles)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .title(" acm - Agent Config Manager ")
                .title_alignment(Alignment::Left),
        )
        .select(selected_index)
        .style(Style::default().fg(Color::DarkGray))
        .highlight_style(
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        );

    f.render_widget(tabs, header_layout[0]);

    // Scope Badge
    let (scope_text, scope_color) = if app.is_home_scope {
        (" 🌐 Scope: Global (~) [H] ", Color::Magenta)
    } else {
        (" 📁 Scope: Project (./) [H] ", Color::Green)
    };

    let scope_widget = Paragraph::new(scope_text)
        .style(Style::default().fg(scope_color).add_modifier(Modifier::BOLD))
        .alignment(Alignment::Center)
        .block(Block::default().borders(Borders::ALL).title(" Context "));

    f.render_widget(scope_widget, header_layout[1]);
}

fn render_body(f: &mut Frame, app: &App, area: Rect) {
    match app.active_tab {
        ActiveTab::Skills => render_skills_tab(f, app, area),
        ActiveTab::Mcp => render_mcp_tab(f, app, area),
        ActiveTab::Plugins => render_plugins_tab(f, app, area),
        ActiveTab::Doctor => render_doctor_tab(f, app, area),
    }
}

fn render_skills_tab(f: &mut Frame, app: &App, area: Rect) {
    let panes = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(42), Constraint::Percentage(58)])
        .split(area);

    // Left pane: List + Search
    let left_layout = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3), // Search bar
            Constraint::Min(5),    // List
        ])
        .split(panes[0]);

    // Search bar
    let search_style = if app.search_mode {
        Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(Color::White)
    };
    let search_title = if app.search_mode {
        " 🔍 Search (Enter/Esc to exit) "
    } else {
        " 🔍 Filter (Press / to search) "
    };
    let search_widget = Paragraph::new(format!("> {}", app.search_query))
        .style(search_style)
        .block(Block::default().borders(Borders::ALL).title(search_title));
    f.render_widget(search_widget, left_layout[0]);

    // Skills List
    let filtered_skills = app.filtered_skills();
    let items: Vec<ListItem> = filtered_skills
        .iter()
        .enumerate()
        .map(|(idx, skill)| {
            let is_selected = idx == app.selected_skill_index;
            let icon = if skill.enabled { "●" } else { "○" };
            let icon_color = if skill.enabled { Color::Green } else { Color::DarkGray };

            let mut spans = vec![
                Span::styled(format!("{} ", icon), Style::default().fg(icon_color)),
                Span::styled(format!("{:<20} ", skill.name), if is_selected {
                    Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)
                } else {
                    Style::default().fg(Color::White)
                }),
            ];

            for target in &app.targets {
                let badge = match skill.placement.get(target) {
                    Some(SkillPlacementState::Linked) => (format!("{}:L", target.short_code()), Color::Green),
                    Some(SkillPlacementState::CopyCurrent) => (format!("{}:C", target.short_code()), Color::Cyan),
                    Some(SkillPlacementState::CopyStale) => (format!("{}:!", target.short_code()), Color::LightRed),
                    Some(SkillPlacementState::BrokenLink) => (format!("{}:X", target.short_code()), Color::Red),
                    _ => (format!("{}:-", target.short_code()), Color::DarkGray),
                };
                spans.push(Span::styled(format!(" {} ", badge.0), Style::default().fg(badge.1)));
            }

            let style = if is_selected {
                Style::default().bg(Color::Rgb(30, 30, 45))
            } else {
                Style::default()
            };

            ListItem::new(Line::from(spans)).style(style)
        })
        .collect();

    let list_widget = List::new(items).block(
        Block::default()
            .borders(Borders::ALL)
            .title(format!(" Skills ({}/{}) ", filtered_skills.len(), app.skills.len())),
    );
    f.render_widget(list_widget, left_layout[1]);

    // Right pane: Detail & Preview
    if let Some(selected_skill) = filtered_skills.get(app.selected_skill_index) {
        let mut lines = Vec::new();
        lines.push(Line::from(vec![
            Span::styled("Skill: ", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
            Span::styled(&selected_skill.name, Style::default().fg(Color::White).add_modifier(Modifier::BOLD)),
            Span::raw("  [Press 'e' to open in editor]"),
        ]));
        lines.push(Line::from(""));

        lines.push(Line::from(Span::styled("Target Placements:", Style::default().fg(Color::Yellow))));
        for target in &app.targets {
            let state = selected_skill.placement.get(target).copied().unwrap_or(SkillPlacementState::Missing);
            let state_str = match state {
                SkillPlacementState::Linked => "Linked (Symlink to Catalog)",
                SkillPlacementState::CopyCurrent => "Copy (Current)",
                SkillPlacementState::CopyStale => "Copy (Stale - Press 'u' to update)",
                SkillPlacementState::BrokenLink => "Broken Link (Press 'f' to auto-fix)",
                SkillPlacementState::Missing => "Not Installed",
                SkillPlacementState::Unlinked => "Unlinked",
                SkillPlacementState::Registered => "Registered in Config",
            };
            let target_path = get_skill_path(&app.project_root, *target, &selected_skill.name);
            lines.push(Line::from(format!("  {:<12} {:<30} ({})", format!("{}:", target), state_str, target_path.display())));
        }
        lines.push(Line::from("──────────────────────────────────────────────────────────────────────────"));

        let skill_md_path = get_catalog_skill_dir(&selected_skill.name).join("SKILL.md");
        let content = if skill_md_path.exists() {
            fs::read_to_string(&skill_md_path).unwrap_or_else(|_| "Error reading SKILL.md".to_string())
        } else {
            let target_md = get_skill_path(&app.project_root, TargetName::Claude, &selected_skill.name).join("SKILL.md");
            fs::read_to_string(target_md).unwrap_or_else(|_| "No SKILL.md found".to_string())
        };

        lines.push(Line::from(Span::styled(
            format!("SKILL.md Preview (Scroll: J/K or PgDn/PgUp) [Scroll: {}]", app.preview_scroll),
            Style::default().fg(Color::Cyan),
        )));
        lines.push(Line::from(""));

        for l in content.lines().skip(app.preview_scroll as usize) {
            lines.push(Line::from(l));
        }

        let detail_widget = Paragraph::new(lines)
            .block(Block::default().borders(Borders::ALL).title(" Skill Details & Preview "))
            .wrap(Wrap { trim: false });
        f.render_widget(detail_widget, panes[1]);
    }
}

fn render_plugins_tab(f: &mut Frame, app: &App, area: Rect) {
    let panes = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(42), Constraint::Percentage(58)])
        .split(area);

    let left_layout = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3), // Search bar
            Constraint::Min(5),    // List
        ])
        .split(panes[0]);

    // Search bar
    let search_style = if app.search_mode {
        Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(Color::White)
    };
    let search_title = if app.search_mode {
        " 🔍 Search Plugins (Enter/Esc to exit) "
    } else {
        " 🔍 Filter Plugins (Press / to search) "
    };
    let search_widget = Paragraph::new(format!("> {}", app.search_query))
        .style(search_style)
        .block(Block::default().borders(Borders::ALL).title(search_title));
    f.render_widget(search_widget, left_layout[0]);

    // Plugins list
    let filtered_plugins = app.filtered_plugins();
    let items: Vec<ListItem> = filtered_plugins
        .iter()
        .enumerate()
        .map(|(idx, plugin)| {
            let is_selected = idx == app.selected_plugin_index;
            let icon = if plugin.enabled { "●" } else { "○" };
            let icon_color = if plugin.enabled { Color::Green } else { Color::DarkGray };

            let mut spans = vec![
                Span::styled(format!("{} ", icon), Style::default().fg(icon_color)),
                Span::styled(format!("{:<20} ", plugin.name), if is_selected {
                    Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)
                } else {
                    Style::default().fg(Color::White)
                }),
                Span::styled(format!("v{:<6} ", plugin.version), Style::default().fg(Color::DarkGray)),
            ];

            for target in &app.targets {
                let badge = match plugin.placement.get(target) {
                    Some(PluginPlacementState::NativeLinked) => (format!("{}:L", target.short_code()), Color::Green),
                    Some(PluginPlacementState::ConvertedLinked) => (format!("{}:C", target.short_code()), Color::Cyan),
                    Some(PluginPlacementState::Injected) => (format!("{}:I", target.short_code()), Color::LightBlue),
                    Some(PluginPlacementState::Broken) => (format!("{}:X", target.short_code()), Color::Red),
                    _ => (format!("{}:-", target.short_code()), Color::DarkGray),
                };
                spans.push(Span::styled(format!(" {} ", badge.0), Style::default().fg(badge.1)));
            }

            let style = if is_selected {
                Style::default().bg(Color::Rgb(30, 30, 45))
            } else {
                Style::default()
            };

            ListItem::new(Line::from(spans)).style(style)
        })
        .collect();

    let list_widget = List::new(items).block(
        Block::default()
            .borders(Borders::ALL)
            .title(format!(" Plugins ({}/{}) ", filtered_plugins.len(), app.plugins.len())),
    );
    f.render_widget(list_widget, left_layout[1]);

    // Right pane: Plugin Detail & Components
    if let Some(selected_plugin) = filtered_plugins.get(app.selected_plugin_index) {
        let mut lines = Vec::new();
        lines.push(Line::from(vec![
            Span::styled("Plugin: ", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
            Span::styled(&selected_plugin.name, Style::default().fg(Color::White).add_modifier(Modifier::BOLD)),
            Span::raw(format!("  (v{})", selected_plugin.version)),
            Span::raw("  [Press 'e' to view/edit manifest]"),
        ]));
        if !selected_plugin.description.is_empty() {
            lines.push(Line::from(format!("Description: {}", selected_plugin.description)));
        }
        lines.push(Line::from(format!("Source:      {}", selected_plugin.source_path)));
        lines.push(Line::from(""));

        lines.push(Line::from(Span::styled("Target Placements (Cross-Provider Projection):", Style::default().fg(Color::Yellow))));
        for target in &app.targets {
            let state = selected_plugin.placement.get(target).copied().unwrap_or(PluginPlacementState::Missing);
            let state_str = match state {
                PluginPlacementState::NativeLinked => "Native Plugin Linked",
                PluginPlacementState::ConvertedLinked => "Converted to Antigravity & Linked",
                PluginPlacementState::Injected => "Injected (Skills & MCP auto-mapped)",
                PluginPlacementState::Broken => "Broken Link (Press 'f' to repair)",
                PluginPlacementState::Missing => "Not Installed",
            };
            lines.push(Line::from(format!("  {:<12} {}", format!("{}:", target), state_str)));
        }
        lines.push(Line::from("──────────────────────────────────────────────────────────────────────────"));

        lines.push(Line::from(Span::styled(
            format!("Contained Skills ({})", selected_plugin.skills.len()),
            Style::default().fg(Color::Cyan),
        )));
        if selected_plugin.skills.is_empty() {
            lines.push(Line::from("  (No skills in this plugin)"));
        } else {
            for s in &selected_plugin.skills {
                lines.push(Line::from(format!("  - {}", s)));
            }
        }
        lines.push(Line::from(""));

        lines.push(Line::from(Span::styled(
            format!("Contained MCP Servers ({})", selected_plugin.mcp_servers.len()),
            Style::default().fg(Color::Cyan),
        )));
        if selected_plugin.mcp_servers.is_empty() {
            lines.push(Line::from("  (No MCP servers in this plugin)"));
        } else {
            for m in &selected_plugin.mcp_servers {
                lines.push(Line::from(format!("  - {}", m)));
            }
        }

        let detail_widget = Paragraph::new(lines)
            .block(Block::default().borders(Borders::ALL).title(" Plugin Details & Components "))
            .wrap(Wrap { trim: false });
        f.render_widget(detail_widget, panes[1]);
    }
}

fn render_mcp_tab(f: &mut Frame, app: &App, area: Rect) {
    let panes = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(42), Constraint::Percentage(58)])
        .split(area);

    let left_layout = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3), // Search bar
            Constraint::Min(5),    // List
        ])
        .split(panes[0]);

    let search_style = if app.search_mode {
        Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(Color::White)
    };
    let search_title = if app.search_mode {
        " 🔍 Search (Enter/Esc to exit) "
    } else {
        " 🔍 Filter (Press / to search) "
    };
    let search_widget = Paragraph::new(format!("> {}", app.search_query))
        .style(search_style)
        .block(Block::default().borders(Borders::ALL).title(search_title));
    f.render_widget(search_widget, left_layout[0]);

    let filtered_mcps = app.filtered_mcps();
    let items: Vec<ListItem> = filtered_mcps
        .iter()
        .enumerate()
        .map(|(idx, mcp)| {
            let is_selected = idx == app.selected_mcp_index;
            let icon = if mcp.enabled { "✓" } else { "✗" };
            let icon_color = if mcp.enabled { Color::Green } else { Color::DarkGray };

            let mut spans = vec![
                Span::styled(format!("{} ", icon), Style::default().fg(icon_color)),
                Span::styled(format!("{:<20} ", mcp.name), if is_selected {
                    Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)
                } else {
                    Style::default().fg(Color::White)
                }),
            ];

            for target in &app.targets {
                let badge = if mcp.targets.contains(target) {
                    (format!("{}:✓", target.short_code()), Color::Green)
                } else {
                    (format!("{}:-", target.short_code()), Color::DarkGray)
                };
                spans.push(Span::styled(format!(" {} ", badge.0), Style::default().fg(badge.1)));
            }

            let style = if is_selected {
                Style::default().bg(Color::Rgb(30, 30, 45))
            } else {
                Style::default()
            };

            ListItem::new(Line::from(spans)).style(style)
        })
        .collect();

    let list_widget = List::new(items).block(
        Block::default()
            .borders(Borders::ALL)
            .title(format!(" MCP Servers ({}/{}) ", filtered_mcps.len(), app.mcps.len())),
    );
    f.render_widget(list_widget, left_layout[1]);

    if let Some(selected_mcp) = filtered_mcps.get(app.selected_mcp_index) {
        let mut lines = Vec::new();
        lines.push(Line::from(vec![
            Span::styled("MCP Server: ", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
            Span::styled(&selected_mcp.name, Style::default().fg(Color::White).add_modifier(Modifier::BOLD)),
        ]));
        lines.push(Line::from(""));

        lines.push(Line::from(Span::styled("Targets Configured:", Style::default().fg(Color::Yellow))));
        for target in &app.targets {
            let configured = selected_mcp.targets.contains(target);
            let state_str = if configured { "Configured & Active" } else { "Not Configured" };
            let config_path = get_agent_mcp_config_path(&app.project_root, *target);
            lines.push(Line::from(format!("  {:<12} {:<25} ({})", format!("{}:", target), state_str, config_path.display())));
        }
        lines.push(Line::from("──────────────────────────────────────────────────────────────────────────"));

        lines.push(Line::from(Span::styled("Recipe Configuration:", Style::default().fg(Color::Cyan))));
        if let Some(cmd) = &selected_mcp.recipe.command {
            lines.push(Line::from(format!("  Command: {}", cmd)));
        }
        if let Some(args) = &selected_mcp.recipe.args {
            lines.push(Line::from(format!("  Args:    {}", args.join(" "))));
        }
        if let Some(url) = &selected_mcp.recipe.url {
            lines.push(Line::from(format!("  URL:     {}", url)));
        }
        if let Some(cwd) = &selected_mcp.recipe.cwd {
            lines.push(Line::from(format!("  CWD:     {}", cwd)));
        }
        if let Some(env) = &selected_mcp.recipe.env {
            lines.push(Line::from(format!("  Env:     {:?}", env)));
        }

        let detail_widget = Paragraph::new(lines)
            .block(Block::default().borders(Borders::ALL).title(" Server Recipe & Target Status "))
            .wrap(Wrap { trim: false });
        f.render_widget(detail_widget, panes[1]);
    }
}

fn render_doctor_tab(f: &mut Frame, app: &App, area: Rect) {
    if let Some(report) = &app.doctor_report {
        let items: Vec<ListItem> = report
            .checks
            .iter()
            .map(|check| {
                let (icon, color) = match check.status {
                    CheckStatus::Pass => ("✓", Color::Green),
                    CheckStatus::Warning => ("⚠", Color::Yellow),
                    CheckStatus::Error => ("✗", Color::Red),
                    CheckStatus::Info => ("ℹ", Color::Blue),
                };

                let mut spans = vec![
                    Span::styled(format!(" {} ", icon), Style::default().fg(color).add_modifier(Modifier::BOLD)),
                    Span::styled(format!("[{}] ", check.category), Style::default().fg(Color::Cyan)),
                    Span::raw(&check.title),
                ];

                if let Some(fix) = &check.fix_applied {
                    spans.push(Span::styled(format!(" (🔧 {})", fix), Style::default().fg(Color::Green)));
                }

                ListItem::new(Line::from(spans))
            })
            .collect();

        let list_widget = List::new(items).block(
            Block::default()
                .borders(Borders::ALL)
                .title(" System Health Diagnostics (Press 'f' to auto-fix issues) "),
        );
        f.render_widget(list_widget, area);
    } else {
        let empty = Paragraph::new("No diagnostic report available.")
            .block(Block::default().borders(Borders::ALL).title(" Diagnostics "));
        f.render_widget(empty, area);
    }
}

fn render_footer(f: &mut Frame, app: &App, area: Rect) {
    let default_msg = "[Space] Toggle All  [c/x/a/g] Target Toggle  [H] Switch Scope  [e] Edit  [u] Update  [d] Delete  [/] Search  [q] Quit";
    let msg = app.status_message.as_deref().unwrap_or(default_msg);
    let footer_text = Paragraph::new(msg)
        .style(Style::default().fg(Color::White).bg(Color::DarkGray))
        .alignment(Alignment::Center)
        .block(Block::default().borders(Borders::ALL));
    f.render_widget(footer_text, area);
}
