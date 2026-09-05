mod args;
mod mcp;
mod plugin;
mod skill;
use crate::core::operations::{error_code, redact_text, OperationFailure, OperationReport};
use crate::paths::*;
use crate::types::TargetName;
use anyhow::{bail, Context};
pub use args::*;
use serde::Serialize;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::io::IsTerminal;
use std::path::PathBuf;

pub struct ContextOptions {
    pub home: bool,
    pub catalog: bool,
    pub project: bool,
    pub json: bool,
    pub targets: Vec<TargetName>,
    output_value: RefCell<Option<Value>>,
    outcomes: RefCell<Vec<Value>>,
}
impl ContextOptions {
    pub fn root(&self) -> anyhow::Result<PathBuf> {
        if self.home {
            Ok(home_dir())
        } else {
            discover_project(&std::env::current_dir()?)
        }
    }
    pub fn plugin_root(&self) -> anyhow::Result<PathBuf> {
        if self.project {
            self.root()
        } else {
            Ok(home_dir())
        }
    }
    pub fn output(&self, value: impl Serialize) -> anyhow::Result<()> {
        let mut value = serde_json::to_value(value)?;
        let reports = self.outcomes.borrow();
        if !reports.is_empty() {
            if !value.is_object() {
                value = json!({"data":value});
            }
            value["ok"] = json!(true);
            value["results"] = json!(reports
                .iter()
                .flat_map(|v| v["results"].as_array().into_iter().flatten().cloned())
                .collect::<Vec<_>>());
            value["retryTargets"] = json!([]);
        }
        self.output_value.replace(Some(value));
        Ok(())
    }
    fn flush(&self) -> anyhow::Result<()> {
        let Some(value) = self.output_value.take() else {
            return Ok(());
        };
        if self.json {
            println!("{}", serde_json::to_string(&value)?);
        } else if let Some(message) = value.get("message").and_then(Value::as_str) {
            println!("{message}");
        } else {
            println!("{}", serde_json::to_string_pretty(&value)?);
        }
        Ok(())
    }
    pub fn for_targets<T: Serialize>(
        &self,
        operation: &str,
        resource: &str,
        mut action: impl FnMut(TargetName) -> anyhow::Result<T>,
    ) -> anyhow::Result<Vec<Value>> {
        let mut report = OperationReport::new(operation, resource);
        let mut values = Vec::new();
        for &target in &self.targets {
            let result = action(target).and_then(|value| Ok(serde_json::to_value(value)?));
            if let Ok(value) = &result {
                values.push(value.clone());
            }
            report.push(target, result);
        }
        self.outcomes.borrow_mut().push(report.finish()?);
        Ok(values)
    }
    pub fn completed_targets(&self, operation: &str, resource: &str) -> anyhow::Result<()> {
        let mut report = OperationReport::new(operation, resource);
        for &target in &self.targets {
            report.push(target, Ok(json!({"completed":true})));
        }
        self.outcomes.borrow_mut().push(report.finish()?);
        Ok(())
    }
    pub fn done(&self, message: impl Into<String>) -> anyhow::Result<()> {
        self.output(json!({"ok": true, "message": message.into()}))
    }
    pub fn tui(&self, tab: crate::tui::app::ActiveTab) -> anyhow::Result<()> {
        if self.json || !std::io::stdin().is_terminal() || !std::io::stdout().is_terminal() {
            bail!("Interactive setup requires a terminal. Use list, add, import, or install for automation.");
        }
        if self.catalog {
            bail!("The TUI manages provider scopes; use --catalog list/add/import for catalog operations");
        }
        crate::tui::app::run_tui_tab(&self.root()?, &self.targets, tab)
    }
}

