import fs from 'node:fs/promises';
import path from 'node:path';
import TOML from '@iarna/toml';
import type {
  TargetName,
  ClaudeMcpConfig,
  ClaudeMcpServer,
  CodexConfig,
  CodexMcpServer,
  GeminiSettings,
  GeminiMcpServer,
  McpRecipe,
  ConfigReadResult,
} from './types.js';

// ============================================================================
// Config Reading
// ============================================================================

/**
 * Read and parse a native config file for a target.
 */
export async function readNativeConfig(target: TargetName, configPath: string): Promise<ConfigReadResult<any>> {
  try {
    const raw = await fs.readFile(configPath, 'utf8');

    switch (target) {
      case 'claude':
        return parseClaudeConfig(raw);
      case 'codex':
        return parseCodexConfig(raw);
      case 'gemini':
        return parseGeminiConfig(raw);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { config: null, exists: false };
    }
    throw error;
  }
}

function parseClaudeConfig(raw: string): ConfigReadResult<ClaudeMcpConfig> {
  try {
    const config = JSON.parse(raw) as ClaudeMcpConfig;
    return { config, exists: true };
  } catch {
    return { config: null, exists: true, raw };
  }
}

function parseCodexConfig(raw: string): ConfigReadResult<CodexConfig> {
  try {
    const config = TOML.parse(raw) as CodexConfig;
    return { config, exists: true };
  } catch {
    return { config: null, exists: true, raw };
  }
}

function parseGeminiConfig(raw: string): ConfigReadResult<GeminiSettings> {
  try {
    const config = JSON.parse(raw) as GeminiSettings;
    return { config, exists: true };
  } catch {
    return { config: null, exists: true, raw };
  }
}

// ============================================================================
// Config Writing
// ============================================================================

/**
 * Write a native config file atomically.
 */
export async function writeNativeConfig(
  target: TargetName,
  configPath: string,
  config: any
): Promise<void> {
  const tempPath = `${configPath}.tmp`;

  let content: string;
  switch (target) {
    case 'claude':
      content = JSON.stringify(config, null, 2);
      break;
    case 'codex':
      content = TOML.stringify(config as any);
      break;
    case 'gemini':
      content = JSON.stringify(config, null, 2);
      break;
  }

  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(tempPath, content, 'utf8');
  await fs.rename(tempPath, configPath);
}

// ============================================================================
// MCP Server Operations
// ============================================================================

/**
 * Add an MCP server to a native config.
 */
export async function addMcpToConfig(
  target: TargetName,
  configPath: string,
  serverName: string,
  recipe: McpRecipe
): Promise<void> {
  const result = await readNativeConfig(target, configPath);

  let config: any;
  switch (target) {
    case 'claude':
      config = result.config ?? { mcpServers: {} };
      break;
    case 'codex':
      config = result.config ?? { mcp_servers: {} };
      break;
    case 'gemini':
      config = result.config ?? { mcpServers: {} };
      break;
  }

  await addMcpServer(target, config, serverName, recipe);
  await writeNativeConfig(target, configPath, config);
}

/**
 * Remove an MCP server from a native config.
 */
export async function removeMcpFromConfig(
  target: TargetName,
  configPath: string,
  serverName: string
): Promise<void> {
  const result = await readNativeConfig(target, configPath);

  if (!result.config) {
    return; // Nothing to remove
  }

  const config = result.config;
  await removeMcpServer(target, config, serverName);
  await writeNativeConfig(target, configPath, config);
}

/**
 * Enable an MCP server in a native config.
 */
export async function enableMcpInConfig(
  target: TargetName,
  configPath: string,
  serverName: string
): Promise<void> {
  const result = await readNativeConfig(target, configPath);

  if (!result.config) {
    return; // Nothing to enable
  }

  const config = result.config;
  await setMcpEnabled(target, config, serverName, true);
  await writeNativeConfig(target, configPath, config);
}

/**
 * Disable an MCP server in a native config.
 */
