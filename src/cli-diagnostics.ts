import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { discoverProject } from './project-discovery.js';
import { loadCatalog } from './catalog.js';
import os from 'node:os';
import { describeCatalogSource, getCatalogDir, getConfigPath } from './acm-config.js';
import { unsupportedScopeWarning } from './provider-support.js';
import { isHomeScope } from './agent-paths.js';

const execAsync = promisify(exec);

// ============================================================================
// Validate Command
// ============================================================================

export interface ValidateOptions {
  strict: boolean;
}

/**
 * Validate the current project configuration.
 */
export async function validate(options: ValidateOptions): Promise<void> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Project discovery
  console.log('Checking project discovery...');
  try {
    const discovery = await discoverProject();
    console.log(`  ✓ Project root: ${discovery.root}`);
  } catch (error) {
    errors.push(`Project discovery failed: ${(error as Error).message}\n`);
  }

  // 2. Catalog references
  console.log('Checking catalog...');
  try {
    const catalog = await loadCatalog();
    console.log(`  ✓ Catalog loaded (${Object.keys(catalog.mcps).length} entries)`);
  } catch (error) {
    errors.push(`Catalog load failed: ${(error as Error).message}\n`);
  }

  // 3. Native config parseability
  console.log('Checking native configs...');
  try {
    const discovery = await discoverProject();
    const { readNativeConfig } = await import('./config-adapters.js');

    for (const [target, configPath] of discovery.targets.entries()) {
      if (!configPath.exists) {
        console.log(`  ⚠ ${target}: config not found at ${configPath.path}`);
        continue;
      }

      const result = await readNativeConfig(target, configPath.path);
      if (result.config === null) {
        if (result.raw) {
          warnings.push(`${target}: failed to parse config at ${configPath.path}\n`);
        } else {
          warnings.push(`${target}: empty config at ${configPath.path}\n`);
        }
      } else {
        console.log(`  ✓ ${target}: config parsed successfully`);
      }
    }
  } catch (error) {
    errors.push(`Config validation failed: ${(error as Error).message}\n`);
  }

  // Summary
  console.log();
  if (errors.length > 0) {
    console.error('Validation failed:\n');
    for (const error of errors) {
      console.error(`  ✗ ${error}`);
    }
    process.exitCode = 1;
  } else if (warnings.length > 0) {
    console.warn('Warnings:\n');
    for (const warning of warnings) {
      console.warn(`  ⚠ ${warning}`);
    }
    if (options.strict) {
      console.error('\nValidation failed (strict mode).');
      process.exitCode = 1;
    } else {
      console.log('\nValidation passed with warnings.');
    }
  } else {
    console.log('Validation passed.\n');
  }
}

// ============================================================================
// Doctor Command
// ============================================================================

export interface DoctorOptions {
  fix: boolean;
  strict?: boolean;
  allowHome?: boolean;
  /** Skip the checks that need the network. */
  offline?: boolean;
}

/**
 * Run diagnostics and health checks.
 */
