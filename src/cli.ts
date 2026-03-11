#!/usr/bin/env node
import type { TargetName } from './types.js';

// CLI command handlers
import {
  catalogMcpList,
  catalogMcpShow,
  catalogMcpAdd,
  catalogMcpRemove,
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
import { validate, doctor } from './cli-diagnostics.js';

// ============================================================================
// Constants
// ============================================================================

const HELP = `acsync - Agent configuration sync tool

USAGE:
  acsync [COMMAND]

COMMANDS:
  catalog     Manage reusable MCP definitions
  mcp         Manage MCP servers for the current project
  validate    Validate current project configuration
  doctor      Run diagnostics and health checks

OPTIONS:
  -h, --help    Show this help message
  -V, --version Show version information

EXAMPLES:
  acsync mcp status              Show MCP status for current project
  acsync mcp add github --targets codex   Add GitHub MCP to Codex
  acsync catalog mcp list        List all MCPs in local catalog

For more information, run: acsync <command> --help
`;

const CATALOG_HELP = `acsync catalog - Manage reusable MCP definitions

USAGE:
  acsync catalog mcp <subcommand>

SUBCOMMANDS:
  list        List all MCP entries in catalog
  show <id>   Show details of a specific MCP entry
  add <pkg>   Add a new MCP entry to catalog
  remove <id> Remove an MCP entry from catalog

EXAMPLES:
  acsync catalog mcp list
  acsync catalog mcp add @modelcontextprotocol/server-github
  acsync catalog mcp show @modelcontextprotocol/server-github
  acsync catalog mcp remove @modelcontextprotocol/server-github
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

  if (resource !== 'mcp') {
    process.stderr.write(`Unknown catalog resource: ${resource}\n`);
    process.stderr.write('Use "acsync catalog mcp" for MCP management.\n');
    process.exitCode = 1;
    return;
  }

  if (subcommand === '--help' || subcommand === '-h') {
    process.stdout.write(CATALOG_HELP);
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
      if (args.length === 0) {
        process.stderr.write('Usage: acsync catalog mcp add <package-id>\n');
        process.exitCode = 1;
        return;
      }
      await catalogMcpAdd({ packageId: args[0] });
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
