#!/usr/bin/env node
import type { TargetName } from './types.js';
import { mergeEnvMaps, parseEnvOptionValue } from './mcp-env.js';
import path from 'node:path';

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
  mcpEdit,
  type McpAddOptions,
  type McpRemoveOptions,
  type McpEnableOptions,
  type McpDisableOptions,
  type McpEditOptions,
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
import { scanCommand } from './cli-scan.js';
import { parseTargetList } from './target-utils.js';
import type { McpListFilter, SkillListFilter } from './cli-catalog.js';
import { getDefaultTargets } from './acm-config.js';

// ============================================================================
// Constants
// ============================================================================

const HELP = `acm - Agent configuration sync tool

Usage:
  acm [COMMAND]

Commands:
  init        Interactive setup for the current project
  catalog     Browse and manage catalog (TUI mode) [DEPRECATED: Use "-g" or "--global" instead]
  mcp         Manage MCP servers (TUI mode by default)
  skill       Manage skills (TUI mode by default)
  plugin      Manage plugins (scan, list, install, uninstall)
  scan        Discover skills and MCPs already configured across agents
  validate    Validate current project configuration [DEPRECATED: Use "acm doctor --strict" instead]
  doctor      Run diagnostics and health checks

Scopes (a command acts on exactly one):
  --project           The current directory's config (default)
  -H, --home          The machine-wide config of each agent
  -g, --catalog       The acm catalog itself (aliases: --global)

Options:
  -t, --targets Comma-separated target list (claude, codex, agy, grok; aliases: c, x, a, g, k)
  -H, --home    Target the home directory (global configs), regardless of cwd
  -h, --help    Show this help message
  -V, --version Show version information

Targets:
  claude      Claude Code (.mcp.json, .claude/skills/) (alias: c)
  codex       Codex (.codex/config.toml, .codex/skills/) (alias: x)
  agy         Antigravity CLI (.agents/mcp_config.json, .agents/skills/) (alias: a, g)
  grok        Grok CLI (.grok/config.toml; skills read from the catalog) (alias: k)

EXAMPLES:
  acm init                         Interactive setup for current project
  acm mcp                          Manage MCPs in TUI mode
  acm mcp list                     Show project MCP status
  acm mcp list -g                  List all MCPs in global catalog
  acm mcp add github -t c          Add GitHub MCP to Claude Code
  acm mcp add github -g            Add GitHub MCP to global catalog
  acm skill list -g                List all skills in global catalog
  acm doctor                       Run diagnostics and health checks
`;

const CATALOG_HELP = `acm catalog - Manage reusable MCP and skill definitions [DEPRECATED: Use "-g" or "--global" flags instead]

Usage:
  acm catalog <kind> <subcommand>

ABOUT CATALOG:
  Your personal catalog (~/.acm/catalog.toml) stores reusable MCP servers
  and skills. Once added to the catalog, you can easily add them to any project.

KINDS:
  mcp         Manage MCP definitions
  skill       Manage skill definitions

MCP Subcommands:
  list        List all MCP entries in catalog
  show <id>   Show details of a specific MCP entry
  add <pkg>   Add a new MCP entry to catalog
  remove <id> Remove an MCP entry from catalog

SKILL Subcommands:
  list              List all skill entries in catalog
  show <id>         Show details of a specific skill entry
  add <name>        Add a new skill entry to catalog from file
  import <path>     Import a skill from a local directory
  link <path>       Register a directory in the catalog as a symlink (no copy)
  unlink <id>       Remove a catalog link (never touches real content)
  update [id]       Re-place distributed copies that drifted from the catalog
  meta <id>         Show or edit catalog metadata (deprecated, pinned, tags, source)
  outdated [id]     Check recorded GitHub sources for upstream changes
  install <id>      Install a skill from skills.directory registry
  search <query>    Search the skills.directory registry
  remove <id>        Remove a skill entry from catalog

PUBLISH:
  publish                  Stage the allowlisted subset (PUBLIC.txt) of the catalog
    --allowlist <file>     Use a different allowlist
    --to <repo>            Sync the staged bundle into a git working tree
    --commit               Commit in the destination (never pushes)
    --dry-run              Report what would be synced

  Publishing is opt-in: only entries listed in the allowlist are staged, and the
  bundle is refused if it contains secrets or personal paths.
`;

