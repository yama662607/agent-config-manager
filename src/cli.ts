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
  catalog     Manage reusable MCP and skill definitions
  mcp         Manage MCP servers for the current project
  skill       Manage skills for the current project
  validate    Validate current project configuration
  doctor      Run diagnostics and health checks

OPTIONS:
  -h, --help    Show this help message
  -V, --version Show version information

EXAMPLES:
  acsync mcp status              Show MCP status for current project
  acsync mcp add github --targets codex   Add GitHub MCP to Codex
  acsync catalog mcp list        List all MCPs in local catalog
  acsync skill add frontend-design --targets claude   Add a skill

For more information, run: acsync <command> --help
`;

const CATALOG_HELP = `acsync catalog - Manage reusable MCP and skill definitions

USAGE:
  acsync catalog <kind> <subcommand>

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
  add <file>        Add a new skill entry to catalog from file
  import <path>    Import a skill from a local directory
  install <id>     Install a skill from skills.directory registry
  search <query>   Search the skills.directory registry
  remove <id>       Remove a skill entry from catalog

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
  --name <name>        Override skill name
  --display-name <name> Display name for the entry
  --description <desc>  Description for the entry

EXAMPLES:
  acsync catalog mcp list
  acsync catalog skill install frontend-design
  acsync catalog skill search typescript
  acsync catalog skill import ~/.claude/skills/frontend-design
  acsync catalog skill add my-skill --file ./skills/my-skill/SKILL.md
`;

const MCP_HELP = `acsync mcp - Manage MCP servers for the current project

USAGE:
  acsync mcp [subcommand] [options]

SUBCOMMANDS:
  status                  Show MCP status (default)
  add <package>           Add an MCP to the project
  remove <server>         Remove an MCP from the project
  enable <server>         Enable a disabled MCP
  disable <server>        Disable an MCP

OPTIONS:
  --targets <list>    Comma-separated target list (e.g., codex,claude)
  --[no-]register      Auto-register to catalog (default: yes)

EXAMPLES:
  acsync mcp
  acsync mcp add @modelcontextprotocol/server-github --targets codex
  acsync mcp disable github --targets claude
  acsync mcp remove github
`;

const SKILL_HELP = `acsync skill - Manage skills for the current project

USAGE:
  acsync skill [subcommand] [options]

SUBCOMMANDS:
  status                  Show skill status (default)
  add <name>              Add a skill to the project (from catalog)
  install <github-url>  Install a skill from a GitHub URL
  remove <name>           Remove a skill from the project
  enable <name>           Enable a disabled skill (no-op for skills)
  disable <name>          Disable a skill (equivalent to remove)

OPTIONS:
  --targets <list>    Comma-separated target list (e.g., codex,claude)
  --[no-]register      Auto-register to catalog (default: yes)

INSTALL OPTIONS:
  --name <name>         Override skill name
  --no-catalog          Don't add to catalog, only install to project

EXAMPLES:
  acsync skill
  acsync skill add frontend-design --targets claude
  acsync skill install https://github.com/anthropics/skills --name frontend-design
  acsync skill install https://github.com/anthropics/skills --targets claude,codex
  acsync skill remove frontend-design
`;

const VALIDATE_HELP = `acsync validate - Validate current project configuration

USAGE:
  acsync validate [options]

OPTIONS:
  --strict      Fail on warnings as well as errors

EXAMPLES:
  acsync validate
  acsync validate --strict
`;

const DOCTOR_HELP = `acsync doctor - Run diagnostics and health checks

USAGE:
  acsync doctor [options]

OPTIONS:
  --fix         Attempt to auto-fix issues

EXAMPLES:
  acsync doctor
  acsync doctor --fix
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
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
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
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
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
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
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