export async function disableMcpInConfig(
  target: TargetName,
  configPath: string,
  serverName: string
): Promise<void> {
  const result = await readNativeConfig(target, configPath);

  if (!result.config) {
    return; // Nothing to disable
  }

  const config = result.config;
  await setMcpEnabled(target, config, serverName, false);
  await writeNativeConfig(target, configPath, config);
}

// ============================================================================
// Internal Server Operations
// ============================================================================

async function addMcpServer(
  target: TargetName,
  config: any,
  serverName: string,
  recipe: McpRecipe
): Promise<void> {
  switch (target) {
    case 'claude':
      (config as ClaudeMcpConfig).mcpServers[serverName] = {
        command: recipe.command,
        args: recipe.args,
        ...(recipe.env ? { env: recipe.env } : {}),
      };
      break;

    case 'codex':
      (config as CodexConfig).mcp_servers![serverName] = {
        command: recipe.command,
        args: recipe.args,
        enabled: true,
        ...(recipe.env ? { env: recipe.env } : {}),
      };
      break;

    case 'gemini':
      (config as GeminiSettings).mcpServers![serverName] = {
        command: recipe.command,
        args: recipe.args,
        enabled: true,
      };
      break;
  }
}

async function removeMcpServer(
  target: TargetName,
  config: any,
  serverName: string
): Promise<void> {
  switch (target) {
    case 'claude':
      delete (config as ClaudeMcpConfig).mcpServers[serverName];
      break;

    case 'codex':
      if (config.mcp_servers) {
        delete config.mcp_servers[serverName];
      }
      break;

    case 'gemini':
      if (config.mcpServers) {
        delete config.mcpServers[serverName];
      }
      break;
  }
}

async function setMcpEnabled(
  target: TargetName,
  config: any,
  serverName: string,
  enabled: boolean
): Promise<void> {
  switch (target) {
    case 'claude':
      // Claude doesn't have enabled flag - remove when disabled
      if (!enabled) {
        delete (config as ClaudeMcpConfig).mcpServers[serverName];
      }
      break;

    case 'codex':
      if (config.mcp_servers?.[serverName]) {
        (config.mcp_servers[serverName] as CodexMcpServer).enabled = enabled;
      }
      break;

    case 'gemini':
      if (config.mcpServers?.[serverName]) {
        (config.mcpServers[serverName] as GeminiMcpServer).enabled = enabled;
      }
      break;
  }
}

// ============================================================================
// Status Queries
// ============================================================================

/**
 * Get all MCP servers from a native config.
 */
export async function getMcpServers(
  target: TargetName,
  configPath: string
): Promise<Record<string, { enabled: boolean; recipe?: McpRecipe }>> {
  const result = await readNativeConfig(target, configPath);

  if (!result.config) {
    return {};
  }

  switch (target) {
    case 'claude': {
      const config = result.config as ClaudeMcpConfig;
      const servers: Record<string, { enabled: boolean; recipe: McpRecipe }> = {};
      for (const [name, server] of Object.entries(config.mcpServers)) {
        servers[name] = {
          enabled: true,
          recipe: {
            command: server.command,
            args: server.args ?? [],
            env: server.env,
          },
        };
      }
      return servers;
    }

    case 'codex': {
      const config = result.config as CodexConfig;
      const servers: Record<string, { enabled: boolean; recipe?: McpRecipe }> = {};
      if (config.mcp_servers) {
        for (const [name, server] of Object.entries(config.mcp_servers)) {
          servers[name] = {
            enabled: server.enabled !== false,
            recipe: server.enabled !== false ? {
              command: server.command,
              args: server.args ?? [],
              env: server.env,
            } : undefined,
          };
        }
      }
      return servers;
    }

    case 'gemini': {
      const config = result.config as GeminiSettings;
      const servers: Record<string, { enabled: boolean; recipe?: McpRecipe }> = {};
      if (config.mcpServers) {
        for (const [name, server] of Object.entries(config.mcpServers)) {
          servers[name] = {
            enabled: server.enabled !== false,
            recipe: server.enabled !== false && server.command ? {
              command: server.command,
              args: server.args ?? [],
            } : undefined,
          };
        }
      }
      return servers;
    }
  }
}
