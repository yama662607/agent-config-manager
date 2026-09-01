use crate::core::doctor::run_doctor;
use crate::core::mcp::{get_mcp_workspace_status, mcp_add, mcp_disable, mcp_enable, mcp_remove};
use crate::core::placement::SkillPlacementMode;
use crate::core::skill::{
    get_skill_workspace_status, skill_add, skill_link, skill_remove, skill_rename, skill_unlink, skill_update,
};
use crate::core::validate::validate_skill_directory;
use crate::paths::home_dir;
use crate::types::{IssueSeverity, McpRecipe, TargetName, TransportType};
use clap::{Args, Parser, Subcommand};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(name = "acm", author, version, about = "Agent Configuration Manager")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Commands>,

    /// Target home directory (global scope)
    #[arg(short = 'H', long = "home", global = true)]
    pub home: bool,

    /// Targets to act on (comma separated: claude, codex, agy, grok)
    #[arg(short = 't', long = "targets", global = true, value_delimiter = ',')]
    pub targets: Option<Vec<TargetName>>,

    /// Output machine-readable JSON
    #[arg(long = "json", global = true)]
    pub json: bool,

    /// Verbose output
    #[arg(short = 'v', long = "verbose", global = true)]
    pub verbose: bool,
}

#[derive(Subcommand, Debug)]
pub enum Commands {
    /// Overview of installed skills and MCP servers for project/home
    Status,
    /// Manage MCP servers
    Mcp(McpArgs),
    /// Manage skills
    Skill(SkillArgs),
    /// Run diagnostics and health checks
    Doctor(DoctorArgs),
    /// Validate current project configuration
    Validate(ValidateArgs),
}

#[derive(Args, Debug)]
pub struct McpArgs {
    #[command(subcommand)]
    pub command: Option<McpSubcommands>,
}

#[derive(Subcommand, Debug)]
pub enum McpSubcommands {
    /// Show MCP status (default)
    List,
    /// Add an MCP server
    Add {
        package_id: String,
        /// Command to execute (e.g. npx, node, python)
        #[arg(long)]
        command: Option<String>,
        /// Arguments to pass to command
        #[arg(long = "arg")]
        args: Option<Vec<String>>,
        /// URL for SSE/HTTP MCP server
        #[arg(long)]
        url: Option<String>,
        /// Working directory for MCP server
        #[arg(long)]
        cwd: Option<String>,
        /// Environment variables (KEY=VALUE format)
        #[arg(long = "env", value_parser = parse_key_val)]
        env: Option<Vec<(String, String)>>,
    },
    /// Remove an MCP server
    Remove { server_name: String },
    /// Enable an MCP server
    Enable { server_name: String },
    /// Disable an MCP server
    Disable { server_name: String },
}

fn parse_key_val(s: &str) -> Result<(String, String), String> {
    let pos = s.find('=').ok_or_else(|| format!("Invalid KEY=VALUE: no `=` found in `{}`", s))?;
    Ok((s[..pos].to_string(), s[pos + 1..].to_string()))
}

#[derive(Args, Debug)]
pub struct SkillArgs {
    #[command(subcommand)]
    pub command: Option<SkillSubcommands>,
}

#[derive(Subcommand, Debug)]
pub enum SkillSubcommands {
    /// Show skill status (default: installed skills)
    List {
        /// Show all catalog skills including uninstalled ones
        #[arg(short = 'a', long)]
        all: bool,
    },
    /// Add a skill from catalog to project
    Add {
        skill_id: String,
        #[arg(long, conflicts_with = "copy")]
        link: bool,
        #[arg(long, conflicts_with = "link")]
        copy: bool,
    },
    /// Update stale copied skills to latest catalog version (Roadmap Priority 1)
    Update {
        skill_name: Option<String>,
        #[arg(long)]
        force: bool,
    },
    /// Register a directory in catalog as a symlink (Proposal 2: --distribute)
    Link {
        source_path: PathBuf,
        #[arg(long = "as")]
        skill_id: Option<String>,
        #[arg(long = "distribute")]
        distribute: bool,
    },
    /// Remove a catalog link
    Unlink { skill_id: String },
    /// Rename a skill across catalog and provider targets (Proposal 1)
    Rename {
        old_name: String,
        new_name: String,
        #[arg(long = "path")]
        new_source_path: Option<PathBuf>,
    },
    /// Remove a skill from targets
    Remove { skill_name: String },
    /// Validate SKILL.md and YAML frontmatter (Proposal 4)
    Validate {
        #[arg(default_value = ".")]
        path: PathBuf,
    },
}

