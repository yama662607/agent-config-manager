#!/usr/bin/env node
import type { TargetName } from './types.js';

// CLI command handlers
import {
  catalogMcpList,
  catalogMcpShow,
  catalogMcpAdd,
  catalogMcpRemove,
  catalogSkillList,
  catalogSkillShow,
  catalogSkillAdd,
  catalogSkillRemove,
} from './cli-catalog.js';
import {
  mcpStatus,
  mcpAdd,
  mcpRemove,
  mcpEnable,
  mcpDisable,
  type McpAddOptions,
  type McpRemoveOptions,
  type McpEnableOptions,
  type McpDisableOptions,
} from './cli-mcp.js';
import {
  skillStatus,
  skillAdd,
  skillRemove,
  skillEnable,
  skillDisable,
  type SkillAddOptions,
  type SkillRemoveOptions,
  type SkillEnableOptions,
  type SkillDisableOptions,
} from './cli-skill.js';
import { validate, doctor } from './cli-diagnostics.js';

// ============================================================================
// Constants
// ============================================================================

const HELP = `acsync - Agent configuration sync tool

USAGE:
  acsync [COMMAND]

COMMANDS:
  init        Interactive setup for the current project
  catalog     Browse and manage catalog (TUI mode)
  mcp         Manage MCP servers for the current project (TUI mode)
  skill       Manage skills for the current project (TUI mode)
  validate    Validate current project configuration
  doctor      Run diagnostics and health checks

OPTIONS:
  -h, --help    Show this help message
  -V, --version Show version information

TARGETS:
  claude     Claude Code (.mcp.json, .claude/skills/)
  codex      Codex (.codex/config.toml, .codex/skills/)
  gemini     Gemini CLI (.gemini/settings.json, .gemini/skills/)

ABOUT CATALOG:
  Your personal catalog (~/.acsync/) stores reusable MCP and skill definitions.
  Use "acsync catalog" to browse and manage the catalog interactively.

EXAMPLES:
  acsync init                         Interactive setup for current project
  acsync catalog                       Browse catalog in TUI mode
  acsync mcp                           Manage MCPs in TUI mode
  acsync skill                         Manage skills in TUI mode
  acsync mcp status                    Show MCP status
  acsync skill status                  Show skill status
  acsync catalog mcp list              List all MCPs in catalog
  acsync mcp add github --targets claude   Add GitHub MCP to Claude Code

For more information, run: acsync <command> --help
`;

const CATALOG_HELP = `acsync catalog - Manage reusable MCP and skill definitions

USAGE:
  acsync catalog <kind> <subcommand>

ABOUT CATALOG:
  Your personal catalog (~/.acsync/catalog.json) stores reusable MCP servers
  and skills. Once added to the catalog, you can easily add them to any project.

KINDS:
  mcp         Manage MCP definitions
  skill       Manage skill definitions

MCP SUBCOMMANDS:
  list        List all MCP entries in catalog
  show <id>   Show details of a specific MCP entry
  add <pkg>   Add a new MCP entry to catalog
  remove <id> Remove an MCP entry from catalog

SKILL SUBCOMMANDS:
  list              List all skill entries in catalog
  show <id>         Show details of a specific skill entry
  add <name>        Add a new skill entry to catalog from file
  import <path>     Import a skill from a local directory
  install <id>      Install a skill from skills.directory registry
  search <query>    Search the skills.directory registry
  remove <id>        Remove a skill entry from catalog

OPTIONS (mcp add):
  --url <url>           HTTP/SSE URL for the MCP server
  --command <cmd>       Command to execute (stdio transport)
  --args <json>         Arguments for command (JSON array)
  --cwd <path>          Working directory for command
  --display-name <name> Display name for the entry
  --description <desc>  Description for the entry
  --env <json>          Environment variables (JSON object)

OPTIONS (skill install):
  --force              Force reinstall if already exists

OPTIONS (skill import):
  --name <name>             Override skill name
  --display-name <name>     Display name for the entry
  --description <desc>       Description for the entry

EXAMPLES:
  # Catalog operations
  acsync catalog mcp list
  acsync catalog mcp show @modelcontextprotocol/server-github
  acsync catalog mcp add @modelcontextprotocol/server-filesystem

  # Skill catalog operations
  acsync catalog skill list
  acsync catalog skill install frontend-design
  acsync catalog skill search typescript
  acsync catalog skill import ~/.claude/skills/frontend-design
  acsync catalog skill add my-skill --file ./my-skill/SKILL.md

  # After adding to catalog, use with project commands:
  acsync mcp add @modelcontextprotocol/server-github --targets claude
  acsync skill add frontend-design --targets claude,codex
`;