pub fn filtered(items: Vec<Value>, filters: &Filters, metadata: &Value) -> Vec<Value> {
    items
        .into_iter()
        .filter_map(|mut item| {
            let id = item
                .get("id")
                .or_else(|| item.get("name"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            let meta = metadata.get(&id).cloned().unwrap_or_else(|| json!({}));
            for (field, expected) in [
                ("category", &filters.category),
                ("agent", &filters.agent),
                ("plugin", &filters.plugin),
                ("sourceType", &filters.source_type),
                ("language", &filters.language),
                ("popularity", &filters.popularity),
            ] {
                if expected.as_ref().is_some_and(|expected| {
                    meta.get(field)
                        .or_else(|| item.get(field))
                        .and_then(Value::as_str)
                        != Some(expected)
                }) {
                    return None;
                }
            }
            if filters.pinned && meta.get("pinned").and_then(Value::as_bool) != Some(true) {
                return None;
            }
            if filters.deprecated && meta.get("deprecated").and_then(Value::as_bool) != Some(true) {
                return None;
            }
            if filters.search.as_ref().is_some_and(|search| {
                !format!("{item} {meta}")
                    .to_lowercase()
                    .contains(&search.to_lowercase())
            }) {
                return None;
            }
            item["metadata"] = meta;
            Some(item)
        })
        .collect()
}

pub fn run_cli(cli: Cli) -> anyhow::Result<()> {
    read_acm_config()?;
    let targets = match cli.targets {
        Some(values) => {
            let mut targets = Vec::new();
            for value in values {
                if value == "all" {
                    targets = TargetName::all().to_vec();
                    continue;
                }
                let target = value.parse().map_err(anyhow::Error::msg)?;
                if !targets.contains(&target) {
                    targets.push(target);
                }
            }
            if targets.is_empty() {
                bail!("Select at least one target");
            }
            targets
        }
        None => default_targets()?,
    };
    let mut ctx = ContextOptions {
        home: cli.home,
        catalog: cli.catalog,
        project: cli.project,
        json: cli.json,
        targets,
        output_value: RefCell::new(None),
        outcomes: RefCell::new(Vec::new()),
    };
    if cli.verbose {
        let scope = if ctx.catalog || matches!(cli.command, Some(Commands::Catalog(_))) {
            "catalog"
        } else if ctx.home {
            "home"
        } else if matches!(cli.command, Some(Commands::Plugin(_))) && !ctx.project {
            "home (native plugins)"
        } else {
            "project"
        };
        eprintln!(
            "ACM {} | scope={scope} | targets={} | catalog={}",
            env!("CARGO_PKG_VERSION"),
            ctx.targets
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join(","),
            get_catalog_dir().display()
        );
    }
    let result = match cli.command {
        None if ctx.json || !std::io::stdin().is_terminal() => status(&ctx, false),
        None | Some(Commands::Init) => ctx.tui(crate::tui::app::ActiveTab::Skills),
        Some(Commands::Status { verify }) => status(&ctx, verify),
        Some(Commands::Mcp(args)) => mcp::run(&ctx, args),
        Some(Commands::Skill(args)) => skill::run(&ctx, args),
        Some(Commands::Plugin(args)) => plugin::run(&ctx, args),
        Some(Commands::Catalog(args)) => {
            ctx.catalog = true;
            match args.command {
                Some(CatalogCommands::Mcp(args)) => mcp::run(&ctx, args),
                Some(CatalogCommands::Skill(args)) => skill::run(&ctx, args),
                Some(CatalogCommands::Publish(args)) => ctx.output(crate::core::publish::publish(
                    args.allowlist.as_deref(),
                    args.to.as_deref(),
                    args.commit,
                    args.dry_run,
                )?),
                None => status(&ctx, false),
            }
        }
        Some(Commands::Scan(args)) => ctx.output(crate::core::discovery::scan_import(
            &ctx.root()?,
            &ctx.targets,
            args.dry_run,
        )?),
        Some(Commands::Doctor(args)) => diagnostics(&ctx, args.fix, args.strict),
        Some(Commands::Validate(args)) => diagnostics(&ctx, false, args.strict),
    };
    match result {
        Ok(()) => ctx.flush(),
        Err(error) => {
            let structured = error.downcast_ref::<OperationFailure>();
            let mut report = structured
                .map(|failure| failure.report.clone())
                .or_else(|| ctx.output_value.take())
                .unwrap_or_else(|| json!({}));
            if !report.is_object() {
                report = json!({"data":report});
            }
            report["ok"] = json!(false);
            if structured.is_none() {
                report["error"] =
                    json!({"code":error_code(&error),"message":redact_text(&format!("{error:#}"))});
            }
            if !ctx.outcomes.borrow().is_empty() {
                report["completedOperations"] = json!(*ctx.outcomes.borrow());
            }
            Err(OperationFailure { report }.into())
        }
    }
}

fn status(ctx: &ContextOptions, verify: bool) -> anyhow::Result<()> {
    if ctx.catalog {
        if verify {
            bail!("Native verification requires a provider scope");
        }
        return ctx.output(json!({"catalog": get_catalog_dir(), "mcps": crate::catalog::store::list_mcps()?, "skills": crate::catalog::store::list_skills()?, "plugins": crate::core::plugin::catalog_plugin_ids()?}));
    }
    let root = ctx.root()?;
    let mut value = json!({"projectRoot": root, "mcps": crate::core::mcp::get_mcp_workspace_status(&root, &ctx.targets)?, "skills": crate::core::skill::get_skill_workspace_status(&root, &ctx.targets)?, "plugins": crate::core::plugin::get_plugin_workspace_status(&ctx.plugin_root()?, &ctx.targets)?});
    if verify {
        value["verification"] = crate::core::plugin_verification::verify_plugins(
            &ctx.plugin_root()?,
            &[],
            &ctx.targets,
            false,
        )?;
    }
    ctx.output(value)
}
fn diagnostics(ctx: &ContextOptions, fix: bool, strict: bool) -> anyhow::Result<()> {
    let root = if ctx.catalog {
        get_catalog_dir()
    } else {
        ctx.root()?
    };
    let report =
        crate::core::doctor::run_doctor(root, fix, if ctx.catalog { &[] } else { &ctx.targets })?;
    ctx.output(&report)?;
    if report.has_errors || (strict && report.has_warnings) {
        bail!(
            "Diagnostics found {}",
            if report.has_errors {
                "errors"
            } else {
                "warnings (--strict)"
            }
        );
    }
    Ok(())
}

pub fn metadata_block(path: &std::path::Path, key: &str) -> anyhow::Result<Value> {
    Ok(crate::storage::read_value(path)?
        .get(key)
        .cloned()
        .unwrap_or_else(|| json!({})))
}
pub fn expect_catalog_skill(id: &str) -> anyhow::Result<crate::types::SkillCatalogEntry> {
    crate::catalog::store::get_skill(id)?
        .with_context(|| format!("Skill {id} not found in catalog"))
}
