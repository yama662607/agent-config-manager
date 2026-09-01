use crate::core::doctor::CheckStatus;
use crate::paths::{get_catalog_skill_dir, get_skill_path};
use crate::tui::app::{ActiveTab, App};
use crate::types::{SkillPlacementState, TargetName};
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
        Span::raw("[3] Doctor & Health"),
    ];

    let selected_index = match app.active_tab {
        ActiveTab::Skills => 0,
        ActiveTab::Mcp => 1,
        ActiveTab::Doctor => 2,
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
    let search_text = Paragraph::new(app.search_query.as_str())
        .style(search_style)
        .block(Block::default().borders(Borders::ALL).title(search_title));
    f.render_widget(search_text, left_layout[0]);

    // Skills List
    let filtered_skills = app.filtered_skills();
    let items: Vec<ListItem> = filtered_skills
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let is_selected = i == app.selected_skill_index;
            let status_icon = if s.enabled { "●" } else { "○" };
            let style = if is_selected {
                Style::default()
                    .fg(Color::Black)
                    .bg(Color::Cyan)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(Color::White)
            };

            // Badges for each target: cl, cx, ag, gk
            let mut badges = Vec::new();
            badges.push(Span::styled(format!(" {} ", status_icon), Style::default().fg(if s.enabled { Color::Green } else { Color::DarkGray })));
            badges.push(Span::raw(format!("{:<20} ", s.name)));

            for &t in &[TargetName::Claude, TargetName::Codex, TargetName::Antigravity, TargetName::Grok] {
                let code = t.short_code();
                let placement = s.placement.get(&t).copied().unwrap_or(SkillPlacementState::Missing);
                let (symbol, color) = match placement {
                    SkillPlacementState::Linked => ("L", Color::Green),
                    SkillPlacementState::Registered => ("R", Color::Green),
                    SkillPlacementState::CopyCurrent => ("C", Color::Cyan),
                    SkillPlacementState::CopyStale => ("!", Color::Yellow),
                    SkillPlacementState::BrokenLink => ("X", Color::Red),
                    SkillPlacementState::Missing | SkillPlacementState::Unlinked => ("-", Color::DarkGray),
                };
                badges.push(Span::styled(format!("{}:{} ", code, symbol), Style::default().fg(color)));
            }

            ListItem::new(Line::from(badges)).style(style)
        })
        .collect();

    let list_title = format!(" Skills ({} total) ", filtered_skills.len());
    let list_widget = List::new(items).block(Block::default().borders(Borders::ALL).title(list_title));
    f.render_widget(list_widget, left_layout[1]);

    // Right pane: Preview & Details
    let right_pane = panes[1];
    if let Some(selected_skill) = filtered_skills.get(app.selected_skill_index) {
        let skill_md_path = get_catalog_skill_dir(&selected_skill.name).join("SKILL.md");
        let content = if skill_md_path.exists() {
            fs::read_to_string(&skill_md_path).unwrap_or_else(|_| "(Unable to read SKILL.md)".to_string())
        } else {
            let target_md = get_skill_path(&app.project_root, TargetName::Claude, &selected_skill.name).join("SKILL.md");
            if target_md.exists() {
                fs::read_to_string(&target_md).unwrap_or_else(|_| "(Unable to read SKILL.md)".to_string())
            } else {
                "(No SKILL.md found)".to_string()
            }
        };

        let mut lines = Vec::new();
        lines.push(Line::from(vec![
            Span::styled("Skill: ", Style::default().add_modifier(Modifier::BOLD)),
            Span::styled(&selected_skill.name, Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
            Span::raw("  "),
            Span::styled("[Press 'e' to open in editor]", Style::default().fg(Color::Yellow)),
        ]));

        lines.push(Line::from("─".repeat(60)));
        lines.push(Line::from(Span::styled("Target Placements:", Style::default().fg(Color::Magenta).add_modifier(Modifier::BOLD))));

        for &t in &[TargetName::Claude, TargetName::Codex, TargetName::Antigravity, TargetName::Grok] {
            let placement = selected_skill.placement.get(&t).copied().unwrap_or(SkillPlacementState::Missing);
            let state_str = match placement {
                SkillPlacementState::Linked => "Linked (Symlink to Catalog)",
                SkillPlacementState::Registered => "Registered in Config",
                SkillPlacementState::CopyCurrent => "Copy (Current)",
                SkillPlacementState::CopyStale => "Copy (Stale - Press 'u' to update)",
                SkillPlacementState::BrokenLink => "Broken Link (Press 'f' in Doctor)",
                SkillPlacementState::Missing => "Not Installed",
                SkillPlacementState::Unlinked => "Unlinked",
            };
            let color = match placement {
                SkillPlacementState::Linked | SkillPlacementState::Registered | SkillPlacementState::CopyCurrent => Color::Green,
                SkillPlacementState::CopyStale => Color::Yellow,
                SkillPlacementState::BrokenLink => Color::Red,
                SkillPlacementState::Missing | SkillPlacementState::Unlinked => Color::DarkGray,
            };

            let path = get_skill_path(&app.project_root, t, &selected_skill.name);
            lines.push(Line::from(vec![
                Span::styled(format!("  {:<12} ", format!("{}:", t)), Style::default().add_modifier(Modifier::BOLD)),
                Span::styled(format!("{:<30} ", state_str), Style::default().fg(color)),
                Span::styled(format!("({})", path.display()), Style::default().fg(Color::DarkGray)),
            ]));
        }

        lines.push(Line::from("─".repeat(60)));
        lines.push(Line::from(vec![
            Span::styled("SKILL.md Preview ", Style::default().fg(Color::Magenta).add_modifier(Modifier::BOLD)),
            Span::styled("(Scroll: J/K or PgDn/PgUp)", Style::default().fg(Color::DarkGray)),
        ]));
        lines.push(Line::from(""));

        let content_lines: Vec<&str> = content.lines().collect();
        let scroll_offset = (app.preview_scroll as usize).min(content_lines.len().saturating_sub(1));

        for line in content_lines.iter().skip(scroll_offset).take(35) {
            lines.push(Line::from(*line));
        }

        let preview = Paragraph::new(lines)
            .block(Block::default().borders(Borders::ALL).title(" Skill Details & Inspection "))
            .wrap(Wrap { trim: false });
        f.render_widget(preview, right_pane);
    } else {
        let empty = Paragraph::new("No skill selected.")
            .block(Block::default().borders(Borders::ALL).title(" Skill Details "));
        f.render_widget(empty, right_pane);
    }
}

