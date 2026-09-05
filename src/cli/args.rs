use clap::{Args, Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(
    name = "acm",
    author,
    version,
    about = "Agent Configuration Manager",
    after_help = "Scopes: project (default), --home/-H (provider home), --catalog/-g (reusable definitions).\nRun acm interactively for the TUI; use --json for automation."
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Commands>,
    #[arg(short = 'H', long = "home", aliases = ["allow-home", "allowHome"], global = true, conflicts_with_all = ["catalog", "project"])]
    pub home: bool,
    #[arg(
        short = 'g',
        long = "catalog",
        alias = "global",
        global = true,
        conflicts_with = "project"
    )]
    pub catalog: bool,
    #[arg(long, global = true)]
    pub project: bool,
    #[arg(
        short = 't',
        long = "targets",
        alias = "target",
        global = true,
        value_delimiter = ','
    )]
    pub targets: Option<Vec<String>>,
    #[arg(long, global = true)]
    pub json: bool,
    #[arg(short = 'v', long, global = true)]
    pub verbose: bool,
}

#[derive(Subcommand, Debug)]
pub enum Commands {
    /// Overview of skills, MCP servers, and plugins
    Status,
    /// Interactive setup (use resource add commands for automation)
    #[command(alias = "tui")]
    Init,
    /// Manage MCP servers
    Mcp(McpArgs),
    /// Manage skills
    Skill(SkillArgs),
    /// Manage native plugins
    Plugin(PluginArgs),
    /// Legacy aliases for reusable definitions and allowlisted publication
    Catalog(CatalogArgs),
    /// Discover configured assets and import them into the catalog
    Scan(ScanArgs),
    /// Inspect configuration, commands, portability, and broken links
    Doctor(DoctorArgs),
    /// Read-only validation (alias for diagnostics)
    Validate(ValidateArgs),
}

#[derive(Args, Debug)]
pub struct CatalogArgs {
    #[command(subcommand)]
    pub command: Option<CatalogCommands>,
}
#[derive(Subcommand, Debug)]
pub enum CatalogCommands {
    Mcp(McpArgs),
    Skill(SkillArgs),
    Publish(PublishArgs),
}

#[derive(Args, Debug, Default, Clone)]
pub struct Filters {
    #[arg(long)]
    pub search: Option<String>,
    #[arg(long)]
    pub category: Option<String>,
    #[arg(long)]
    pub agent: Option<String>,
    #[arg(long)]
    pub plugin: Option<String>,
    #[arg(long)]
    pub source_type: Option<String>,
    #[arg(long)]
    pub language: Option<String>,
    #[arg(long)]
    pub popularity: Option<String>,
    #[arg(long)]
    pub pinned: bool,
    #[arg(long)]
    pub deprecated: bool,
}

#[derive(Args, Debug)]
pub struct McpArgs {
    #[command(subcommand)]
    pub command: Option<McpSubcommands>,
}
#[derive(Subcommand, Debug)]
pub enum McpSubcommands {
    #[command(alias = "status")]
    List(Filters),
    Show {
        id: String,
    },
    Add(McpAddArgs),
    Edit {
        id: String,
        #[command(flatten)]
        recipe: RecipeArgs,
    },
    Remove {
        id: String,
    },
    Enable {
        id: String,
    },
    Disable {
        id: String,
    },
    Update {
        id: Option<String>,
    },
    Adopt {
        id: Option<String>,
    },
    Init,
}
#[derive(Args, Debug)]
pub struct McpAddArgs {
    pub id: String,
    #[command(flatten)]
    pub recipe: RecipeArgs,
    #[arg(long, conflicts_with = "register")]
    pub no_register: bool,
    #[arg(long)]
    pub register: bool,
    #[arg(long)]
    pub display_name: Option<String>,
    #[arg(long)]
    pub description: Option<String>,
}
#[derive(Args, Debug, Default)]
pub struct RecipeArgs {
    #[arg(long, conflicts_with_all = ["url", "local", "from_package"])]
    pub command: Option<String>,
    #[arg(long = "arg", allow_hyphen_values = true, conflicts_with = "args_json")]
    pub args: Vec<String>,
    #[arg(long = "args")]
    pub args_json: Option<String>,
    #[arg(long, conflicts_with_all = ["local", "from_package"])]
    pub url: Option<String>,
    #[arg(long)]
    pub cwd: Option<String>,
    #[arg(long)]
    pub env: Vec<String>,
    #[arg(long, conflicts_with = "from_package")]
    pub local: Option<PathBuf>,
    #[arg(long)]
    pub from_package: Option<String>,
}