const MCP_HELP = `acm mcp - Manage MCP servers for the current project or global catalog

Usage:
  acm mcp [subcommand] [options]

Subcommands:
  list, status            Show MCP status (default)
  add <package>           Add an MCP to the project or catalog
  edit <server>           Edit an MCP in the project
  update [server]         Re-apply catalog recipes where the config differs
  adopt [server] -t <t>   Copy a target's configuration back into the catalog
  remove <server>         Remove an MCP from the project or catalog
  enable <server>         Enable a disabled MCP
  disable <server>        Disable an MCP
  show <server>           Show details of an MCP server

Options:
  -g, --global        Operate on the global catalog (~/.acm/)
  -t, --targets <l>   Comma-separated target list (default: claude,codex,agy; aliases: c,x,a,g)
  --[no-]register     Auto-register to catalog (default: yes)
  --url <url>         HTTP/SSE URL for custom MCP add/edit
  --command <cmd>     Command for custom stdio MCP add/edit
  --args <json>       Arguments for command (JSON array)
  --cwd <path>        Working directory for command
  --env <json|KEY=V>  Environment variables, repeatable
  -H, --home          Target the home directory (global configs), regardless of cwd

EXAMPLES:
  # Show project MCP status
  acm mcp list
  
  # List all MCPs in global catalog
  acm mcp list -g

  # Add from npm package to Claude Code
  acm mcp add @modelcontextprotocol/server-github -t c
  
  # Register npm package directly to global catalog
  acm mcp add @modelcontextprotocol/server-filesystem -g

  # Remove from project
  acm mcp remove github
  
  # Remove from global catalog
  acm mcp remove github -g
`;

const SKILL_HELP = `acm skill - Manage skills for the current project or global catalog

Usage:
  acm skill [subcommand] [options]

Subcommands:
  list, status            Show skill status (default)
  add <name>              Add a skill to the project from catalog
  install <github-url>    Install a skill directly from GitHub
  import <path>           Import a skill from local directory
  search <query>          Search skills.directory registry
  remove <name>           Remove a skill from the project or catalog
  enable <name>           Enable a skill (skills are always enabled if present)
  disable <name>          Disable a skill (equivalent to remove)
  show <name>             Show details of a skill entry

Options:
  -g, --global        Operate on the global catalog (~/.acm/)
  -t, --targets <l>   Comma-separated target list (default: claude,codex,agy; aliases: c,x,a,g)
  --[no-]register     Auto-register to catalog (default: yes)
  -H, --home          Target the home directory (global configs), regardless of cwd
  --name <name>       Override skill name from GitHub or import
  --no-catalog        Don't add to catalog, only install to project
  --file <path>       MD file path to register skill to catalog

  Catalog Filter Options (with -g/--global):
  --plugin <name>     Filter by plugin name (e.g., vercel, slack, zoom)
  --agent <name>      Filter by agent (claude, codex, antigravity, grok)
  --source-type <t>   Filter by source type (user, plugin, curated, system, bundled)
  --category <cat>    Filter by category (ai-ml, cloud-platform, communication, etc.)
  --search <text>     Free-text search in name/description
  --pinned            Show only pinned (favorite) skills
  --deprecated        Show only deprecated skills

EXAMPLES:
  # Show project skill status
  acm skill list
  
  # List all skills in global catalog
  acm skill list -g

  # Add from catalog to Claude Code
  acm skill add frontend-design -t c

  # Install directly from GitHub (adds to catalog + project)
  acm skill install https://github.com/anthropics/skills/tree/main/skill-creator
  
  # Import local skill to global catalog
  acm skill import ./my-skill -g
`;

const PLUGIN_HELP = `acm plugin - Manage plugins across Claude Code, Codex, and Antigravity

Usage:
  acm plugin <subcommand> [options]

Subcommands:
  scan                    Discover available plugins across all agents
  scan --diff             Compare with last snapshot (read-only)
  snapshot                Save current scan state for future --diff
  list                    List installed plugins
  show <name>             Show plugin details (skills, MCPs, agents, etc.)
  install <name>          Install a plugin (skills + MCPs + agents + knowledge)
  uninstall <name>        Uninstall a plugin
  doctor                  Check for orphan/unregistered plugins

Install Options:
  --target <agent>        Install for specific agent (claude, codex, antigravity, grok, all)
                          Default: claude. Aliases: c, x, a, g, agy

Uninstall Options:
  --target <agent>        Uninstall from specific agent (default: all)
  --keep-skills           Keep skills when uninstalling

EXAMPLES:
  acm plugin scan                      # Discover all available plugins
  acm plugin list                      # List installed plugins
  acm plugin show vercel               # Show plugin details
  acm plugin install vercel            # Install to Claude
  acm plugin install vercel --target all  # Install to all agents
  acm plugin uninstall vercel          # Uninstall (removes skills too)
  acm plugin uninstall vercel --keep-skills  # Uninstall but keep skills
`;

const VALIDATE_HELP = `acm validate - Validate current project configuration [DEPRECATED: Use "acm doctor --strict" instead]

Usage:
  acm validate [options]

Options:
  --strict      Fail on warnings as well as errors
`;

const DOCTOR_HELP = `acm doctor - Run diagnostics and health checks

Usage:
  acm doctor [options]

Options:
  --fix               Attempt to auto-fix issues
  --strict            Fail on warnings as well as errors (strictly validate)
  -H, --allow-home    Allow operations in the home directory

DESCRIPTION:
  Runs comprehensive diagnostics on your acm setup and project configurations.
  Checks catalog integrity, config file validity, and common issues.
  Acts as both validation tool and interactive fixer.

EXAMPLES:
  acm doctor                  # Diagnose issues without fixing
  acm doctor --fix            # Attempt to auto-fix found issues
  acm doctor --strict         # Fail on any warnings or errors (useful for CI)
  acm doctor --allow-home     # Allow diagnostics in the home directory
`;

