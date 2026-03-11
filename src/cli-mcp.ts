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
    console.log('┌─────────────────────────┬─────────┬───────────┬─────────┐');
    console.log('│ Name                    │ Enabled │ Targets   │ Source  │');
    console.log('├─────────────────────────┼─────────┼───────────┼─────────┤');

    for (const server of status.servers) {
      const name = padRight(server.name.slice(0, 23), 23);
      const enabled = server.enabled ? '✓' : '✗';
      const targets = padRight(server.targets.join(', ') || '(none)', 9);
      const source = padRight(server.source, 7);
      console.log(`│ ${name} │ ${enabled}       │ ${targets} │ ${source} │`);
    }

    console.log('└─────────────────────────┴─────────┴───────────┴─────────┘');
    console.log();
    console.log('Run `acsync mcp <name>` for details, `acsync mcp add` to add new servers.\n');
  }
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
  const { normalizeMcpPackage } = await import('./catalog.js');

  // Normalize package to recipe
  const entry = normalizeMcpPackage(options.packageId);

  // Add to catalog if not exists and --no-register is false
  if (!options.noRegister) {
    const { addMcp } = await import('./catalog.js');
    await addMcp(entry);
    console.log(`Added to catalog: ${entry.id}`);
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