const MCP_HELP = `acsync mcp - Manage MCP servers for the current project

USAGE:
  acsync mcp [subcommand] [options]

SUBCOMMANDS:
  status                  Show MCP status (default)
  add <package>           Add an MCP to the project (from catalog or npm)
  remove <server>         Remove an MCP from the project
  enable <server>         Enable a disabled MCP
  disable <server>        Disable an MCP

OPTIONS:
  --targets <list>    Comma-separated target list (default: claude,codex,gemini)
  --[no-]register      Auto-register to catalog (default: yes)

TARGETS:
  claude     Claude Code (.mcp.json)
  codex      Codex (.codex/config.toml)
  gemini     Gemini CLI (.gemini/settings.json)

EXAMPLES:
  # Show status
  acsync mcp
  acsync mcp status

  # Add from npm package (auto-registers to catalog)
  acsync mcp add @modelcontextprotocol/server-github --targets claude
  acsync mcp add @modelcontextprotocol/server-filesystem --targets claude,codex

  # Add with custom configuration
  acsync mcp add custom-mcp --url "https://mcp.example.com" --targets claude
  acsync mcp add local-mcp --command "node" --args '["server.js"]' --targets claude

  # Enable/disable/remove
  acsync mcp disable github --targets claude
  acsync mcp enable github --targets codex
  acsync mcp remove github

  # Work with catalog
  acsync catalog mcp list              # List catalog entries
  acsync catalog mcp add <package>     # Add to catalog first
`;

const SKILL_HELP = `acsync skill - Manage skills for the current project

USAGE:
  acsync skill [subcommand] [options]

SUBCOMMANDS:
  status                  Show skill status (default)
  add <name>              Add a skill to the project from your catalog
  install <github-url>   Install a skill directly from GitHub URL
  remove <name>           Remove a skill from the project
  enable <name>           Enable a skill (skills are always enabled if present)
  disable <name>          Disable a skill (equivalent to remove)

OPTIONS:
  --targets <list>    Comma-separated target list (default: claude,codex,gemini)
  --[no-]register      Auto-register to catalog (default: yes)

INSTALL OPTIONS (for GitHub install):
  --name <name>             Override skill name from GitHub
  --no-catalog              Don't add to catalog, only install to project

TARGETS:
  claude     Claude Code (.claude/skills/)
  codex      Codex (.codex/skills/)
  gemini     Gemini CLI (.gemini/antigravity/skills/)

COMMAND DIFFERENCES:
  add <name>              Add from your catalog (must exist in catalog first)
  install <github-url>   Install directly from GitHub (adds to catalog + project)

EXAMPLES:
  # Show status
  acsync skill
  acsync skill status

  # Add from catalog (requires catalog entry)
  acsync skill add frontend-design --targets claude
  acsync skill add skill-creator --targets claude,codex

  # Install directly from GitHub (adds to catalog + project)
  acsync skill install https://github.com/anthropics/skills/tree/main/skill-creator
  acsync skill install https://github.com/user/repo --name my-skill --targets claude

  # Install without adding to catalog
  acsync skill install <github-url> --no-catalog --targets claude

  # Remove from project
  acsync skill remove frontend-design

  # Work with catalog
  acsync catalog skill list              # List catalog entries
  acsync catalog skill import <path>     # Import local skill to catalog
  acsync catalog skill search <query>    # Search skills.directory registry
`;