// ============================================================================
// Main
// ============================================================================

/**
 * Check if the current environment is interactive (TTY and not CI).
 */
function isInteractive(): boolean {
  return (
    process.stdout.isTTY &&
    !process.env.CI &&
    process.env.NODE_ENV !== 'test'
  );
}

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
    process.stdout.write(`acm v${version}\n`);
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

    case 'plugin':
      await handlePlugin(argv.slice(1));
      break;

    case 'validate':
      await handleValidate(argv.slice(1));
      break;

    case 'doctor':
      await handleDoctor(argv.slice(1));
      break;

    case 'scan':
      await scanCommand(argv.slice(1));
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
  const [resourceArg, subcommandArg] = argv;
  const replacement =
    resourceArg && subcommandArg
      ? `acm ${resourceArg} ${subcommandArg} -g`
      : 'acm skill -g / acm mcp -g';
  process.stderr.write(
    `[DEPRECATED] "acm catalog" is deprecated. Use \`${replacement}\` instead.\n\n`
  );
  if (argv.length === 0) {
    // Check if we can run TUI
    if (!isInteractive()) {
      process.stdout.write(CATALOG_HELP);
      return;
    }

    // Launch Catalog TUI
    const { launchCatalogTui } = await import('./tui-launcher.js');
    await launchCatalogTui();
    return;
  }

  if (argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(CATALOG_HELP);
    return;
  }

  const resource = argv[0];
  const subcommand = argv[1];
  const args = argv.slice(2);

  if (resource === 'publish') {
    const publishArgs = argv.slice(1);
    const valueOf = (flag: string): string | undefined => {
      const i = publishArgs.indexOf(flag);
      return i >= 0 && i + 1 < publishArgs.length ? publishArgs[i + 1] : undefined;
    };
    const { catalogPublish } = await import('./cli-publish.js');
    await catalogPublish({
      allowlist: valueOf('--allowlist'),
      to: valueOf('--to'),
      commit: publishArgs.includes('--commit'),
      dryRun: publishArgs.includes('--dry-run'),
    });
    return;
  }

  if (resource !== 'mcp' && resource !== 'skill') {
    process.stderr.write(`Unknown catalog resource: ${resource}\n`);
    process.stderr.write('Use "acm catalog mcp", "acm catalog skill" or "acm catalog publish".\n');
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
    process.stderr.write('Usage: acm catalog mcp <subcommand>\n');
    process.exitCode = 1;
    return;
  }

  switch (subcommand) {
    case 'list': {
      const filter = parseMcpListFilter(args);
      await catalogMcpList(Object.keys(filter).length > 0 ? filter : undefined);
      break;
    }

    case 'show':
      if (args.length === 0) {
        process.stderr.write('Usage: acm catalog mcp show <id>\n');
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
        process.stderr.write('Usage: acm catalog mcp remove <id>\n');
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
    process.stderr.write('Usage: acm catalog mcp add <package-id> [options]\n');
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
    process.stderr.write('Usage: acm catalog skill <subcommand>\n');
    process.exitCode = 1;
    return;
  }

  switch (subcommand) {
    case 'list': {
      const filter = parseSkillListFilter(args);
      await (await import('./cli-catalog.js')).catalogSkillList(Object.keys(filter).length > 0 ? filter : undefined);
      break;
    }

    case 'show':
      if (args.length === 0) {
        process.stderr.write('Usage: acm catalog skill show <id>\n');
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
        process.stderr.write('Usage: acm catalog skill search <query>\n');
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
        process.stderr.write('Usage: acm catalog skill remove <id>\n');
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
    process.stderr.write('Usage: acm catalog skill add <skill-id> [options]\n');
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
    process.stderr.write('Usage: acm catalog skill install <skill-id> [--force]\n');
    process.exitCode = 1;
    return;
  }

  const skillId = argv[0];
  const force = parseFlag(argv, 'force');

  await (await import('./cli-catalog.js')).catalogSkillInstall({ skillId, force });
}

async function handleCatalogSkillImport(argv: string[]): Promise<void> {
  if (argv.length === 0) {
    process.stderr.write('Usage: acm catalog skill import <path> [options]\n');
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
  // Robust argument parser for top-level flags (avoids parameter value leakages)
  let isGlobal = false;
  let allowHome = false;
  let verbose = false;
  let json = false;
  const filteredArgs: string[] = [];

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '-g' || arg === '--global' || arg === '--catalog') {
      isGlobal = true;
      i++;
    } else if (arg === '-H' || arg === '--allow-home' || arg === '--allowHome' || arg === '--home') {
      allowHome = true;
      i++;
    } else if (arg === '--project') {
      // Explicit form of the default scope; accepted so the three scopes can be
      // named symmetrically.
      allowHome = false;
      i++;
    } else if (arg === '-v' || arg === '--verbose') {
      verbose = true;
      i++;
    } else if (arg === '--json') {
      json = true;
      i++;
    } else if (['--command', '--args', '--url', '--cwd', '--env', '--targets', '-t', '--file', '--display-name', '--description', '--name', '--category', '--language', '--popularity', '--source-type', '--search', '--source'].includes(arg)) {
      filteredArgs.push(arg);
      if (i + 1 < argv.length) {
        filteredArgs.push(argv[++i]);
      }
      i++;
    } else if (['--pinned', '--deprecated'].includes(arg)) {
      filteredArgs.push(arg);
      i++;
    } else {
      filteredArgs.push(arg);
      i++;
    }
  }

  if (filteredArgs.length === 0) {
    if (isGlobal) {
      if (!isInteractive()) {
        const { catalogMcpList } = await import('./cli-catalog.js');
        await catalogMcpList();
        return;
      }
      const { launchCatalogTui } = await import('./tui-launcher.js');
      await launchCatalogTui();
      return;
    }

    // Check if we can run TUI
    if (!isInteractive()) {
      await mcpStatus(verbose, allowHome, json);
      return;
    }

    // Launch MCP TUI
    const { launchMcpTui } = await import('./tui-launcher.js');
    await launchMcpTui({ allowHome });
    return;
  }

  if (filteredArgs[0] === '--help' || filteredArgs[0] === '-h') {
    process.stdout.write(MCP_HELP);
    return;
  }

  const subcommand = filteredArgs[0];

  // Default to status if no subcommand or status
  if (!subcommand || subcommand === 'status' || subcommand === 'list') {
    if (isGlobal) {
      const { catalogMcpList } = await import('./cli-catalog.js');
      const filter = parseMcpListFilter(filteredArgs.slice(1));
      await catalogMcpList(Object.keys(filter).length > 0 ? filter : undefined);
    } else {
      await mcpStatus(verbose, allowHome, json);
    }
    return;
  }

  const options = parseMcpOptions(filteredArgs.slice(1), subcommand);

  switch (subcommand) {
    case 'add':
      if (options.packageId === undefined) {
        process.stderr.write('Usage: acm mcp add <package> [options]\n');
        process.exitCode = 1;
        return;
      }
      if (isGlobal) {
        const { catalogMcpAdd } = await import('./cli-catalog.js');
        await catalogMcpAdd({
          packageId: options.packageId!,
          url: options.url,
          command: options.command,
          args: options.args,
          cwd: options.cwd,
          env: options.env,
          displayName: options.displayName,
          description: options.description,
        });
      } else {
        await mcpAdd({
          packageId: options.packageId!,
          targets: options.targets,
          noRegister: options.noRegister,
          recipe: buildRecipeFromMcpOptions(options),
          allowHome,
        });
      }
      break;

    case 'show':
      if (options.packageId === undefined) {
        process.stderr.write('Usage: acm mcp show <id>\n');
        process.exitCode = 1;
        return;
      }
      const { catalogMcpShow } = await import('./cli-catalog.js');
      await catalogMcpShow(options.packageId!);
      break;

    case 'adopt': {
      const { mcpAdopt } = await import('./cli-mcp.js');
      if (options.targets.length !== 1) {
        process.stderr.write('Usage: acm mcp adopt [server] -t <one-target>\n');
        process.stderr.write('Adopting takes one target as correct, so exactly one is required.\n');
        process.exitCode = 1;
        return;
      }
      await mcpAdopt({ serverName: options.packageId, from: options.targets[0], allowHome });
      break;
    }

    case 'update': {
      const { mcpUpdate } = await import('./cli-mcp.js');
      await mcpUpdate({
        serverName: options.packageId,
        targets: options.targets,
        allowHome,
      });
      break;
    }

    case 'edit':
      if (options.packageId === undefined) {
        process.stderr.write('Usage: acm mcp edit <server> [options]\n');
        process.exitCode = 1;
        return;
      }
      if (isGlobal) {
        process.stderr.write('Global catalog MCP edit is not supported directly. Please edit catalog.toml manually or use catalog mcp add to overwrite.\n');
        process.exitCode = 1;
        return;
      }
      await mcpEdit({
        serverName: options.packageId!,
        targets: options.targets,
        recipe: buildRecipeFromMcpOptions(options) ?? {},
        allowHome,
      });
      break;

    case 'remove':
      if (options.packageId === undefined) {
        process.stderr.write('Usage: acm mcp remove <server> [options]\n');
        process.exitCode = 1;
        return;
      }
      if (isGlobal) {
        const { catalogMcpRemove } = await import('./cli-catalog.js');
        await catalogMcpRemove(options.packageId!);
      } else {
        await mcpRemove({
          serverName: options.packageId!,
          targets: options.targets,
          allowHome,
        });
      }
      break;

    case 'enable':
      if (options.packageId === undefined) {
        process.stderr.write('Usage: acm mcp enable <server> [options]\n');
        process.exitCode = 1;
        return;
      }
      if (isGlobal) {
        process.stderr.write('Enable command is not applicable for global catalog.\n');
        process.exitCode = 1;
        return;
      }
      await mcpEnable({
        serverName: options.packageId!,
        targets: options.targets,
        allowHome,
      });
      break;

    case 'disable':
      if (options.packageId === undefined) {
        process.stderr.write('Usage: acm mcp disable <server> [options]\n');
        process.exitCode = 1;
        return;
      }
      if (isGlobal) {
        process.stderr.write('Disable command is not applicable for global catalog.\n');
        process.exitCode = 1;
        return;
      }
      await mcpDisable({
        serverName: options.packageId!,
        targets: options.targets,
        allowHome,
      });
      break;

    default:
      process.stderr.write(`Unknown subcommand: ${subcommand}\n`);
      process.stderr.write(MCP_HELP);
      process.exitCode = 1;
  }
}