#[derive(Args, Debug)]
pub struct DoctorArgs {
    /// Attempt to auto-fix found issues (e.g. broken symlinks)
    #[arg(long)]
    pub fix: bool,
    /// Fail on warnings as well as errors
    #[arg(long)]
    pub strict: bool,
    /// Skip checks requiring network
    #[arg(long)]
    pub offline: bool,
}

#[derive(Args, Debug)]
pub struct ValidateArgs {
    /// Fail on warnings
    #[arg(long)]
    pub strict: bool,
}

pub fn resolve_targets(cli_targets: Option<Vec<TargetName>>) -> Vec<TargetName> {
    cli_targets.unwrap_or_else(|| vec![TargetName::Claude, TargetName::Codex, TargetName::Antigravity, TargetName::Grok])
}

pub fn get_project_root(home_flag: bool) -> PathBuf {
    if home_flag {
        home_dir()
    } else {
        std::env::current_dir().unwrap_or_else(|_| home_dir())
    }
}

pub async fn run_cli(cli: Cli) -> anyhow::Result<()> {
    let targets = resolve_targets(cli.targets);
    let root = get_project_root(cli.home);

    match cli.command {
        Some(Commands::Status) => handle_status(&root, &targets, cli.home, cli.json)?,
        Some(Commands::Mcp(args)) => handle_mcp(args, &root, &targets, cli.json, cli.verbose)?,
        Some(Commands::Skill(args)) => handle_skill(args, &root, &targets, cli.home, cli.json, cli.verbose)?,
        Some(Commands::Doctor(args)) => handle_doctor(args, &root, &targets, cli.json)?,
        Some(Commands::Validate(args)) => {
            let doc_args = DoctorArgs { fix: false, strict: args.strict, offline: true };
            handle_doctor(doc_args, &root, &targets, cli.json)?;
        }
        None => {
            // No subcommand: if TTY, launch TUI, otherwise show status overview
            if crossterm::tty::IsTty::is_tty(&std::io::stdout()) && !cli.json {
                crate::tui::run_tui(&root, &targets)?;
            } else {
                handle_status(&root, &targets, cli.home, cli.json)?;
            }
        }
    }

    Ok(())
}

fn handle_status(
    root: &PathBuf,
    targets: &[TargetName],
    home_flag: bool,
    json: bool,
) -> anyhow::Result<()> {
    let skill_status = get_skill_workspace_status(root, targets)?;
    let mcp_status = get_mcp_workspace_status(root, targets)?;

    if json {
        let combined = serde_json::json!({
            "scope": if home_flag { "global" } else { "project" },
            "project_root": root.display().to_string(),
            "skills": skill_status,
            "mcps": mcp_status,
        });
        println!("{}", serde_json::to_string_pretty(&combined)?);
    } else {
        let scope_label = if home_flag { "Global (~/)" } else { "Project" };
        let targets_str = targets.iter().map(|t| t.as_str()).collect::<Vec<_>>().join(", ");

        println!("==================================================");
        println!("  acm Status Overview — {}", scope_label);
        println!("  Path:    {}", root.display());
        println!("  Targets: {}", targets_str);
        println!("==================================================");

        println!("\n📦 Installed Skills ({}/{} enabled):", skill_status.enabled_count, skill_status.total_count);
        let enabled_skills: Vec<_> = skill_status.skills.iter().filter(|s| s.enabled).collect();
        if enabled_skills.is_empty() {
            println!("  (No skills currently installed in this scope)");
        } else {
            for s in &enabled_skills {
                let mut target_details = Vec::new();
                for &t in targets {
                    if let Some(st) = s.placement.get(&t) {
                        if *st != crate::types::SkillPlacementState::Missing && *st != crate::types::SkillPlacementState::Unlinked {
                            target_details.push(format!("{}:{:?}", t.short_code(), st));
                        }
                    }
                }
                println!("  ✓ {:<30} [{}]", s.name, target_details.join(" "));
            }
        }

        println!("\n🔌 Configured MCP Servers ({}/{} enabled):", mcp_status.enabled_count, mcp_status.total_count);
        if mcp_status.servers.is_empty() {
            println!("  (No MCP servers configured in this scope)");
        } else {
            for m in &mcp_status.servers {
                let targets_str = m.targets.iter().map(|t| t.as_str()).collect::<Vec<_>>().join(", ");
                let icon = if m.enabled { "✓" } else { "✗" };
                println!("  {} {:<30} (targets: {})", icon, m.name, targets_str);
            }
        }
        println!("\nTip: Run `acm` (interactive TUI) or `acm -H status` for global home scope.");
    }

    Ok(())
}

