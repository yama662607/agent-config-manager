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
// Validation
// ============================================================================

/** Valid MCP server name pattern (allows npm scoped packages like @scope/package) */
const SERVER_NAME_PATTERN = /^(@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+$/;

/** Valid command pattern: basename only, no path separators (except npx, node, etc.) */
const COMMAND_PATTERN = /^[a-zA-Z0-9._-]+$/;

/**
 * Validate MCP server name.
 * Allows npm scoped packages like @scope/package-name.
 */
function validateServerName(serverName: string): void {
  if (!serverName || serverName.length === 0 || serverName.length > 150) {
    throw new Error('Server name must be 1-150 characters');
  }

  if (!SERVER_NAME_PATTERN.test(serverName)) {
    throw new Error('Server name must contain only alphanumeric characters, hyphens, underscores, dots, and optional @scope/ prefix');
  }

  if (serverName.includes('..') || serverName.includes('\\')) {
    throw new Error('Server name cannot contain path traversal characters');
  }
}

/**
 * Validate MCP command to prevent command injection.
 * Only allows simple command names without paths or shell metacharacters.
 */
function validateCommand(command: string): void {
  if (!command || command.length === 0 || command.length > 200) {
    throw new Error('Command must be 1-200 characters');
  }

  // Check for shell metacharacters
  const dangerousChars = /[;&|`$()<>]/;
  if (dangerousChars.test(command)) {
    throw new Error('Command cannot contain shell metacharacters');
  }

  // For commands with paths, allow common safe prefixes
  if (command.includes('/') || command.includes('\\')) {
    // Only allow specific safe paths
    const allowedPaths = [
      /^npx$/,
      /^npm$/,
      /^node$/,
      /^python$/,
      /^python3$/,
      /^\.\/[a-zA-Z0-9._-]+$/,  // Current directory relative
      /^\.\.\/[a-zA-Z0-9._-]+$/, // Parent directory relative (risky but needed)
    ];

    const isAllowed = allowedPaths.some(pattern => pattern.test(command));
    if (!isAllowed) {
      throw new Error('Command path not allowed. Use npx, npm, node, or relative paths like ./command');
    }
  }
}

/**
 * Validate MCP arguments.
 */
function validateArgs(args: string[]): void {
  for (const arg of args) {
    if (arg.length > 500) {
      throw new Error('Argument too long');
    }

    // Check for shell metacharacters that could escape the argument
    if (/[;&|`$()]/.test(arg)) {
      throw new Error('Arguments cannot contain shell metacharacters');
    }
  }
}

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
  // Validate server name
  validateServerName(serverName);

  // Validate recipe content
  if (recipe.command) {
    validateCommand(recipe.command);
  }
  if (recipe.args && recipe.args.length > 0) {
    validateArgs(recipe.args);
  }
  if (recipe.url) {
    // Basic URL validation - ensure it starts with http:// or https://
    try {
      const url = new URL(recipe.url);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('URL must use http or https protocol');
      }
    } catch {
      throw new Error('Invalid URL format');
    }
  }

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
  validateServerName(serverName);

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
  validateServerName(serverName);

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
  validateServerName(serverName);

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
    case 'claude': {
      const server: ClaudeMcpServer = {};
      if (recipe.url) {
        server.httpUrl = recipe.url;
      } else if (recipe.command) {
        server.command = recipe.command;
        if (recipe.args) server.args = recipe.args;
      }
      if (recipe.env) server.env = recipe.env;
      (config as ClaudeMcpConfig).mcpServers[serverName] = server;
      break;
    }

    case 'codex': {
      const server: CodexMcpServer = { enabled: true };
      if (recipe.url) {
        server.httpUrl = recipe.url;
      } else if (recipe.command) {
        server.command = recipe.command;
        if (recipe.args) server.args = recipe.args;
      }
      if (recipe.cwd) server.cwd = recipe.cwd;
      if (recipe.env) server.env = recipe.env;
      (config as CodexConfig).mcp_servers![serverName] = server;
      break;
    }

    case 'gemini': {
      const server: GeminiMcpServer = {};
      if (recipe.url) {
        server.url = recipe.url;
      } else if (recipe.command) {
        server.command = recipe.command;
        if (recipe.args) server.args = recipe.args;
      }
      if (recipe.cwd) server.cwd = recipe.cwd;
      (config as GeminiSettings).mcpServers![serverName] = server;
      break;
    }
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
      // Gemini doesn't support enabled flag - remove when disabled
      if (!enabled) {
        delete (config as GeminiMcpConfig).mcpServers[serverName];
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
        const recipe: McpRecipe = {};
        if (server.httpUrl) {
          recipe.url = server.httpUrl;
          recipe.transport = 'http';
        } else if (server.command) {
          recipe.command = server.command;
          recipe.args = server.args ?? [];
          recipe.transport = 'stdio';
        }
        if (server.env) recipe.env = server.env;
        servers[name] = {
          enabled: true,
          recipe,
        };
      }
      return servers;
    }

    case 'codex': {
      const config = result.config as CodexConfig;
      const servers: Record<string, { enabled: boolean; recipe?: McpRecipe }> = {};
      if (config.mcp_servers) {
        for (const [name, server] of Object.entries(config.mcp_servers)) {
          const recipe: McpRecipe = {};
          if (server.httpUrl) {
            recipe.url = server.httpUrl;
            recipe.transport = 'http';
          } else if (server.command) {
            recipe.command = server.command;
            recipe.args = server.args ?? [];
            recipe.transport = 'stdio';
          }
          if (server.cwd) recipe.cwd = server.cwd;
          if (server.env) recipe.env = server.env;
          servers[name] = {
            enabled: server.enabled !== false,
            recipe: server.enabled !== false ? recipe : undefined,
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
          const recipe: McpRecipe = {};
          if (server.url) {
            recipe.url = server.url;
            recipe.transport = 'http';
          } else if (server.command) {
            recipe.command = server.command;
            recipe.args = server.args ?? [];
            recipe.transport = 'stdio';
          }
          if (server.cwd) recipe.cwd = server.cwd;
          servers[name] = {
            enabled: server.enabled !== false,
            recipe: server.enabled !== false && (server.url || server.command) ? recipe : undefined,
          };
        }
      }
      return servers;
    }
  }
}