async function handleSkill(argv: string[]): Promise<void> {
  // Robust argument parser for top-level flags (avoids parameter value leakages)
  let isGlobal = false;
  let allowHome = false;
  let verbose = false;
  let json = false;
  const filteredArgs: string[] = [];

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '-g' || arg === '--global' || arg === '--catalog') {
      isGlobal = true;
      i++;
    } else if (arg === '-H' || arg === '--allow-home' || arg === '--allowHome' || arg === '--home') {
      allowHome = true;
      i++;
    } else if (arg === '--project') {
      // Explicit form of the default scope; accepted so the three scopes can be
      // named symmetrically.
      allowHome = false;
      i++;
    } else if (arg === '-v' || arg === '--verbose') {
      verbose = true;
      i++;
    } else if (arg === '--json') {
      json = true;
      i++;
    } else if (['--command', '--args', '--url', '--cwd', '--env', '--targets', '-t', '--file', '--display-name', '--description', '--name', '--plugin', '--agent', '--source-type', '--category', '--search'].includes(arg)) {
      filteredArgs.push(arg);
      if (i + 1 < argv.length) {
        filteredArgs.push(argv[++i]);
      }
      i++;
    } else if (['--pinned', '--deprecated'].includes(arg)) {
      filteredArgs.push(arg);
      i++;
    } else {
      filteredArgs.push(arg);
      i++;
    }
  }

  if (filteredArgs.length === 0) {
    if (isGlobal) {
      if (!isInteractive()) {
        const { catalogSkillList } = await import('./cli-catalog.js');
        await catalogSkillList();
        return;
      }
      const { launchCatalogTui } = await import('./tui-launcher.js');
      await launchCatalogTui();
      return;
    }

    // Check if we can run TUI
    if (!isInteractive()) {
      await skillStatus(verbose, allowHome, json);
      return;
    }

    // Launch Skill TUI
    const { launchSkillTui } = await import('./tui-launcher.js');
    await launchSkillTui({ allowHome });
    return;
  }

  if (filteredArgs[0] === '--help' || filteredArgs[0] === '-h') {
    process.stdout.write(SKILL_HELP);
    return;
  }

  const subcommand = filteredArgs[0];

  // Default to status if no subcommand or status
  if (!subcommand || subcommand === 'status' || subcommand === 'list') {
    if (isGlobal) {
      const { catalogSkillList } = await import('./cli-catalog.js');
      const filter = parseSkillListFilter(filteredArgs.slice(1));
      await catalogSkillList(Object.keys(filter).length > 0 ? filter : undefined);
    } else {
      await skillStatus(verbose, allowHome, json);
    }
    return;
  }

  const options = parseSkillOptions(filteredArgs.slice(1), subcommand);

  switch (subcommand) {
    case 'add':
      if (options.skillId === undefined) {
        process.stderr.write('Usage: acm skill add <name> [options]\n');
        process.exitCode = 1;
        return;
      }
      if (isGlobal) {
        const { catalogSkillAdd } = await import('./cli-catalog.js');
        await catalogSkillAdd({
          skillId: options.skillId!,
          file: options.file,
          displayName: options.displayName,
          description: options.description,
        });
      } else {
        await skillAdd({
          skillId: options.skillId!,
          targets: options.targets,
          noRegister: options.noRegister,
          allowHome,
          placement: options.placement,
        });
      }
      break;

    case 'show':
      if (options.skillId === undefined) {
        process.stderr.write('Usage: acm skill show <name>\n');
        process.exitCode = 1;
        return;
      }
      const { catalogSkillShow } = await import('./cli-catalog.js');
      await catalogSkillShow(options.skillId!);
      break;

    case 'install':
      if (isGlobal) {
        if (options.skillId === undefined) {
          process.stderr.write('Usage: acm skill install <skill-id> -g [--force]\n');
          process.exitCode = 1;
          return;
        }
        const { catalogSkillInstall } = await import('./cli-catalog.js');
        await catalogSkillInstall({
          skillId: options.skillId!,
          force: options.force,
        });
      } else {
        const githubUrl = options.githubUrl || options.skillId;
        if (githubUrl === undefined || !githubUrl.startsWith('http')) {
          process.stderr.write('Usage: acm skill install <github-url> [options] or acm skill install <skill-id> -g [--force]\n');
          process.exitCode = 1;
          return;
        }
        await (await import('./cli-skill.js')).skillInstallFromGitHub({
          githubUrl: githubUrl,
          skillName: options.skillName,
          targets: options.targets,
          addToCatalog: options.addToCatalog,
          allowHome,
          placement: options.placement,
        });
      }
      break;

    case 'outdated': {
      const { skillOutdated } = await import('./cli-skill.js');
      await skillOutdated({ skillName: options.skillId, json, all: options.all });
      break;
    }

    case 'meta': {
      if (options.skillId === undefined) {
        process.stderr.write(
          'Usage: acm skill meta <id> [--deprecated|--no-deprecated] [--pin|--unpin] [--tags a,b] [--category <c>]\n'
        );
        process.exitCode = 1;
        return;
      }
      const { skillMeta } = await import('./cli-skill.js');
      await skillMeta({
        skillId: options.skillId,
        deprecated: options.deprecated,
        pinned: options.pinned,
        tags: options.tags,
        category: options.category,
        source: options.source,
        ref: options.ref,
        forked: options.forked,
      });
      break;
    }

    case 'link': {
      if (options.skillId === undefined) {
        process.stderr.write('Usage: acm skill link <path> [--as <id>]\n');
        process.exitCode = 1;
        return;
      }
      const { skillLink } = await import('./cli-skill.js');
      await skillLink({ sourcePath: options.skillId, skillId: options.skillName });
      break;
    }

    case 'unlink': {
      if (options.skillId === undefined) {
        process.stderr.write('Usage: acm skill unlink <id>\n');
        process.exitCode = 1;
        return;
      }
      const { skillUnlink } = await import('./cli-skill.js');
      await skillUnlink(options.skillId);
      break;
    }

    case 'update': {
      const { skillUpdate } = await import('./cli-skill.js');
      await skillUpdate({
        skillName: options.skillId,
        targets: options.targets,
        allowHome,
        placement: options.placement,
      });
      break;
    }

    case 'import':
      if (options.skillId === undefined) {
        process.stderr.write('Usage: acm skill import <path> [options]\n');
        process.exitCode = 1;
        return;
      }
      if (isGlobal) {
        const { catalogSkillImport } = await import('./cli-catalog.js');
        await catalogSkillImport({
          path: options.skillId!,
          skillId: options.skillName,
          displayName: options.displayName,
          description: options.description,
        });
      } else {
        // Local project import: import to catalog first, then add to project
        const { catalogSkillImport } = await import('./cli-catalog.js');
        await catalogSkillImport({
          path: options.skillId!,
          skillId: options.skillName,
          displayName: options.displayName,
          description: options.description,
        });
        const skillName = options.skillName || path.basename(options.skillId!) || 'imported-skill';
        await skillAdd({
          skillId: skillName,
          targets: options.targets,
          noRegister: true,
          allowHome,
          placement: options.placement,
        });
      }
      break;

    case 'search':
      if (options.skillId === undefined) {
        process.stderr.write('Usage: acm skill search <query>\n');
        process.exitCode = 1;
        return;
      }
      const { catalogSkillSearch } = await import('./cli-catalog.js');
      await catalogSkillSearch(options.skillId!);
      break;

    case 'remove':
      if (options.skillId === undefined) {
        process.stderr.write('Usage: acm skill remove <name> [options]\n');
        process.exitCode = 1;
        return;
      }
      if (isGlobal) {
        const { catalogSkillRemove } = await import('./cli-catalog.js');
        await catalogSkillRemove(options.skillId!);
      } else {
        await skillRemove({
          skillName: options.skillId!,
          targets: options.targets,
          allowHome,
        });
      }
      break;

    case 'enable':
      if (options.skillId === undefined) {
        process.stderr.write('Usage: acm skill enable <name> [options]\n');
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
        process.stderr.write('Usage: acm skill disable <name> [options]\n');
        process.exitCode = 1;
        return;
      }
      await skillDisable({
        skillName: options.skillId!,
        targets: options.targets,
        allowHome,
      });
      break;

    default:
      process.stderr.write(`Unknown subcommand: ${subcommand}\n`);
      process.stderr.write(SKILL_HELP);
      process.exitCode = 1;
  }
}