const VALIDATE_HELP = `acsync validate - Validate current project configuration

USAGE:
  acsync validate [options]

OPTIONS:
  --strict      Fail on warnings as well as errors

DESCRIPTION:
  Validates MCP and skill configurations across all target agents.
  Checks for missing files, invalid configurations, and common issues.

EXAMPLES:
  acsync validate              # Show warnings but don't fail
  acsync validate --strict     # Fail on any warnings or errors
`;

const DOCTOR_HELP = `acsync doctor - Run diagnostics and health checks

USAGE:
  acsync doctor [options]

OPTIONS:
  --fix         Attempt to auto-fix issues

DESCRIPTION:
  Runs comprehensive diagnostics on your acsync setup and project configurations.
  Checks catalog integrity, config file validity, and common issues.

EXAMPLES:
  acsync doctor                  # Diagnose issues without fixing
  acsync doctor --fix            # Attempt to auto-fix found issues
`;

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // Top-level help
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(HELP);
    return;
  }

  // Version
  if (argv[0] === '--version' || argv[0] === '-V') {
    const { version } = await getPackageVersion();
    process.stdout.write(`acsync v${version}\n`);
    return;
  }

  const command = argv[0];

  switch (command) {
    case 'init':
      await handleInit(argv.slice(1));
      break;

    case 'catalog':
      await handleCatalog(argv.slice(1));
      break;

    case 'mcp':
      await handleMcp(argv.slice(1));
      break;

    case 'skill':
      await handleSkill(argv.slice(1));
      break;

    case 'validate':
      await handleValidate(argv.slice(1));
      break;

    case 'doctor':
      await handleDoctor(argv.slice(1));
      break;

    default:
      process.stderr.write(`Unknown command: ${command}\n\n`);
      process.stderr.write(HELP);
      process.exitCode = 1;
  }
}

// ============================================================================
// Command Handlers
// ============================================================================

async function handleCatalog(argv: string[]): Promise<void> {
  if (argv.length === 0) {
    // Launch Catalog TUI
    const { CatalogTuiScreen } = await import('./tui/index.js');
    const screen = new CatalogTuiScreen();
    await screen.render({ currentScreen: 'catalog', selectedItem: null, filter: '', target: 'claude', lastAction: null });
    return;
  }

  if (argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(CATALOG_HELP);
    return;
  }

  const resource = argv[0];
  const subcommand = argv[1];
  const args = argv.slice(2);

  if (resource !== 'mcp' && resource !== 'skill') {
    process.stderr.write(`Unknown catalog resource: ${resource}\n`);
    process.stderr.write('Use "acsync catalog mcp" or "acsync catalog skill" for management.\n');
    process.exitCode = 1;
    return;
  }

  if (subcommand === '--help' || subcommand === '-h') {
    process.stdout.write(CATALOG_HELP);
    return;
  }

  switch (resource) {
    case 'mcp':
      await handleCatalogMcp(subcommand, args);
      break;
    case 'skill':
      await handleCatalogSkill(subcommand, args);
      break;
  }
}

async function handleCatalogMcp(subcommand: string | undefined, args: string[]): Promise<void> {
  if (!subcommand) {
    process.stderr.write('Usage: acsync catalog mcp <subcommand>\n');
    process.exitCode = 1;
    return;
  }

  switch (subcommand) {
    case 'list':
      await catalogMcpList();
      break;

    case 'show':
      if (args.length === 0) {
        process.stderr.write('Usage: acsync catalog mcp show <id>\n');
        process.exitCode = 1;
        return;
      }
      await catalogMcpShow(args[0]);
      break;

    case 'add':
      await handleCatalogMcpAdd(args);
      break;

    case 'remove':
      if (args.length === 0) {
        process.stderr.write('Usage: acsync catalog mcp remove <id>\n');
        process.exitCode = 1;
        return;
      }
      await catalogMcpRemove(args[0]);
      break;

    default:
      process.stderr.write(`Unknown subcommand: ${subcommand}\n`);
      process.stderr.write(CATALOG_HELP);
      process.exitCode = 1;
  }
}

