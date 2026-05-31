import type { McpRecipe, McpWorkspaceStatus, TargetName } from './types.js';
import { discoverProject } from './project-discovery.js';
import { getMcpServers } from './config-adapters.js';
import { padRightWide, truncateWide, getStringWidth } from './table-utils.js';

// ============================================================================
// Status Command
// ============================================================================

/**
 * Show MCP status for the current project.
 */
export async function mcpStatus(verbose: boolean = false, allowHome: boolean = false): Promise<void> {
  const discovery = await discoverProject(process.cwd(), { allowHome });
  const status = await buildMcpStatus(discovery.root, allowHome);

  printMcpStatus(status, verbose);
}

async function buildMcpStatus(projectRoot: string, allowHome: boolean = false): Promise<McpWorkspaceStatus> {
  const { targets } = await discoverProject(process.cwd(), { allowHome });

  const serverMap = new Map<string, { name: string; enabled: boolean; targets: TargetName[]; source: 'catalog' | 'inline' }>();

  for (const [target, configPath] of targets.entries()) {
    if (!configPath.exists) continue;

    const servers = await getMcpServers(target, configPath.path);

    for (const [name, info] of Object.entries(servers)) {
      if (!info.enabled) continue;

      const existing = serverMap.get(name);
      if (existing) {
        existing.targets.push(target);
      } else {
        serverMap.set(name, {
          name,
          enabled: true,
          targets: [target],
          source: 'inline', // TODO: detect from catalog
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
      console.log(`  Source: ${server.source}\n`);
    }
  } else {
    // Compact table output
    const NAME_WIDTH = 35;
    const ENABLED_WIDTH = 7;
    const TARGETS_WIDTH = 15;
    const SOURCE_WIDTH = 7;

    const borderH = '┌' + '─'.repeat(NAME_WIDTH + 2) + '┬' + '─'.repeat(ENABLED_WIDTH + 2) + '┬' + '─'.repeat(TARGETS_WIDTH + 2) + '┬' + '─'.repeat(SOURCE_WIDTH + 2) + '┐';
    const borderM = '├' + '─'.repeat(NAME_WIDTH + 2) + '┼' + '─'.repeat(ENABLED_WIDTH + 2) + '┼' + '─'.repeat(TARGETS_WIDTH + 2) + '┼' + '─'.repeat(SOURCE_WIDTH + 2) + '┤';
    const borderF = '└' + '─'.repeat(NAME_WIDTH + 2) + '┴' + '─'.repeat(ENABLED_WIDTH + 2) + '┴' + '─'.repeat(TARGETS_WIDTH + 2) + '┴' + '─'.repeat(SOURCE_WIDTH + 2) + '┘';

    console.log(borderH);
    console.log('│ ' + padRightWide('Name', NAME_WIDTH) + ' │ ' + padRightWide('Enabled', ENABLED_WIDTH) + ' │ ' + padRightWide('Targets', TARGETS_WIDTH) + ' │ ' + padRightWide('Source', SOURCE_WIDTH) + ' │');
    console.log(borderM);

    for (const server of status.servers) {
      const name = truncateWide(server.name, NAME_WIDTH);
      const enabled = server.enabled ? '✓' : '✗';
      const targets = truncateWide(server.targets.join(', ') || '(none)', TARGETS_WIDTH);
      const source = padRightWide(server.source, SOURCE_WIDTH);

      console.log('│ ' + padRightWide(name, NAME_WIDTH) + ' │ ' + centerWide(enabled, ENABLED_WIDTH) + ' │ ' + padRightWide(targets, TARGETS_WIDTH) + ' │ ' + source + ' │');
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