async function handleValidate(argv: string[]): Promise<void> {
  process.stderr.write('[DEPRECATED] "acm validate" is deprecated. Please use "acm doctor --strict" instead.\n\n');
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(VALIDATE_HELP);
    return;
  }

  const strict = parseFlag(argv, 'strict');
  await validate({ strict });
}

async function handlePlugin(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(PLUGIN_HELP);
    return;
  }

  const subcommand = argv[0];
  const args = argv.slice(1);

  switch (subcommand) {
    case 'scan':
      await (await import('./cli-plugin.js')).pluginScan(args);
      break;

    case 'snapshot':
      await (await import('./cli-plugin.js')).pluginSnapshot();
      break;

    case 'list':
      await (await import('./cli-plugin.js')).pluginList();
      break;

    case 'show':
      if (args.length === 0) {
        process.stderr.write('Usage: acm plugin show <name>\n');
        process.exitCode = 1;
        return;
      }
      await (await import('./cli-plugin.js')).pluginShow(args[0]);
      break;

    case 'install':
      if (args.length === 0) {
        process.stderr.write('Usage: acm plugin install <name> [--target <agent>]\n');
        process.exitCode = 1;
        return;
      }
      await (await import('./cli-plugin.js')).pluginInstall(args[0], args.slice(1));
      break;

    case 'uninstall':
      if (args.length === 0) {
        process.stderr.write('Usage: acm plugin uninstall <name> [--keep-skills]\n');
        process.exitCode = 1;
        return;
      }
      await (await import('./cli-plugin.js')).pluginUninstall(args[0], args.slice(1));
      break;

    case 'doctor':
      await (await import('./cli-plugin.js')).pluginDoctor();
      break;

    default:
      process.stderr.write(`Unknown subcommand: ${subcommand}\n`);
      process.stderr.write(PLUGIN_HELP);
      process.exitCode = 1;
  }
}