async function handleCatalogMcpAdd(argv: string[]): Promise<void> {
  if (argv.length === 0) {
    process.stderr.write('Usage: acsync catalog mcp add <package-id> [options]\n');
    process.exitCode = 1;
    return;
  }

  const packageId = argv[0];
  const options = parseCatalogMcpAddOptions(argv.slice(1));

  await catalogMcpAdd({
    packageId,
    displayName: options.displayName,
    description: options.description,
    command: options.command,
    args: options.args,
    url: options.url,
    cwd: options.cwd,
    env: options.env,
  });
}

async function handleCatalogSkill(subcommand: string | undefined, args: string[]): Promise<void> {
  if (!subcommand) {
    process.stderr.write('Usage: acsync catalog skill <subcommand>\n');
    process.exitCode = 1;
    return;
  }

  switch (subcommand) {
    case 'list':
      await (await import('./cli-catalog.js')).catalogSkillList();
      break;

    case 'show':
      if (args.length === 0) {
        process.stderr.write('Usage: acsync catalog skill show <id>\n');
        process.exitCode = 1;
        return;
      }
      await (await import('./cli-catalog.js')).catalogSkillShow(args[0]);
      break;

    case 'add':
      await handleCatalogSkillAdd(args);
      break;

    case 'install':
      await handleCatalogSkillInstall(args);
      break;

    case 'search':
      if (args.length === 0) {
        process.stderr.write('Usage: acsync catalog skill search <query>\n');
        process.exitCode = 1;
        return;
      }
      await (await import('./cli-catalog.js')).catalogSkillSearch(args[0]);
      break;

    case 'import':
      await handleCatalogSkillImport(args);
      break;

    case 'remove':
      if (args.length === 0) {
        process.stderr.write('Usage: acsync catalog skill remove <id>\n');
        process.exitCode = 1;
        return;
      }
      await (await import('./cli-catalog.js')).catalogSkillRemove(args[0]);
      break;

    default:
      process.stderr.write(`Unknown subcommand: ${subcommand}\n`);
      process.stderr.write(CATALOG_HELP);
      process.exitCode = 1;
  }
}

async function handleCatalogSkillAdd(argv: string[]): Promise<void> {
  if (argv.length === 0) {
    process.stderr.write('Usage: acsync catalog skill add <skill-id> [options]\n');
    process.exitCode = 1;
    return;
  }

  const skillId = argv[0];
  const options = parseCatalogSkillAddOptions(argv.slice(1));

  await (await import('./cli-catalog.js')).catalogSkillAdd({
    skillId,
    file: options.file,
    displayName: options.displayName,
    description: options.description,
  });
}

async function handleCatalogSkillInstall(argv: string[]): Promise<void> {
  if (argv.length === 0) {
    process.stderr.write('Usage: acsync catalog skill install <skill-id> [--force]\n');
    process.exitCode = 1;
    return;
  }

  const skillId = argv[0];
  const force = parseFlag(argv, 'force');

  await (await import('./cli-catalog.js')).catalogSkillInstall({ skillId, force });
}

async function handleCatalogSkillImport(argv: string[]): Promise<void> {
  if (argv.length === 0) {
    process.stderr.write('Usage: acsync catalog skill import <path> [options]\n');
    process.exitCode = 1;
    return;
  }

  const skillPath = argv[0];
  const options = parseCatalogSkillImportOptions(argv.slice(1));

  await (await import('./cli-catalog.js')).catalogSkillImport({
    path: skillPath,
    skillId: options.skillId,
    displayName: options.displayName,
    description: options.description,
  });
}