fn handle_mcp(
    args: McpArgs,
    root: &PathBuf,
    targets: &[TargetName],
    json: bool,
    _verbose: bool,
) -> anyhow::Result<()> {
    match args.command.unwrap_or(McpSubcommands::List) {
        McpSubcommands::List => {
            let status = get_mcp_workspace_status(root, targets)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&status)?);
            } else {
                println!("Project: {}", status.project_root);
                println!("MCP Servers ({} total, {} enabled):\n", status.total_count, status.enabled_count);
                for s in status.servers {
                    let targets_str = s.targets.iter().map(|t| t.as_str()).collect::<Vec<_>>().join(", ");
                    println!("  {} {} (targets: {})", if s.enabled { "✓" } else { "✗" }, s.name, targets_str);
                }
            }
        }
        McpSubcommands::Add { package_id, command, args, url, cwd, env } => {
            let custom_recipe = if command.is_some() || url.is_some() || args.is_some() || cwd.is_some() || env.is_some() {
                let env_map: Option<HashMap<String, String>> = env.map(|pairs| pairs.into_iter().collect());
                let transport = if url.is_some() {
                    Some(TransportType::Http)
                } else {
                    Some(TransportType::Stdio)
                };
                Some(McpRecipe {
                    command,
                    args,
                    url,
                    cwd,
                    env: env_map,
                    transport,
                })
            } else {
                None
            };

            mcp_add(root, &package_id, targets, custom_recipe.as_ref())?;
            println!("✓ Added MCP server: {}", package_id);
        }
        McpSubcommands::Remove { server_name } => {
            mcp_remove(root, &server_name, targets)?;
            println!("✓ Removed MCP server: {}", server_name);
        }
        McpSubcommands::Enable { server_name } => {
            mcp_enable(root, &server_name, targets)?;
            println!("✓ Enabled MCP server: {}", server_name);
        }
        McpSubcommands::Disable { server_name } => {
            mcp_disable(root, &server_name, targets)?;
            println!("✓ Disabled MCP server: {}", server_name);
        }
    }
    Ok(())
}