async function handleDoctor(argv: string[]): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(DOCTOR_HELP);
    return;
  }

  const fix = parseFlag(argv, 'fix');
  const strict = parseFlag(argv, 'strict');
  const allowHome = parseFlag(argv, 'allow-home', 'H') || parseFlag(argv, 'allowHome');
  await doctor({ fix, strict, allowHome });
}

// ============================================================================
// Init Command
// ============================================================================

const INIT_HELP = `acm init - Interactive setup for the current project

Usage:
  acm init [options]

Options:
  --targets <list>    Pre-select targets (e.g., claude,codex)

DESCRIPTION:
  Interactive setup wizard for configuring your project.
  Guides you through selecting MCP servers and skills from your catalog.

EXAMPLES:
  acm init                        # Full interactive setup
  acm init --targets claude       # Skip target selection
`;

async function handleInit(argv: string[]): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(INIT_HELP);
    return;
  }

  // Check if we can run interactive init
  if (!isInteractive()) {
    process.stderr.write('Error: Interactive init is not supported in non-TTY or CI environments.\n');
    process.stderr.write('Use explicit commands like "acm mcp add" and "acm skill add" instead.\n');
    process.exitCode = 1;
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
        options.targets = nextVal(argv, i, arg).split(',').map(t => t.trim()) as TargetName[];
        i++;
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
  console.log('🚀 acm init - Interactive Project Setup\n');

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
  /** Machine-readable output for scripting. */
  json?: boolean;
  command?: string;
  args?: string[];
  url?: string;
  cwd?: string;
  env?: Record<string, string>;
  displayName?: string;
  description?: string;
}