export async function doctor(options: DoctorOptions): Promise<{ hasErrors: boolean; hasWarnings: boolean }> {
  console.log('acm Diagnostics\n');
  console.log('='.repeat(50));

  let hasErrors = false;
  let hasWarnings = false;

  const allowHome = options.allowHome ?? false;

  // 1. Project discovery
  console.log('\n[Project Discovery]');
  try {
    const discovery = await discoverProject(process.cwd(), { allowHome });
    console.log(`  ✓ Project root: ${discovery.root}`);
    console.log(`  ✓ Detected targets:`);
    for (const [target, configPath] of discovery.targets.entries()) {
      const status = configPath.exists ? '✓' : '✗';
      console.log(`      ${status} ${target}: ${configPath.path}`);
      if (!configPath.exists) {
        hasWarnings = true;
      }
    }
  } catch (error) {
    console.log(`  ✗ ${(error as Error).message}`);
    hasErrors = true;
  }

  // 2. Catalog health
  console.log('\n[Catalog Health]');
  let catalogFixed = false;
  try {
    const catalog = await loadCatalog();
    const entryCount = Object.keys(catalog.mcps).length;
    console.log(`  ✓ Catalog location: ${await getCatalogPath()}`);
    console.log(`  ✓ Entries: ${entryCount}`);
    console.log(`  ✓ Version: ${catalog.version}`);
  } catch (error) {
    console.log(`  ✗ ${(error as Error).message}`);
    if (options.fix) {
      console.log('  Attempting to fix...');
      try {
        const { initCatalog } = await import('./catalog.js');
        await initCatalog();
        console.log('  ✓ Catalog initialized');
        catalogFixed = true;
      } catch (fixError) {
        console.log(`  ✗ Fix failed: ${(fixError as Error).message}`);
        hasErrors = true;
      }
    } else {
      hasErrors = true;
    }
  }

  // 3. Catalog location
  console.log('\n[Catalog]');
  const catalogDir = getCatalogDir();
  const source = describeCatalogSource();
  const sourceLabel = {
    env: 'ACM_CATALOG_DIR',
    config: `catalog_dir in ${formatHome(getConfigPath())}`,
    default: 'default (state directory)',
  }[source];
  try {
    await fs.access(catalogDir);
    console.log(`  ✓ ${formatHome(catalogDir)}  [${sourceLabel}]`);
  } catch {
    console.log(`  ✗ ${formatHome(catalogDir)} does not exist  [${sourceLabel}]`);
    hasWarnings = true;
  }

  // 4. Configured MCP servers actually resolve
  console.log('\n[MCP Commands]');
  const unresolved = await checkMcpCommands(allowHome);
  if (unresolved.length === 0) {
    console.log('  ✓ Every configured command resolves');
  } else {
    for (const problem of unresolved) {
      console.log(`  ✗ ${problem}`);
    }
    hasWarnings = true;
  }

  // 5. What has changed since the catalog last agreed with the world
  console.log('\n[Catalog Drift]');
  await reportDrift(options.offline === true);

  // 6. What in the catalog is tied to this machine
  console.log('\n[Portability]');
  if (await reportPortability()) {
    hasWarnings = true;
  }

  // 6. Environment checks
  console.log('\n[Environment]');
  const hasNode = await checkCommand('node', 'Node.js');
  const hasNpm = await checkCommand('npm', 'npm');
  const hasNpx = await checkCommand('npx', 'npx');
  if (!hasNode || !hasNpm || !hasNpx) {
    hasWarnings = true;
  }

  // 4. Target readiness
  console.log('\n[Target Readiness]');
  try {
    const discovery = await discoverProject(process.cwd(), { allowHome });
    for (const [target, configPath] of discovery.targets.entries()) {
      if (configPath.exists) {
        const size = (await fs.stat(configPath.path)).size;
        console.log(`  ✓ ${target}: config exists (${size} bytes)`);
      } else if (unsupportedScopeWarning(target, 'mcp', isHomeScope(discovery.root))) {
        // Not a gap in the setup: the provider has no such scope to configure.
        // Telling the user to run `acm mcp init` here would produce a file its
        // CLI never opens.
        console.log(`  - ${target}: no project-scope MCP configuration to check`);
      } else {
        console.log(`  ⚠ ${target}: config not found (run \`acm mcp init\`)`);
        hasWarnings = true;
      }
    }
  } catch (error) {
    const message = (error as Error).message;
    // Running from home without -H is a common mistake, not a broken setup.
    if (message.includes('Cannot use home directory as project root')) {
      console.log('  ⚠ Skipped: the current directory is your home directory.');
      console.log('    Run `acm doctor -H` to check global configuration,');
      console.log('    or run this from a project directory.');
      hasWarnings = true;
    } else {
      console.log(`  ✗ ${message}`);
      hasErrors = true;
    }
  }

  console.log('\n' + '='.repeat(50));
  
  if (hasErrors) {
    console.error('\nDiagnostics failed with errors.');
    process.exitCode = 1;
  } else if (hasWarnings && options.strict) {
    console.error('\nDiagnostics failed with warnings (strict mode).');
    process.exitCode = 1;
  } else {
    console.log('\nFor more help, run `acm --help` or visit the documentation.\n');
  }

  return { hasErrors, hasWarnings };
}

async function getCatalogPath(): Promise<string> {
  const { getCatalogPath: getPath } = await import('./catalog.js');
  return getPath();
}

