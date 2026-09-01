use crate::core::doctor::CheckStatus;
use crate::paths::get_catalog_skill_dir;
use crate::tui::app::{ActiveTab, App};
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
    let titles = vec![
        Span::raw("[1] Skills (Catalog & Installed)"),
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

    f.render_widget(tabs, area);
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
        .constraints([Constraint::Percentage(40), Constraint::Percentage(60)])
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
        " 🔍 Search (Press Enter/Esc to finish) "
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

            let targets_str = s.targets.iter().map(|t| t.short_code()).collect::<Vec<_>>().join(" ");
            let content = Line::from(vec![
                Span::styled(format!(" {} ", status_icon), Style::default().fg(Color::Green)),
                Span::raw(format!("{:<25} ", s.name)),
                Span::styled(format!("[{}] ", s.source), Style::default().fg(Color::DarkGray)),
                Span::styled(targets_str, Style::default().fg(Color::Yellow)),
            ]);

            ListItem::new(content).style(style)
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
            "(No SKILL.md found in catalog)".to_string()
        };

        let mut lines = Vec::new();
        lines.push(Line::from(vec![
            Span::styled("Skill: ", Style::default().add_modifier(Modifier::BOLD)),
            Span::styled(&selected_skill.name, Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
        ]));
        lines.push(Line::from(vec![
            Span::styled("Source: ", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(&selected_skill.source),
        ]));
        lines.push(Line::from(vec![
            Span::styled("Configured Targets: ", Style::default().add_modifier(Modifier::BOLD)),
            Span::styled(
                selected_skill.targets.iter().map(|t| t.as_str()).collect::<Vec<_>>().join(", "),
                Style::default().fg(Color::Yellow),
            ),
        ]));
        lines.push(Line::from("─".repeat(50)));
        lines.push(Line::from(Span::styled("SKILL.md Content Preview:", Style::default().fg(Color::Magenta))));
        lines.push(Line::from(""));

        for line in content.lines().take(40) {
            lines.push(Line::from(line));
        }

        let preview = Paragraph::new(lines)
            .block(Block::default().borders(Borders::ALL).title(" Skill Details & Preview "))
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
        .constraints([Constraint::Percentage(40), Constraint::Percentage(60)])
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

            let targets_str = m.targets.iter().map(|t| t.short_code()).collect::<Vec<_>>().join(" ");
            let content = Line::from(vec![
                Span::styled(format!(" {} ", status_icon), Style::default().fg(Color::Green)),
                Span::raw(format!("{:<25} ", m.name)),
                Span::styled(targets_str, Style::default().fg(Color::Yellow)),
            ]);

            ListItem::new(content).style(style)
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
        ]));
        lines.push(Line::from(vec![
            Span::styled("Status: ", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(if selected_mcp.enabled { "Enabled" } else { "Disabled" }),
        ]));
        lines.push(Line::from(vec![
            Span::styled("Targets: ", Style::default().add_modifier(Modifier::BOLD)),
            Span::styled(
                selected_mcp.targets.iter().map(|t| t.as_str()).collect::<Vec<_>>().join(", "),
                Style::default().fg(Color::Yellow),
            ),
        ]));
        lines.push(Line::from("─".repeat(50)));
        lines.push(Line::from(Span::styled("Recipe Configuration:", Style::default().fg(Color::Magenta))));

        if let Some(cmd) = &selected_mcp.recipe.command {
            lines.push(Line::from(format!("  Command: {}", cmd)));
        }
        if let Some(args) = &selected_mcp.recipe.args {
            lines.push(Line::from(format!("  Args: {:?}", args)));
        }
        if let Some(url) = &selected_mcp.recipe.url {
            lines.push(Line::from(format!("  URL: {}", url)));
        }
        if let Some(env) = &selected_mcp.recipe.env {
            lines.push(Line::from(format!("  Env: {:?}", env)));
        }

        let detail_widget = Paragraph::new(lines)
            .block(Block::default().borders(Borders::ALL).title(" Server Recipe Details "))
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
    let msg = app.status_message.as_deref().unwrap_or("[Space] Toggle  [d] Delete  [/] Search  [Tab] Switch Tab  [q] Quit");
    let footer_text = Paragraph::new(msg)
        .style(Style::default().fg(Color::White).bg(Color::DarkGray))
        .alignment(Alignment::Center)
        .block(Block::default().borders(Borders::ALL));
    f.render_widget(footer_text, area);
}