function parseMcpOptions(argv: string[], subcommand?: string): McpOptions {
  const options: McpOptions = {
    targets: resolveDefaultTargets(),
    noRegister: false,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    switch (arg) {
      case '--targets':
      case '-t':
        options.targets = parseTargets(nextVal(argv, i, arg));
        i++;
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
      case '--json':
        options.json = true;
        break;
      case '--command':
        options.command = nextVal(argv, i, arg);
        i++;
        break;
      case '--args':
        options.args = JSON.parse(nextVal(argv, i, arg));
        i++;
        break;
      case '--url':
        options.url = nextVal(argv, i, arg);
        i++;
        break;
      case '--cwd':
        options.cwd = nextVal(argv, i, arg);
        i++;
        break;
      case '--env':
        options.env = mergeEnvMaps(options.env, parseEnvOptionValue(nextVal(argv, i, arg)));
        i++;
        break;
      case '--display-name':
        options.displayName = nextVal(argv, i, arg);
        i++;
        break;
      case '--description':
        options.description = nextVal(argv, i, arg);
        i++;
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
        options.displayName = nextVal(argv, i, arg);
        i++;
        break;
      case '--description':
        options.description = nextVal(argv, i, arg);
        i++;
        break;
      case '--command':
        options.command = nextVal(argv, i, arg);
        i++;
        break;
      case '--args':
        options.args = JSON.parse(nextVal(argv, i, arg));
        i++;
        break;
      case '--url':
        options.url = nextVal(argv, i, arg);
        i++;
        break;
      case '--cwd':
        options.cwd = nextVal(argv, i, arg);
        i++;
        break;
      case '--env':
        options.env = mergeEnvMaps(options.env, parseEnvOptionValue(nextVal(argv, i, arg)));
        i++;
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

function buildRecipeFromMcpOptions(options: McpOptions): McpAddOptions['recipe'] | McpEditOptions['recipe'] | undefined {
  const recipe: NonNullable<McpAddOptions['recipe']> = {};

  if (options.url) recipe.url = options.url;
  if (options.command) recipe.command = options.command;
  if (options.args) recipe.args = options.args;
  if (options.cwd) recipe.cwd = options.cwd;
  if (options.env && Object.keys(options.env).length > 0) recipe.env = options.env;

  return Object.keys(recipe).length > 0 ? recipe : undefined;
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
        options.file = nextVal(argv, i, arg);
        i++;
        break;
      case '--display-name':
        options.displayName = nextVal(argv, i, arg);
        i++;
        break;
      case '--description':
        options.description = nextVal(argv, i, arg);
        i++;
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
        options.skillId = nextVal(argv, i, arg);
        i++;
        break;
      case '--display-name':
        options.displayName = nextVal(argv, i, arg);
        i++;
        break;
      case '--description':
        options.description = nextVal(argv, i, arg);
        i++;
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

/** Built-in default, overridable with `default_targets` in config.toml. */
function resolveDefaultTargets(): TargetName[] {
  const configured = getDefaultTargets();
  if (!configured) return ['claude', 'codex'];

  try {
    return parseTargetList(configured.join(','));
  } catch {
    process.stderr.write('Ignoring invalid default_targets in config.toml\n');
    return ['claude', 'codex'];
  }
}

function parseTargets(input: string): TargetName[] {
  let targets: TargetName[];
  try {
    targets = parseTargetList(input);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }

  return targets;
}

interface SkillOptions {
  skillId?: string;
  targets: TargetName[];
  noRegister: boolean;
  verbose?: boolean;
  /** Machine-readable output for scripting. */
  json?: boolean;
  /** Placement override for installed skill directories. */
  placement?: 'link' | 'copy';
  deprecated?: boolean;
  pinned?: boolean;
  tags?: string[];
  category?: string;
  source?: string;
  ref?: string;
  forked?: boolean;
  all?: boolean;
  // GitHub URL install options
  githubUrl?: string;
  skillName?: string;
  addToCatalog?: boolean;
  // Global catalog skill options
  file?: string;
  displayName?: string;
  description?: string;
  force?: boolean;
}

function parseSkillOptions(argv: string[], subcommand?: string): SkillOptions {
  const options: SkillOptions = {
    targets: resolveDefaultTargets(),
    noRegister: false,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    switch (arg) {
      case '--targets':
      case '-t':
        options.targets = parseTargets(nextVal(argv, i, arg));
        i++;
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
      case '--json':
        options.json = true;
        break;
      case '--as':
        options.skillName = nextVal(argv, i, arg);
        i++;
        break;
      case '--deprecated':
        options.deprecated = true;
        break;
      case '--no-deprecated':
        options.deprecated = false;
        break;
      case '--pin':
        options.pinned = true;
        break;
      case '--unpin':
        options.pinned = false;
        break;
      case '--tags':
        options.tags = nextVal(argv, i, arg).split(',').map((t) => t.trim()).filter(Boolean);
        i++;
        break;
      case '--category':
        options.category = nextVal(argv, i, arg);
        i++;
        break;
      case '--source':
        options.source = nextVal(argv, i, arg);
        i++;
        break;
      case '--ref':
        options.ref = nextVal(argv, i, arg);
        i++;
        break;
      case '--forked':
        options.forked = true;
        break;
      case '--no-forked':
        options.forked = false;
        break;
      case '--all':
        options.all = true;
        break;
      case '--link':
        options.placement = 'link';
        break;
      case '--copy':
        options.placement = 'copy';
        break;
      case '--from-github':
      case '--github':
        options.githubUrl = nextVal(argv, i, arg);
        i++;
        break;
      case '--name':
        options.skillName = nextVal(argv, i, arg);
        i++;
        break;
      case '--no-catalog':
        options.addToCatalog = false;
        break;
      case '--file':
        options.file = nextVal(argv, i, arg);
        i++;
        break;
      case '--display-name':
        options.displayName = nextVal(argv, i, arg);
        i++;
        break;
      case '--description':
        options.description = nextVal(argv, i, arg);
        i++;
        break;
      case '--force':
        options.force = true;
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

function parseSkillListFilter(argv: string[]): SkillListFilter {
  // Typed so a flag that no filter implements cannot be parsed silently.
  const filter: SkillListFilter = {};
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--plugin':      filter.plugin = nextVal(argv, i++, '--plugin'); break;
      case '--agent':       filter.agent = nextVal(argv, i++, '--agent'); break;
      case '--source-type': filter.sourceType = nextVal(argv, i++, '--source-type'); break;
      case '--category':    filter.category = nextVal(argv, i++, '--category'); break;
      case '--search':      filter.search = nextVal(argv, i++, '--search'); break;
      case '--source':      filter.source = nextVal(argv, i++, '--source'); break;
      case '--pinned':      filter.pinned = true; break;
      case '--deprecated':  filter.deprecated = true; break;
    }
  }
  return filter;
}

function parseMcpListFilter(argv: string[]): McpListFilter {
  const filter: McpListFilter = {};
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--category':    filter.category = nextVal(argv, i++, '--category'); break;
      case '--language':    filter.language = nextVal(argv, i++, '--language'); break;
      case '--popularity':  filter.popularity = nextVal(argv, i++, '--popularity'); break;
      case '--source-type': filter.sourceType = nextVal(argv, i++, '--source-type'); break;
      case '--search':      filter.search = nextVal(argv, i++, '--search'); break;
      case '--pinned':      filter.pinned = true; break;
      case '--deprecated':  filter.deprecated = true; break;
    }
  }
  return filter;
}

function nextVal(argv: string[], i: number, option: string): string {
  if (i + 1 < argv.length) {
    return argv[i + 1];
  }
  process.stderr.write(`Error: Option '${option}' requires a value.\n`);
  process.exit(1);
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