#[derive(Args, Debug)]
pub struct SkillArgs {
    #[command(subcommand)]
    pub command: Option<SkillSubcommands>,
}
#[derive(Args, Debug, Default)]
pub struct PlacementArgs {
    #[arg(long, conflicts_with = "copy")]
    pub link: bool,
    #[arg(long)]
    pub copy: bool,
}
#[derive(Subcommand, Debug)]
pub enum SkillSubcommands {
    #[command(alias = "status")]
    List {
        #[arg(short = 'a', long)]
        all: bool,
        #[command(flatten)]
        filter: Filters,
    },
    Show {
        id: String,
    },
    Add {
        id: String,
        #[arg(long)]
        file: Option<PathBuf>,
        #[arg(long)]
        display_name: Option<String>,
        #[arg(long)]
        description: Option<String>,
        #[arg(long)]
        no_register: bool,
        #[arg(long, conflicts_with = "no_register")]
        register: bool,
        #[command(flatten)]
        placement: PlacementArgs,
    },
    Import {
        path: PathBuf,
        #[arg(long, alias = "no-register")]
        no_catalog: bool,
        #[arg(long = "as", aliases = ["name", "skill-id"])]
        id: Option<String>,
        #[arg(long)]
        force: bool,
        #[arg(long)]
        display_name: Option<String>,
        #[arg(long)]
        description: Option<String>,
        #[command(flatten)]
        placement: PlacementArgs,
    },
    Install {
        source: String,
        #[arg(long, alias = "no-register")]
        no_catalog: bool,
        #[arg(long = "name", alias = "as")]
        name: Option<String>,
        #[arg(long)]
        force: bool,
        #[command(flatten)]
        placement: PlacementArgs,
    },
    Search {
        query: String,
    },
    Update {
        id: Option<String>,
        #[arg(long)]
        force: bool,
        #[command(flatten)]
        placement: PlacementArgs,
    },
    Link {
        path: PathBuf,
        #[arg(long = "as", alias = "name")]
        id: Option<String>,
        #[arg(long)]
        distribute: bool,
        #[arg(long)]
        validate: bool,
    },
    Unlink {
        id: String,
    },
    Rename {
        old_name: String,
        new_name: String,
        #[arg(long = "path")]
        source: Option<PathBuf>,
    },
    Remove {
        id: String,
    },
    Enable {
        id: String,
    },
    Disable {
        id: String,
    },
    Validate {
        #[arg(default_value = ".")]
        path: PathBuf,
    },
    Meta(MetadataArgs),
    Outdated {
        id: Option<String>,
        #[arg(long)]
        all: bool,
    },
    Init,
}
#[derive(Args, Debug)]
pub struct MetadataArgs {
    pub id: String,
    #[arg(long = "pin", alias = "pinned", conflicts_with = "unpin")]
    pub pin: bool,
    #[arg(long)]
    pub unpin: bool,
    #[arg(long, conflicts_with = "no_deprecated")]
    pub deprecated: bool,
    #[arg(long)]
    pub no_deprecated: bool,
    #[arg(long)]
    pub tags: Option<String>,
    #[arg(long)]
    pub category: Option<String>,
    #[arg(long)]
    pub source: Option<String>,
    #[arg(long = "ref")]
    pub source_ref: Option<String>,
    #[arg(long, conflicts_with = "no_forked")]
    pub forked: bool,
    #[arg(long)]
    pub no_forked: bool,
}

#[derive(Args, Debug)]
pub struct PluginArgs {
    #[command(subcommand)]
    pub command: Option<PluginSubcommands>,
}
#[derive(Subcommand, Debug)]
pub enum PluginSubcommands {
    List,
    Show {
        id: String,
    },
    /// Link a development plugin into the catalog
    Add {
        path: PathBuf,
        #[arg(long = "as")]
        id: Option<String>,
    },
    /// Import a complete plugin snapshot into the catalog
    Import {
        path: PathBuf,
        #[arg(long = "as")]
        id: Option<String>,
        #[arg(long)]
        force: bool,
    },
    Install {
        id: String,
    },
    #[command(alias = "uninstall")]
    Remove {
        id: String,
        #[arg(long)]
        keep_skills: bool,
    },
    Unlink {
        id: String,
    },
    Convert {
        id: Option<String>,
        #[arg(long)]
        all: bool,
        #[arg(short = 'n', long)]
        dry_run: bool,
        #[arg(long)]
        assemble_only: bool,
    },
    Update {
        ids: Vec<String>,
        #[arg(long)]
        all: bool,
        #[arg(short = 'n', long)]
        dry_run: bool,
        #[arg(short = 'f', long)]
        force: bool,
    },
    Discover {
        #[arg(long)]
        import: bool,
        #[arg(long)]
        root: Vec<PathBuf>,
    },
    Scan {
        #[arg(long)]
        diff: bool,
    },
    Snapshot,
    Repair {
        #[arg(long)]
        apply: bool,
    },
    Doctor,
}
#[derive(Args, Debug, Default)]
pub struct ScanArgs {
    #[arg(long)]
    pub dry_run: bool,
}
#[derive(Args, Debug, Default)]
pub struct DoctorArgs {
    #[arg(long)]
    pub fix: bool,
    #[arg(long)]
    pub strict: bool,
    #[arg(long)]
    pub offline: bool,
}
#[derive(Args, Debug)]
pub struct ValidateArgs {
    #[arg(long)]
    pub strict: bool,
}
#[derive(Args, Debug)]
pub struct PublishArgs {
    #[arg(long)]
    pub allowlist: Option<PathBuf>,
    #[arg(long)]
    pub to: Option<PathBuf>,
    #[arg(long)]
    pub commit: bool,
    #[arg(long)]
    pub dry_run: bool,
}