async function checkCommand(command: string, name: string): Promise<boolean> {
  try {
    const result = await commandExists(command);
    if (result) {
      console.log(`  ✓ ${name}: found`);
      return true;
    } else {
      console.log(`  ⚠ ${name}: not found (may be required for some MCP servers)`);
      return false;
    }
  } catch (error) {
    console.log(`  ⚠ ${name}: unable to check`);
    return false;
  }
}

async function commandExists(command: string): Promise<boolean> {
  try {
    const isWindows = process.platform === 'win32';
    const cmd = isWindows ? `where ${command}` : `which ${command}`;
    await execAsync(cmd);
    return true;
  } catch {
    return false;
  }
}

/** Collapse the home directory to `~` for display. */
function formatHome(absolutePath: string): string {
  const home = os.homedir();
  return absolutePath === home || absolutePath.startsWith(home + '/')
    ? '~' + absolutePath.slice(home.length)
    : absolutePath;
}

/**
 * Check that every configured MCP server has something that can actually start.
 *
 * A recipe pointing at a moved or uninstalled binary fails silently: the agent
 * simply has no tools from that server. One such entry existed here for months,
 * pointing at an application that had been renamed.
 */
/**
 * Report what the catalog expects to find on this machine.
 *
 * A catalog is meant to be carried, and most of it travels. What does not is a
 * skill linked to a development repository, or a recipe naming a binary or a
 * vault by absolute path. Those are deliberate, so this lists them rather than
 * objecting: on the machine that wrote them it says they are all here, which is
 * what you want to know before cloning the catalog somewhere else; on that
 * other machine the same list is the work to do.
 *
 * Returns whether anything is missing.
 */
async function reportPortability(): Promise<boolean> {
  const { machineReferences } = await import('./catalog-portability.js');

  const references = await machineReferences(getCatalogDir());

  if (references.length === 0) {
    console.log('  ✓ Nothing in the catalog depends on this machine');
    return false;
  }

  const missing = references.filter((reference) => !reference.present);

  for (const reference of missing) {
    if (reference.kind === 'plugin source') {
      // The application is what is missing; its path here means nothing.
      console.log(
        `  ✗ ${reference.id}: bundled in ${reference.variable ?? 'an application'}, not installed here`
      );
      continue;
    }
    const where = reference.variable ? `${reference.kind} ${reference.variable}` : reference.kind;
    console.log(`  ✗ ${reference.id}: ${where} -> ${formatHome(reference.target)}`);
  }

  if (missing.length === 0) {
    console.log(`  ✓ ${references.length} references to this machine, all present`);
    console.log('    They will need attention if you clone this catalog elsewhere.');
    return false;
  }

  console.log(`  ${missing.length} of ${references.length} not found on this machine.`);

  // The two kinds need different answers, so only mention the ones present.
  const kinds = new Set(missing.map((reference) => reference.kind));
  if (kinds.size > (kinds.has('plugin source') ? 1 : 0)) {
    console.log('    Re-link the skill, or point the recipe at where it lives here.');
  }
  if (kinds.has('plugin source')) {
    console.log('    A plugin from an application you do not have here is fine to leave.');
  }

  return missing.length > 0;
}