async function handleMcp(argv: string[]): Promise<void> {
  if (argv.length === 0) {
    // Launch MCP TUI
    const { McpTuiScreen } = await import('./tui/index.js');
    const screen = new McpTuiScreen();
    await screen.render({ currentScreen: 'mcp', selectedItem: null, filter: '', target: 'claude', lastAction: null });
    return;
  }

  if (argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(MCP_HELP);
    return;
  }

  // Check if verbose flag is present
  const verbose = parseFlag(argv, 'verbose', 'v');

  // Remove verbose from argv for further parsing
  const filteredArgs = argv.filter((arg) => arg !== '--verbose' && arg !== '-v');

  const subcommand = filteredArgs[0];

  // Default to status if no subcommand or status
  if (!subcommand || subcommand === 'status') {
    await mcpStatus(verbose);
    return;
  }

  const options = parseMcpOptions(filteredArgs.slice(1), subcommand);

  switch (subcommand) {
    case 'add':
      if (options.packageId === undefined) {
        process.stderr.write('Usage: acsync mcp add <package> [options]\n');
        process.exitCode = 1;
        return;
      }
      await mcpAdd({
        packageId: options.packageId!,
        targets: options.targets,
        noRegister: options.noRegister,
      });
      break;

    case 'remove':
      if (options.packageId === undefined) {
        process.stderr.write('Usage: acsync mcp remove <server> [options]\n');
        process.exitCode = 1;
        return;
      }
      await mcpRemove({
        serverName: options.packageId!,
        targets: options.targets,
      });
      break;

    case 'enable':
      if (options.packageId === undefined) {
        process.stderr.write('Usage: acsync mcp enable <server> [options]\n');
        process.exitCode = 1;
        return;
      }
      await mcpEnable({
        serverName: options.packageId!,
        targets: options.targets,
      });
      break;

    case 'disable':
      if (options.packageId === undefined) {
        process.stderr.write('Usage: acsync mcp disable <server> [options]\n');
        process.exitCode = 1;
        return;
      }
      await mcpDisable({
        serverName: options.packageId!,
        targets: options.targets,
      });
      break;

    default:
      process.stderr.write(`Unknown subcommand: ${subcommand}\n`);
      process.stderr.write(MCP_HELP);
      process.exitCode = 1;
  }
}

async function handleSkill(argv: string[]): Promise<void> {
  if (argv.length === 0) {
    // Launch Skill TUI
    const { SkillTuiScreen } = await import('./tui/index.js');
    const screen = new SkillTuiScreen();
    await screen.render({ currentScreen: 'skill', selectedItem: null, filter: '', target: 'claude', lastAction: null });
    return;
  }

  if (argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(SKILL_HELP);
    return;
  }

  // Check if verbose flag is present
  const verbose = parseFlag(argv, 'verbose', 'v');

  // Remove verbose from argv for further parsing
  const filteredArgs = argv.filter((arg) => arg !== '--verbose' && arg !== '-v');

  const subcommand = filteredArgs[0];

  // Default to status if no subcommand or status
  if (!subcommand || subcommand === 'status') {
    await skillStatus(verbose);
    return;
  }

  const options = parseSkillOptions(filteredArgs.slice(1), subcommand);

  switch (subcommand) {
    case 'add':
      if (options.skillId === undefined) {
        process.stderr.write('Usage: acsync skill add <name> [options]\n');
        process.exitCode = 1;
        return;
      }
      await skillAdd({
        skillId: options.skillId!,
        targets: options.targets,
        noRegister: options.noRegister,
      });
      break;

    case 'install':
      if (options.githubUrl === undefined) {
        process.stderr.write('Usage: acsync skill install <github-url> [options]\n');
        process.exitCode = 1;
        return;
      }
      await (await import('./cli-skill.js')).skillInstallFromGitHub({
        githubUrl: options.githubUrl!,
        skillName: options.skillName,
        targets: options.targets,
        addToCatalog: options.addToCatalog,
      });
      break;

    case 'remove':
      if (options.skillId === undefined) {
        process.stderr.write('Usage: acsync skill remove <name> [options]\n');
        process.exitCode = 1;
        return;
      }
      await skillRemove({
        skillName: options.skillId!,
        targets: options.targets,
      });
      break;

    case 'enable':
      if (options.skillId === undefined) {
        process.stderr.write('Usage: acsync skill enable <name> [options]\n');
        process.exitCode = 1;
        return;
      }
      await skillEnable({
        skillName: options.skillId!,
        targets: options.targets,
      });
      break;

    case 'disable':
      if (options.skillId === undefined) {
        process.stderr.write('Usage: acsync skill disable <name> [options]\n');
        process.exitCode = 1;
        return;
      }
      await skillDisable({
        skillName: options.skillId!,
        targets: options.targets,
      });
      break;

    default:
      process.stderr.write(`Unknown subcommand: ${subcommand}\n`);
      process.stderr.write(SKILL_HELP);
      process.exitCode = 1;
  }
}

