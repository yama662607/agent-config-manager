import type { McpWorkspaceStatus, TargetName } from './types.js';
import { discoverProject } from './project-discovery.js';
import { getMcpServers } from './config-adapters.js';

// ============================================================================
// Status Command
// ============================================================================

/**
 * Show MCP status for the current project.
 */
export async function mcpStatus(verbose: boolean = false): Promise<void> {
  const discovery = await discoverProject();
  const status = await buildMcpStatus(discovery.root);

  printMcpStatus(status, verbose);
}

async function buildMcpStatus(projectRoot: string): Promise<McpWorkspaceStatus> {
  const { targets } = await discoverProject();

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
    console.log('Run `acsync mcp add <package>` to add a server.\n');
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
    const NAME_WIDTH = 30;
    const ENABLED_WIDTH = 7;
    const TARGETS_WIDTH = 15;
    const SOURCE_WIDTH = 7;

    const borderH = '┌' + '─'.repeat(NAME_WIDTH + 2) + '┬' + '─'.repeat(ENABLED_WIDTH + 2) + '┬' + '─'.repeat(TARGETS_WIDTH + 2) + '┬' + '─'.repeat(SOURCE_WIDTH + 2) + '┐';
    const borderM = '├' + '─'.repeat(NAME_WIDTH + 2) + '┼' + '─'.repeat(ENABLED_WIDTH + 2) + '┼' + '─'.repeat(TARGETS_WIDTH + 2) + '┼' + '─'.repeat(SOURCE_WIDTH + 2) + '┤';
    const borderF = '└' + '─'.repeat(NAME_WIDTH + 2) + '┴' + '─'.repeat(ENABLED_WIDTH + 2) + '┴' + '─'.repeat(TARGETS_WIDTH + 2) + '┴' + '─'.repeat(SOURCE_WIDTH + 2) + '┘';

    console.log(borderH);
    console.log('│ ' + padRight('Name', NAME_WIDTH) + ' │ ' + padRight('Enabled', ENABLED_WIDTH) + ' │ ' + padRight('Targets', TARGETS_WIDTH) + ' │ ' + padRight('Source', SOURCE_WIDTH) + ' │');
    console.log(borderM);

    for (const server of status.servers) {
      const name = truncate(server.name, NAME_WIDTH);
      const enabled = server.enabled ? '✓' : '✗';
      const targets = truncate(server.targets.join(', ') || '(none)', TARGETS_WIDTH);
      const source = padRight(server.source, SOURCE_WIDTH);

      console.log('│ ' + padRight(name, NAME_WIDTH) + ' │ ' + center(enabled, ENABLED_WIDTH) + ' │ ' + padRight(targets, TARGETS_WIDTH) + ' │ ' + source + ' │');
    }

    console.log(borderF);
    console.log();
    console.log('Run `acsync mcp <name>` for details, `acsync mcp add` to add new servers.\n');
  }
}

function truncate(str: string, maxLen: number): string {
  if (str.length > maxLen) {
    return str.slice(0, maxLen - 1) + '…';
  }
  return str;
}

function center(str: string, width: number): string {
  const len = str.length;
  if (len >= width) return str;
  const left = Math.floor((width - len) / 2);
  const right = width - len - left;
  return ' '.repeat(left) + str + ' '.repeat(right);
}

function padRight(str: string, len: number): string {
  return str.padEnd(len, ' ');
}

// ============================================================================
// Add Command
// ============================================================================

export interface McpAddOptions {
  packageId: string;
  targets: TargetName[];
  noRegister: boolean;
}

/**
 * Add an MCP server to the current project.
 */
export async function mcpAdd(options: McpAddOptions): Promise<void> {
  const { normalizeMcpPackage, getMcp } = await import('./catalog.js');

  // Check if entry exists in catalog first
  let entry = await getMcp(options.packageId);

  // If not in catalog, normalize and optionally add
  if (!entry) {
    entry = normalizeMcpPackage(options.packageId);

    // Add to catalog if --no-register is false
    if (!options.noRegister) {
      const { addMcp } = await import('./catalog.js');
      await addMcp(entry);
      console.log(`Added to catalog: ${entry.id}`);
    }
  }

  // Add to each target
  const discovery = await discoverProject();
  const { addMcpToConfig } = await import('./config-adapters.js');

  for (const target of options.targets) {
    const configPath = discovery.targets.get(target);
    if (!configPath) continue;

    await addMcpToConfig(target, configPath.path, entry.id, entry.recipe);
    console.log(`Added to ${target}: ${entry.id}`);
  }

  console.log('\nRun `acsync mcp` to see the updated status.');
}

// ============================================================================
// Remove Command
// ============================================================================

export interface McpRemoveOptions {
  serverName: string;
  targets: TargetName[];
}

/**
 * Remove an MCP server from the current project.
 */
export async function mcpRemove(options: McpRemoveOptions): Promise<void> {
  const discovery = await discoverProject();
  const { removeMcpFromConfig } = await import('./config-adapters.js');

  for (const target of options.targets) {
    const configPath = discovery.targets.get(target);
    if (!configPath) continue;

    await removeMcpFromConfig(target, configPath.path, options.serverName);
    console.log(`Removed from ${target}: ${options.serverName}`);
  }

  console.log('\nRun `acsync mcp` to see the updated status.');
}

// ============================================================================
// Enable Command
// ============================================================================

export interface McpEnableOptions {
  serverName: string;
  targets: TargetName[];
}

/**
 * Enable an MCP server in the current project.
 */
export async function mcpEnable(options: McpEnableOptions): Promise<void> {
  const discovery = await discoverProject();
  const { enableMcpInConfig } = await import('./config-adapters.js');

  for (const target of options.targets) {
    const configPath = discovery.targets.get(target);
    if (!configPath) continue;

    await enableMcpInConfig(target, configPath.path, options.serverName);
    console.log(`Enabled in ${target}: ${options.serverName}`);
  }

  console.log('\nRun `acsync mcp` to see the updated status.');
}

// ============================================================================
// Disable Command
// ============================================================================

export interface McpDisableOptions {
  serverName: string;
  targets: TargetName[];
}

/**
 * Disable an MCP server in the current project.
 */
export async function mcpDisable(options: McpDisableOptions): Promise<void> {
  const discovery = await discoverProject();
  const { disableMcpInConfig } = await import('./config-adapters.js');

  for (const target of options.targets) {
    const configPath = discovery.targets.get(target);
    if (!configPath) continue;

    await disableMcpInConfig(target, configPath.path, options.serverName);
    console.log(`Disabled in ${target}: ${options.serverName}`);
  }

  console.log('\nRun `acsync mcp` to see the updated status.');
}