async function checkMcpCommands(allowHome: boolean): Promise<string[]> {
  const { discoverProject } = await import('./project-discovery.js');
  const { getMcpServers } = await import('./config-adapters.js');
  const problems: string[] = [];

  let discovery;
  try {
    discovery = await discoverProject(process.cwd(), { allowHome });
  } catch {
    return problems; // Scope errors are reported by the section above.
  }

  const seen = new Set<string>();

  for (const [target, configPath] of discovery.targets.entries()) {
    if (!configPath.exists) continue;

    let servers: Record<string, { enabled: boolean; recipe?: any }>;
    try {
      servers = await getMcpServers(target, configPath.path);
    } catch {
      continue;
    }

    for (const [name, info] of Object.entries(servers)) {
      if (!info.enabled || !info.recipe?.command) continue;

      const command = info.recipe.command as string;
      const key = `${name}:${command}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if ((await commandResolves(command, info.recipe.cwd)) === 'missing') {
        problems.push(`${name} (${target}): cannot find ${formatHome(command)}`);
      }
    }
  }

  return problems;
}

/**
 * Whether a command exists: as a path, or on PATH.
 *
 * A relative command is resolved against the working directory the server is
 * configured to start in, not against wherever `acm` happens to be running.
 * Codex writes such entries for its own bundled servers — `./Codex Computer
 * Use.app/…` with `cwd = "."` — and checking those from `acm`'s directory
 * reported a server that works fine as missing.
 *
 * `unknown` is for a relative command whose working directory is itself
 * relative: only the application launching it knows what that resolves to, so
 * neither "found" nor "missing" would be honest.
 */
async function commandResolves(
  command: string,
  cwd?: string
): Promise<'found' | 'missing' | 'unknown'> {
  if (command.includes('/')) {
    if (!path.isAbsolute(command)) {
      if (!cwd || !path.isAbsolute(cwd)) return 'unknown';
      command = path.resolve(cwd, command);
    }
    try {
      await fs.access(command);
      return 'found';
    } catch {
      return 'missing';
    }
  }

  try {
    await execAsync(`command -v ${JSON.stringify(command)}`);
    return 'found';
  } catch {
    return 'missing';
  }
}

/**
 * Report both kinds of drift: sources that moved ahead of the catalog, and
 * catalog files that moved ahead of their last commit.
 *
 * Skills with a recorded upstream are counted but not queried — that needs the
 * network, and `acm skill outdated` is the command that asks for it.
 */
async function reportDrift(offline: boolean): Promise<void> {
  const { pluginSourceDrift, catalogGitDrift, summarizeGitDrift } = await import('./catalog-drift.js');

  try {
    const plugins = await pluginSourceDrift();
    if (plugins.length === 0) {
      console.log('  ✓ Every tracked plugin matches its source');
    } else {
      for (const item of plugins) {
        console.log(`  ● ${item.id}: ${item.detail}`);
      }
      console.log(`    Refresh with \`acm plugin import <path> --as <name>\``);
    }
  } catch (error) {
    console.log(`  ⚠ Could not compare plugin sources: ${error instanceof Error ? error.message : error}`);
  }

  await reportUpstreamSkills(offline);

  try {
    const git = await catalogGitDrift();
    if (git === null) {
      console.log('  ○ The catalog is not a git repository, so changes are not tracked');
    } else if (git.length === 0) {
      console.log('  ✓ The catalog matches its last commit');
    } else {
      const areas = [...summarizeGitDrift(git)]
        .map(([area, count]) => `${count} in ${area}`)
        .join(', ');
      console.log(`  ● ${git.length} uncommitted change${git.length === 1 ? '' : 's'} in the catalog (${areas})`);
    }
  } catch (error) {
    console.log(`  ⚠ Could not read catalog git status: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * Compare skills against their recorded upstream.
 *
 * This is the one part of the diagnosis that leaves the machine. It runs by
 * default because a diagnosis that quietly skips a whole class of problem is
 * worse than a slow one — and it is not slow: twenty entries take about three
 * seconds. `--offline` skips it for CI, aeroplanes, and upstreams that are down.
 */
async function reportUpstreamSkills(offline: boolean): Promise<void> {
  const { loadSkillsMetadata } = await import('./skills-metadata.js');

  let tracked;
  try {
    tracked = Object.entries((await loadSkillsMetadata()).skills).filter(
      ([, meta]) => meta.sourceUrl
    );
  } catch {
    return; // Metadata is optional.
  }

  if (tracked.length === 0) return;

  if (offline) {
    console.log(`  ○ ${tracked.length} skills record an upstream (not checked: --offline)`);
    return;
  }

  const { checkUpstreamAll } = await import('./skill-provenance.js');
  const results = await checkUpstreamAll(tracked.map(([id, meta]) => ({ id, meta })));

  const behind = results.filter((r) => r.state === 'behind');
  const unreachable = results.filter((r) => r.state === 'unreachable');

  if (behind.length === 0) {
    const suffix = unreachable.length > 0 ? `, ${unreachable.length} unreachable` : '';
    console.log(`  ✓ ${results.length} tracked skills match their upstream${suffix}`);
    return;
  }

  for (const item of behind) {
    console.log(`  ● ${item.skillId}: upstream moved (${item.recordedRef?.slice(0, 8)} -> ${item.latestRef?.slice(0, 8)})`);
  }
  console.log('    Review, then re-install what you want with `acm skill install <url> --force`');
}