async function handleValidate(argv: string[]): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(VALIDATE_HELP);
    return;
  }

  const strict = parseFlag(argv, 'strict');
  await validate({ strict });
}

async function handleDoctor(argv: string[]): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(DOCTOR_HELP);
    return;
  }

  const fix = parseFlag(argv, 'fix');
  await doctor({ fix });
}

// ============================================================================
// Init Command
// ============================================================================

const INIT_HELP = `acsync init - Interactive setup for the current project

USAGE:
  acsync init [options]

OPTIONS:
  --targets <list>    Pre-select targets (e.g., claude,codex)

DESCRIPTION:
  Interactive setup wizard for configuring your project.
  Guides you through selecting MCP servers and skills from your catalog.

EXAMPLES:
  acsync init                        # Full interactive setup
  acsync init --targets claude       # Skip target selection
`;

async function handleInit(argv: string[]): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(INIT_HELP);
    return;
  }

  const options = parseInitOptions(argv);
  await init(options);
}

interface InitOptions {
  targets?: TargetName[];
}

function parseInitOptions(argv: string[]): InitOptions {
  const options: InitOptions = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--targets':
        options.targets = argv[++i].split(',').map(t => t.trim()) as TargetName[];
        break;
      default:
        process.stderr.write(`Unknown option: ${arg}\n`);
        process.stderr.write(INIT_HELP);
        process.exitCode = 1;
        break;
    }
  }

  return options;
}

async function init(options: InitOptions): Promise<void> {
  console.log('🚀 acsync init - Interactive Project Setup\n');

  // Import the interactive init module
  const { runInteractiveInit } = await import('./cli-init.js');
  await runInteractiveInit(options);
}

// ============================================================================
// TUI Command
// ============================================================================

// ============================================================================
// Options Parsing
// ============================================================================

interface McpOptions {
  packageId?: string;
  targets: TargetName[];
  noRegister: boolean;
  verbose?: boolean;
}

function parseMcpOptions(argv: string[], subcommand?: string): McpOptions {
  const options: McpOptions = {
    targets: ['claude', 'codex'], // Default targets
    noRegister: false,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    switch (arg) {
      case '--targets':
        options.targets = parseTargets(argv[++i]);
        break;
      case '--no-register':
        options.noRegister = true;
        break;
      case '--register':
        options.noRegister = false;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      default:
        // Treat as package/server name (except for status subcommand which doesn't need it)
        if (!options.packageId && subcommand !== 'status') {
          options.packageId = arg;
        }
        break;
    }
    i++;
  }

  return options;
}

interface CatalogMcpAddOptions {
  displayName?: string;
  description?: string;
  command?: string;
  args?: string[];
  url?: string;
  cwd?: string;
  env?: Record<string, string>;
}