fn handle_skill(
    args: SkillArgs,
    root: &PathBuf,
    targets: &[TargetName],
    allow_home: bool,
    json: bool,
    _verbose: bool,
) -> anyhow::Result<()> {
    match args.command.unwrap_or(SkillSubcommands::List { all: false }) {
        SkillSubcommands::List { all } => {
            let status = get_skill_workspace_status(root, targets)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&status)?);
            } else {
                println!("Context: {}", root.display());
                println!("Skills ({} installed / {} catalog total):\n", status.enabled_count, status.total_count);

                let (enabled_skills, uninstalled_skills): (Vec<_>, Vec<_>) = status.skills.into_iter().partition(|s| s.enabled);

                for s in &enabled_skills {
                    let targets_str = s.targets.iter().map(|t| t.as_str()).collect::<Vec<_>>().join(", ");
                    println!("  ✓ {:<30} (targets: {}, source: {})", s.name, targets_str, s.source);
                }

                if all {
                    println!("\nUninstalled Catalog Skills:");
                    for s in &uninstalled_skills {
                        println!("  ✗ {:<30} (source: {})", s.name, s.source);
                    }
                } else if !uninstalled_skills.is_empty() {
                    println!("\n  ... and {} uninstalled skills in catalog (use `acm skill list --all` to view all)", uninstalled_skills.len());
                }
            }
        }
        SkillSubcommands::Add { skill_id, link, copy } => {
            let mode = if link {
                Some(SkillPlacementMode::Link)
            } else if copy {
                Some(SkillPlacementMode::Copy)
            } else {
                None
            };
            skill_add(root, &skill_id, targets, mode)?;
            println!("✓ Added skill: {}", skill_id);
        }
        SkillSubcommands::Update { skill_name, force } => {
            let result = skill_update(root, skill_name.as_deref(), targets, force)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&result)?);
            } else {
                println!("Skill Update Summary\n==================================================");
                println!("  Updated: {}, Skipped: {}\n", result.updated_count, result.skipped_count);
                for d in &result.details {
                    let icon = if d.updated { "✓" } else { "•" };
                    println!("  {} [{}] {}: {}", icon, d.target, d.skill_name, d.reason);
                }
                println!("==================================================");
            }
        }
        SkillSubcommands::Link { source_path, skill_id, distribute } => {
            let dist_targets = if distribute { Some(targets) } else { None };
            let registered_id = skill_link(&source_path, skill_id.as_deref(), dist_targets, allow_home)?;
            println!("✓ Linked skill '{}' into catalog from {}", registered_id, source_path.display());
            if distribute {
                println!("✓ Automatically distributed to targets: {:?}", targets);
            }
        }
        SkillSubcommands::Unlink { skill_id } => {
            skill_unlink(&skill_id)?;
            println!("✓ Unlinked skill '{}' from catalog", skill_id);
        }
        SkillSubcommands::Rename { old_name, new_name, new_source_path } => {
            skill_rename(root, &old_name, &new_name, new_source_path.as_ref(), targets)?;
            println!("✓ Renamed skill '{}' -> '{}' across catalog and targets", old_name, new_name);
        }
        SkillSubcommands::Remove { skill_name } => {
            skill_remove(root, &skill_name, targets)?;
            println!("✓ Removed skill '{}'", skill_name);
        }
        SkillSubcommands::Validate { path } => {
            let issues = validate_skill_directory(&path)?;
            let has_errors = issues.iter().any(|i| i.severity == IssueSeverity::Error);
            if json {
                println!("{}", serde_json::to_string_pretty(&issues)?);
            } else {
                println!("Validating skill at: {}\n", path.display());
                if issues.is_empty() {
                    println!("✓ SKILL.md is valid!");
                } else {
                    for issue in &issues {
                        match issue.severity {
                            IssueSeverity::Error => println!("  ✗ [Error] {}", issue.message),
                            IssueSeverity::Warning => println!("  ⚠ [Warning] {}", issue.message),
                        }
                    }
                }
            }

            if has_errors {
                std::process::exit(1);
            }
        }
    }
    Ok(())
}

fn handle_doctor(
    args: DoctorArgs,
    root: &PathBuf,
    targets: &[TargetName],
    json: bool,
) -> anyhow::Result<()> {
    let report = run_doctor(root, args.fix, targets)?;

    if json {
        println!("{}", serde_json::to_string_pretty(&report)?);
    } else {
        println!("acm Diagnostics\n==================================================");
        for check in &report.checks {
            let icon = match check.status {
                crate::core::doctor::CheckStatus::Pass => "✓",
                crate::core::doctor::CheckStatus::Warning => "⚠",
                crate::core::doctor::CheckStatus::Error => "✗",
                crate::core::doctor::CheckStatus::Info => "ℹ",
            };
            println!("  {} [{}] {}", icon, check.category, check.title);
            if let Some(detail) = &check.detail {
                println!("      {}", detail);
            }
            if let Some(fix) = &check.fix_applied {
                println!("      🔧 Fix applied: {}", fix);
            }
        }
        println!("==================================================");
        if report.fixed_count > 0 {
            println!("✓ Auto-fixed {} issue(s)!", report.fixed_count);
        }
    }

    if report.has_errors || (report.has_warnings && args.strict) {
        std::process::exit(1);
    }

    Ok(())
}