fn render_mcp_tab(f: &mut Frame, app: &App, area: Rect) {
    let panes = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(42), Constraint::Percentage(58)])
        .split(area);

    let filtered_mcps = app.filtered_mcps();
    let items: Vec<ListItem> = filtered_mcps
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let is_selected = i == app.selected_mcp_index;
            let status_icon = if m.enabled { "✓" } else { "✗" };
            let style = if is_selected {
                Style::default()
                    .fg(Color::Black)
                    .bg(Color::Cyan)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(Color::White)
            };

            let mut spans = vec![
                Span::styled(format!(" {} ", status_icon), Style::default().fg(if m.enabled { Color::Green } else { Color::DarkGray })),
                Span::raw(format!("{:<20} ", m.name)),
            ];

            for &t in &[TargetName::Claude, TargetName::Codex, TargetName::Antigravity, TargetName::Grok] {
                let code = t.short_code();
                let is_in_target = m.targets.contains(&t);
                let (sym, color) = if is_in_target { ("✓", Color::Green) } else { ("-", Color::DarkGray) };
                spans.push(Span::styled(format!("{}:{} ", code, sym), Style::default().fg(color)));
            }

            ListItem::new(Line::from(spans)).style(style)
        })
        .collect();

    let list_widget = List::new(items).block(
        Block::default()
            .borders(Borders::ALL)
            .title(format!(" MCP Servers ({} total) ", filtered_mcps.len())),
    );
    f.render_widget(list_widget, panes[0]);

    // Right pane: MCP details
    if let Some(selected_mcp) = filtered_mcps.get(app.selected_mcp_index) {
        let mut lines = Vec::new();
        lines.push(Line::from(vec![
            Span::styled("MCP Server: ", Style::default().add_modifier(Modifier::BOLD)),
            Span::styled(&selected_mcp.name, Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
            Span::raw("  "),
            Span::styled("[Press 'e' to edit config]", Style::default().fg(Color::Yellow)),
        ]));
        lines.push(Line::from(vec![
            Span::styled("Status: ", Style::default().add_modifier(Modifier::BOLD)),
            Span::styled(
                if selected_mcp.enabled { "Enabled" } else { "Disabled" },
                Style::default().fg(if selected_mcp.enabled { Color::Green } else { Color::Red }),
            ),
        ]));
        lines.push(Line::from(vec![
            Span::styled("Active Targets: ", Style::default().add_modifier(Modifier::BOLD)),
            Span::styled(
                selected_mcp.targets.iter().map(|t| t.as_str()).collect::<Vec<_>>().join(", "),
                Style::default().fg(Color::Yellow),
            ),
        ]));
        lines.push(Line::from("─".repeat(60)));
        lines.push(Line::from(Span::styled("Recipe Configuration:", Style::default().fg(Color::Magenta).add_modifier(Modifier::BOLD))));

        if let Some(cmd) = &selected_mcp.recipe.command {
            lines.push(Line::from(format!("  Command: {}", cmd)));
        }
        if let Some(args) = &selected_mcp.recipe.args {
            lines.push(Line::from(format!("  Args: {:?}", args)));
        }
        if let Some(url) = &selected_mcp.recipe.url {
            lines.push(Line::from(format!("  URL: {}", url)));
        }
        if let Some(cwd) = &selected_mcp.recipe.cwd {
            lines.push(Line::from(format!("  Cwd: {}", cwd)));
        }
        if let Some(env) = &selected_mcp.recipe.env {
            lines.push(Line::from(format!("  Env: {:?}", env)));
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