function parseCatalogMcpAddOptions(argv: string[]): CatalogMcpAddOptions {
  const options: CatalogMcpAddOptions = {};

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    switch (arg) {
      case '--display-name':
        options.displayName = argv[++i];
        break;
      case '--description':
        options.description = argv[++i];
        break;
      case '--command':
        options.command = argv[++i];
        break;
      case '--args':
        options.args = JSON.parse(argv[++i]);
        break;
      case '--url':
        options.url = argv[++i];
        break;
      case '--cwd':
        options.cwd = argv[++i];
        break;
      case '--env':
        options.env = JSON.parse(argv[++i]);
        break;
      default:
        process.stderr.write(`Unknown option: ${arg}\n`);
        process.exitCode = 1;
        break;
    }
    i++;
  }

  return options;
}

interface CatalogSkillAddOptions {
  file?: string;
  displayName?: string;
  description?: string;
}

function parseCatalogSkillAddOptions(argv: string[]): CatalogSkillAddOptions {
  const options: CatalogSkillAddOptions = {};

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    switch (arg) {
      case '--file':
        options.file = argv[++i];
        break;
      case '--display-name':
        options.displayName = argv[++i];
        break;
      case '--description':
        options.description = argv[++i];
        break;
      default:
        process.stderr.write(`Unknown option: ${arg}\n`);
        process.exitCode = 1;
        break;
    }
    i++;
  }

  return options;
}

interface CatalogSkillImportOptions {
  skillId?: string;
  displayName?: string;
  description?: string;
}

function parseCatalogSkillImportOptions(argv: string[]): CatalogSkillImportOptions {
  const options: CatalogSkillImportOptions = {};

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    switch (arg) {
      case '--name':
        options.skillId = argv[++i];
        break;
      case '--display-name':
        options.displayName = argv[++i];
        break;
      case '--description':
        options.description = argv[++i];
        break;
      default:
        process.stderr.write(`Unknown option: ${arg}\n`);
        process.exitCode = 1;
        break;
    }
    i++;
  }

  return options;
}

function parseTargets(input: string): TargetName[] {
  const validTargets: TargetName[] = ['claude', 'codex', 'gemini'];
  const targets = input.split(',').map((t) => t.trim().toLowerCase() as TargetName);

  for (const target of targets) {
    if (!validTargets.includes(target)) {
      process.stderr.write(`Invalid target: ${target}\n`);
      process.stderr.write(`Valid targets: ${validTargets.join(', ')}\n`);
      process.exit(1);
    }
  }

  return targets;
}

interface SkillOptions {
  skillId?: string;
  targets: TargetName[];
  noRegister: boolean;
  verbose?: boolean;
  // GitHub URL install options
  githubUrl?: string;
  skillName?: string;
  addToCatalog?: boolean;
}

function parseSkillOptions(argv: string[], subcommand?: string): SkillOptions {
  const options: SkillOptions = {
    targets: ['claude', 'codex'], // Default targets
    noRegister: false,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    switch (arg) {
      case '--targets':
        options.targets = parseTargets(argv[++i]);
        break;
      case '--no-register':
        options.noRegister = true;
        break;
      case '--register':
        options.noRegister = false;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--from-github':
      case '--github':
        options.githubUrl = argv[++i];
        break;
      case '--name':
        options.skillName = argv[++i];
        break;
      case '--no-catalog':
        options.addToCatalog = false;
        break;
      default:
        // Treat as skill name or GitHub URL (except for status subcommand)
        if (subcommand === 'install' && arg.startsWith('http')) {
          options.githubUrl = arg;
        } else if (!options.skillId && subcommand !== 'status') {
          options.skillId = arg;
        }
        break;
    }
    i++;
  }

  return options;
}

function parseFlag(argv: string[], longName: string, shortName?: string): boolean {
  return argv.includes(`--${longName}`) || (shortName ? argv.includes(`-${shortName}`) : false);
}

// ============================================================================
// Utilities
// ============================================================================

async function getPackageVersion(): Promise<{ version: string }> {
  // Read package.json dynamically to support global installation
  const { readFile } = await import('node:fs/promises');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  const pkgPath = join(__dirname, '..', 'package.json');
  const content = await readFile(pkgPath, 'utf8');
  return JSON.parse(content);
}

// ============================================================================
// Error Handling
// ============================================================================

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
});
