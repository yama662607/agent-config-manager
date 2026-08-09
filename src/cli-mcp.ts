import type {
  McpRecipe,
  McpWorkspaceStatus,
  TargetName,
  McpServerStatus,
  McpDeploymentState,
  McpCatalogEntry,
} from './types.js';
import { discoverProject } from './project-discovery.js';
import { inferPackageIdFromRecipe, sanitizeServerName } from './mcp-names.js';
import { getMcpServers } from './config-adapters.js';
import { padRightWide, truncateWide, truncateMiddle, getStringWidth } from './table-utils.js';

// ============================================================================
// Status Command
// ============================================================================

/**
 * Show MCP status for the current project.
 */
export async function mcpStatus(
  verbose: boolean = false,
  allowHome: boolean = false,
  json: boolean = false
): Promise<void> {
  const discovery = await discoverProject(process.cwd(), { allowHome });
  const status = await buildMcpStatus(discovery.root, allowHome);

  if (json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  printMcpStatus(status, verbose);
}

/**
 * Find the catalog entry a configured server corresponds to.
 *
 * Matching by name alone missed the case `acm` itself creates. A catalog entry
 * is keyed by package id (`@scope/name`), but Codex and Claude reject that as a
 * server name, so the name written into a provider's configuration is
 * sanitized — and the same package can end up configured under its full id in
 * one place and a sanitized form in another. `@yama662607/obsidian-companion-mcp`
 * was reported as unmanaged while its catalog entry sat right there.
 *
 * So the fallbacks are what the server *launches*, then the sanitized name.
 * When several entries install the same package, the one whose recipe matches
 * wins, so an ambiguity cannot invent a spurious `differs`.
 */
function matchCatalogEntry(
  entries: McpCatalogEntry[],
  configuredName: string,
  configuredRecipe?: McpRecipe
): McpCatalogEntry | undefined {
  const byName = entries.find((entry) => entry.id === configuredName);
  if (byName) return byName;

  const configuredPackage =
    inferPackageIdFromRecipe(configuredRecipe?.command, configuredRecipe?.args) ?? configuredName;

  const samePackage = entries.filter(
    (entry) => inferPackageIdFromRecipe(entry.recipe.command, entry.recipe.args) === configuredPackage
  );
  if (samePackage.length > 0) {
    return (
      samePackage.find((entry) => recipesMatch(entry.recipe, configuredRecipe)) ?? samePackage[0]
    );
  }

  const sanitized = sanitizeServerName(configuredName);
  return entries.find((entry) => sanitizeServerName(entry.id) === sanitized);
}

async function buildMcpStatus(projectRoot: string, allowHome: boolean = false): Promise<McpWorkspaceStatus> {
  const { targets } = await discoverProject(process.cwd(), { allowHome });
  const { listMcps } = await import('./catalog.js');

  const entries = await listMcps();
  // A server a plugin brings is the plugin's to manage: installing the plugin
  // writes it and uninstalling removes it. Reporting it as an untracked inline
  // server invited a pointless `acm mcp adopt`, and the next plugin install
  // would have put it back anyway.
  const fromPlugins = await pluginOwnedServers();
  const serverMap = new Map<string, McpServerStatus>();

  for (const [target, configPath] of targets.entries()) {
    if (!configPath.exists) continue;

    const servers = await getMcpServers(target, configPath.path);

    for (const [name, info] of Object.entries(servers)) {
      const catalogEntry = matchCatalogEntry(entries, name, info.recipe);
      const owningPlugin = fromPlugins.get(name);
      const state: McpDeploymentState = !info.enabled
        ? 'disabled'
        : catalogEntry
          ? recipesMatch(catalogEntry.recipe, info.recipe)
            ? 'synced'
            : 'differs'
          : owningPlugin
            ? 'plugin'
            : 'inline';

      const existing = serverMap.get(name);
      if (existing) {
        existing.targets.push(target);
        existing.enabled ||= info.enabled;
        existing.state![target] = state;
        if (info.recipe) existing.deployed![target] = info.recipe;
      } else {
        serverMap.set(name, {
          name,
          enabled: info.enabled,
          targets: [target],
          source: catalogEntry ? 'catalog' : owningPlugin ? 'plugin' : 'inline',
          plugin: owningPlugin,
          state: { [target]: state },
          deployed: info.recipe ? { [target]: info.recipe } : {},
        });
      }
    }
  }

  const servers = Array.from(serverMap.values());
  const enabledCount = servers.filter((s) => s.enabled).length;

  return {
    projectRoot,
    servers,
    totalCount: servers.length,
    enabledCount,
  };
}

/**
 * Compare a catalog recipe with what a target actually launches.
 *
 * Environment values are excluded: they routinely hold machine-specific
 * secrets and paths that differ legitimately between the catalog and a
 * deployment. Their names are compared, because a missing variable is a
 * genuine difference.
 */
/** One-line summary of what a target actually launches. */
function describeRecipe(recipe: McpRecipe): string {
  if (recipe.url) return recipe.url;
  if (!recipe.command) return '(nothing configured)';
  return [recipe.command, ...(recipe.args ?? [])].join(' ');
}

const MCP_STATE_LABELS: Record<McpDeploymentState, string> = {
  synced: 'synced',
  differs: 'differs',
  inline: 'inline',
  plugin: 'plugin',
  disabled: 'disabled',
};

/** Server name to the catalog plugin whose `.mcp.json` declares it. */
async function pluginOwnedServers(): Promise<Map<string, string>> {
  const { listPlugins, getPluginInstallDir } = await import('./plugins-metadata.js');
  const fsp = await import('node:fs/promises');
  const pathMod = await import('node:path');

  const owned = new Map<string, string>();

  for (const plugin of await listPlugins()) {
    try {
      const raw = await fsp.readFile(
        pathMod.join(getPluginInstallDir(plugin.name), '.mcp.json'),
        'utf8'
      );
      for (const name of Object.keys(JSON.parse(raw)?.mcpServers ?? {})) {
        if (!owned.has(name)) owned.set(name, plugin.name);
      }
    } catch {
      // No MCP servers in this plugin.
    }
  }

  return owned;
}

/** Summarize state across targets, listing them separately when they disagree. */
function formatMcpState(server: McpServerStatus): string {
  const entries = Object.entries(server.state ?? {}) as [TargetName, McpDeploymentState][];
  if (entries.length === 0) return '-';

  const states = new Set(entries.map(([, state]) => state));
  if (states.size === 1) return MCP_STATE_LABELS[entries[0][1]];

  const short: Record<TargetName, string> = {
    claude: 'cl',
    codex: 'cx',
    antigravity: 'ag',
    grok: 'gk',
  };
  return entries.map(([target, state]) => `${short[target]}:${MCP_STATE_LABELS[state]}`).join(' ');
}

function recipesMatch(catalog: McpRecipe | undefined, deployed: McpRecipe | undefined): boolean {
  if (!catalog || !deployed) return false;

  if ((catalog.command ?? '') !== (deployed.command ?? '')) return false;
  if ((catalog.url ?? '') !== (deployed.url ?? '')) return false;
  if ((catalog.cwd ?? '') !== (deployed.cwd ?? '')) return false;

  const catalogArgs = catalog.args ?? [];
  const deployedArgs = deployed.args ?? [];
  if (catalogArgs.length !== deployedArgs.length) return false;
  if (catalogArgs.some((arg, i) => arg !== deployedArgs[i])) return false;

  const catalogEnv = Object.keys(catalog.env ?? {}).sort();
  const deployedEnv = Object.keys(deployed.env ?? {}).sort();
  if (catalogEnv.length !== deployedEnv.length) return false;
  return catalogEnv.every((key, i) => key === deployedEnv[i]);
}

function printMcpStatus(status: McpWorkspaceStatus, verbose: boolean): void {
  console.log(`Project: ${status.projectRoot}`);
  console.log(`MCP Servers (${status.totalCount} total, ${status.enabledCount} enabled):\n`);

  if (status.servers.length === 0) {
    console.log('No MCP servers configured.');
    console.log('Run `acm mcp add <package>` to add a server.\n');
    return;
  }

  if (verbose) {
    // Verbose output
    for (const server of status.servers) {
      console.log(`MCP Server: ${server.name}`);
      console.log(`  Status: ${server.enabled ? '✓' : '✗'} ${server.enabled ? 'Enabled' : 'Disabled'}`);
      console.log(`  Targets: ${server.targets.join(', ') || '(none)'}`);
      console.log(`  Source: ${server.source}`);
      console.log(`  State: ${formatMcpState(server)}`);
      for (const [target, recipe] of Object.entries(server.deployed ?? {})) {
        console.log(`  Launches (${target}): ${describeRecipe(recipe)}`);
      }
      console.log();
    }
  } else {
    // Compact table output
    const NAME_WIDTH = 30;
    const ENABLED_WIDTH = 7;
    const TARGETS_WIDTH = 15;
    const SOURCE_WIDTH = 7;
    const STATE_WIDTH = 18;

    const widths = [NAME_WIDTH, ENABLED_WIDTH, TARGETS_WIDTH, SOURCE_WIDTH, STATE_WIDTH];
    const line = (l: string, m: string, r: string) => l + widths.map((w) => '─'.repeat(w + 2)).join(m) + r;
    const borderH = line('┌', '┬', '┐');
    const borderM = line('├', '┼', '┤');
    const borderF = line('└', '┴', '┘');

    console.log(borderH);
    console.log('│ ' + padRightWide('Name', NAME_WIDTH) + ' │ ' + padRightWide('Enabled', ENABLED_WIDTH) + ' │ ' + padRightWide('Targets', TARGETS_WIDTH) + ' │ ' + padRightWide('Source', SOURCE_WIDTH) + ' │ ' + padRightWide('State', STATE_WIDTH) + ' │');
    console.log(borderM);

    for (const server of status.servers) {
      const name = truncateMiddle(server.name, NAME_WIDTH);
      const enabled = server.enabled ? '✓' : '✗';
      const targets = truncateWide(server.targets.join(', ') || '(none)', TARGETS_WIDTH);
      const source = padRightWide(server.source, SOURCE_WIDTH);
      const state = padRightWide(truncateWide(formatMcpState(server), STATE_WIDTH), STATE_WIDTH);

      console.log('│ ' + padRightWide(name, NAME_WIDTH) + ' │ ' + centerWide(enabled, ENABLED_WIDTH) + ' │ ' + padRightWide(targets, TARGETS_WIDTH) + ' │ ' + source + ' │ ' + state + ' │');
    }

    console.log(borderF);
    console.log();
    console.log('Run `acm mcp <name>` for details, `acm mcp add` to add new servers.\n');
  }
}

/**
 * Center a string within a width, considering multibyte characters.
 */
function centerWide(str: string, width: number): string {
  const strWidth = getStringWidth(str);
  if (strWidth >= width) return str;
  const left = Math.floor((width - strWidth) / 2);
  const right = width - strWidth - left;
  return ' '.repeat(left) + str + ' '.repeat(right);
}

// ============================================================================
// Add Command
// ============================================================================

export interface McpAddOptions {
  packageId: string;
  targets: TargetName[];
  noRegister: boolean;
  recipe?: McpRecipe;
  allowHome?: boolean;
}

/**
 * Add an MCP server to the current project.
 */
export async function mcpAdd(options: McpAddOptions): Promise<void> {
  const { normalizeMcpPackage, getMcp, addMcp } = await import('./catalog.js');

  const customRecipe = normalizeRecipe(options.recipe);
  let entry = customRecipe
    ? normalizeMcpPackage(options.packageId, { recipe: customRecipe })
    : await getMcp(options.packageId);

  if (!entry) {
    entry = normalizeMcpPackage(options.packageId);
  }

  if (!options.noRegister && (customRecipe || !(await getMcp(options.packageId)))) {
    await addMcp(entry);
    console.log(`Added to catalog: ${entry.id}`);
  }

  // Add to each target
  const discovery = await discoverProject(process.cwd(), { allowHome: options.allowHome });
  const { addMcpToConfig } = await import('./config-adapters.js');
  const { unsupportedScopeWarning } = await import('./provider-support.js');

  for (const target of options.targets) {
    const warning = unsupportedScopeWarning(target, 'mcp', options.allowHome === true);
    if (warning) console.warn(warning);
  }

  for (const target of options.targets) {
    const configPath = discovery.targets.get(target);
    if (!configPath) continue;

    const actualServerName = await addMcpToConfig(target, configPath.path, entry.id, entry.recipe);
    const suffix = target === 'codex' && actualServerName !== entry.id
      ? ` (key: ${actualServerName})`
      : '';
    console.log(`Added to ${target}: ${entry.id}${suffix}`);
  }

  console.log('\nRun `acm mcp` to see the updated status.');
  console.log('Already-running agent sessions keep their old server list until restarted.');
}

export interface McpEditOptions {
  serverName: string;
  targets: TargetName[];
  recipe: McpRecipe;
  allowHome?: boolean;
}

export async function mcpEdit(options: McpEditOptions): Promise<void> {
  const recipe = normalizeRecipe(options.recipe);
  if (!recipe) {
    throw new Error('At least one MCP configuration field must be provided for edit');
  }

  const discovery = await discoverProject(process.cwd(), { allowHome: options.allowHome });
  const { updateMcpInConfig } = await import('./config-adapters.js');

  for (const target of options.targets) {
    const configPath = discovery.targets.get(target);
    if (!configPath) continue;

    const actualServerName = await updateMcpInConfig(target, configPath.path, options.serverName, recipe);
    const suffix = target === 'codex' && actualServerName !== options.serverName
      ? ` (key: ${actualServerName})`
      : '';
    console.log(`Updated in ${target}: ${options.serverName}${suffix}`);
  }

  console.log('\nRun `acm mcp` to see the updated status.');
  console.log('Already-running agent sessions keep their old server list until restarted.');
}

// ============================================================================
// Remove Command
// ============================================================================

export interface McpRemoveOptions {
  serverName: string;
  targets: TargetName[];
  allowHome?: boolean;
}

/**
 * Remove an MCP server from the current project.
 */
export async function mcpRemove(options: McpRemoveOptions): Promise<void> {
  const discovery = await discoverProject(process.cwd(), { allowHome: options.allowHome });
  const { removeMcpFromConfig } = await import('./config-adapters.js');

  for (const target of options.targets) {
    const configPath = discovery.targets.get(target);
    if (!configPath) continue;

    await removeMcpFromConfig(target, configPath.path, options.serverName);
    console.log(`Removed from ${target}: ${options.serverName}`);
  }

  console.log('\nRun `acm mcp` to see the updated status.');
  console.log('Already-running agent sessions keep their old server list until restarted.');
}

// ============================================================================
// Enable Command
// ============================================================================

export interface McpEnableOptions {
  serverName: string;
  targets: TargetName[];
  allowHome?: boolean;
}

/**
 * Enable an MCP server in the current project.
 */
export async function mcpEnable(options: McpEnableOptions): Promise<void> {
  const discovery = await discoverProject(process.cwd(), { allowHome: options.allowHome });
  const { enableMcpInConfig } = await import('./config-adapters.js');

  for (const target of options.targets) {
    const configPath = discovery.targets.get(target);
    if (!configPath) continue;

    await enableMcpInConfig(target, configPath.path, options.serverName);
    console.log(`Enabled in ${target}: ${options.serverName}`);
  }

  console.log('\nRun `acm mcp` to see the updated status.');
  console.log('Already-running agent sessions keep their old server list until restarted.');
}

// ============================================================================
// Disable Command
// ============================================================================

export interface McpDisableOptions {
  serverName: string;
  targets: TargetName[];
  allowHome?: boolean;
}

/**
 * Disable an MCP server in the current project.
 */
export async function mcpDisable(options: McpDisableOptions): Promise<void> {
  const discovery = await discoverProject(process.cwd(), { allowHome: options.allowHome });
  const { disableMcpInConfig } = await import('./config-adapters.js');

  for (const target of options.targets) {
    const configPath = discovery.targets.get(target);
    if (!configPath) continue;

    await disableMcpInConfig(target, configPath.path, options.serverName);
    console.log(`Disabled in ${target}: ${options.serverName}`);
  }

  console.log('\nRun `acm mcp` to see the updated status.');
  console.log('Already-running agent sessions keep their old server list until restarted.');
}

function normalizeRecipe(recipe?: McpRecipe): McpRecipe | undefined {
  if (!recipe) return undefined;

  const normalized: McpRecipe = {};
  if (recipe.transport) normalized.transport = recipe.transport;
  if (recipe.command) normalized.command = recipe.command;
  if (recipe.args) normalized.args = recipe.args;
  if (recipe.url) normalized.url = recipe.url;
  if (recipe.cwd) normalized.cwd = recipe.cwd;
  if (recipe.env && Object.keys(recipe.env).length > 0) normalized.env = recipe.env;

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

// ============================================================================
// Update Command
// ============================================================================

export interface McpUpdateOptions {
  /** Limit to one server. Defaults to every server that differs. */
  serverName?: string;
  targets: TargetName[];
  allowHome?: boolean;
}

/**
 * Re-apply catalog recipes to targets whose configuration has drifted.
 *
 * Only entries that exist in the catalog are touched: an inline server has no
 * catalog recipe to apply, and overwriting it would destroy the only copy.
 */
export async function mcpUpdate(options: McpUpdateOptions): Promise<void> {
  const { addMcpToConfig } = await import('./config-adapters.js');
  const { listMcps } = await import('./catalog.js');

  const discovery = await discoverProject(process.cwd(), { allowHome: options.allowHome });
  const status = await buildMcpStatus(discovery.root, options.allowHome);
  const entries = await listMcps();

  let updated = 0;

  for (const server of status.servers) {
    if (options.serverName && server.name !== options.serverName) continue;

    // Resolved the same way status is, so a server reported as `differs` is
    // never then refused here for not being in the catalog.
    const anyRecipe = Object.values(server.deployed ?? {})[0];
    const entry = matchCatalogEntry(entries, server.name, anyRecipe);
    if (!entry) {
      if (options.serverName) {
        console.error(`Not in the catalog: ${server.name} (configured inline)`);
        process.exitCode = 1;
      }
      continue;
    }

    for (const target of options.targets) {
      if (server.state?.[target] !== 'differs') continue;

      const configPath = discovery.targets.get(target)?.path;
      if (!configPath) continue;

      await addMcpToConfig(target, configPath, server.name, entry.recipe);
      console.log(`Updated ${target}: ${server.name}`);
      updated++;
    }
  }

  if (updated === 0) {
    console.log('Nothing to update: no configured server differs from the catalog.');
  } else {
    console.log(`\nUpdated ${updated} server configuration${updated === 1 ? '' : 's'}.`);
    console.log('Already-running agent sessions keep their old server list until restarted.');
  }
}

// ============================================================================
// Adopt Command
// ============================================================================

export interface McpAdoptOptions {
  /** Limit to one server. Defaults to every server that differs. */
  serverName?: string;
  /** Which target's configuration to take as correct. */
  from: TargetName;
  allowHome?: boolean;
}

/**
 * Copy a target's configuration back into the catalog.
 *
 * The inverse of `update`. A deployed recipe is often the correct one: an
 * application moves, a package gains a version suffix, someone fixes a broken
 * command in place. Without this, the catalog can only ever be corrected by
 * hand-editing TOML.
 */
export async function mcpAdopt(options: McpAdoptOptions): Promise<void> {
  const { addMcp, getMcp, normalizeMcpPackage } = await import('./catalog.js');

  const discovery = await discoverProject(process.cwd(), { allowHome: options.allowHome });
  const status = await buildMcpStatus(discovery.root, options.allowHome);

  let adopted = 0;

  for (const server of status.servers) {
    if (options.serverName && server.name !== options.serverName) continue;

    const state = server.state?.[options.from];
    if (state !== 'differs' && state !== 'inline') continue;

    const recipe = server.deployed?.[options.from];
    if (!recipe || (!recipe.command && !recipe.url)) {
      console.error(`Nothing to adopt for ${server.name}: ${options.from} has no launch recipe`);
      process.exitCode = 1;
      continue;
    }

    // Personal paths in a recipe are usually a mistake worth surfacing, but the
    // user asked for this configuration, so warn rather than refuse.
    const personal = [recipe.command, ...(recipe.args ?? [])]
      .filter((value): value is string => typeof value === 'string')
      .filter((value) => /\/(Users|home)\/[A-Za-z0-9._-]+/.test(value));
    for (const value of personal) {
      console.warn(`  Warning: ${server.name} records a machine-specific path: ${value}`);
    }

    const existing = await getMcp(server.name);
    const entry = normalizeMcpPackage(server.name, {
      recipe,
      displayName: existing?.displayName,
      description: existing?.description,
      tags: existing?.tags,
    });

    await addMcp(entry);
    console.log(`Adopted into the catalog: ${server.name} (from ${options.from})`);
    adopted++;
  }

  if (adopted === 0) {
    console.log(`Nothing to adopt: no server differs from the catalog in ${options.from}.`);
  } else {
    console.log(`\nAdopted ${adopted} recipe${adopted === 1 ? '' : 's'} into the catalog.`);
  }
}
