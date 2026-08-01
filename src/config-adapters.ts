import fs from 'node:fs/promises';
import path from 'node:path';
import * as TOML from 'smol-toml';
import { normalizeEnvMap, validateEnvMap } from './mcp-env.js';
import type {
  TargetName,
  ClaudeMcpConfig,
  ClaudeMcpServer,
  CodexConfig,
  CodexMcpServer,
  AntigravitySettings,
  AntigravityMcpServer,
  GrokConfig,
  GrokMcpServer,
  McpRecipe,
  ConfigReadResult,
} from './types.js';

// ============================================================================
// Validation
// ============================================================================

/** Valid MCP server name pattern (allows npm scoped packages like @scope/package) */
const SERVER_NAME_PATTERN = /^(@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+$/;
/** Codex mcp_servers table keys must be simple identifiers. */
const CODEX_SERVER_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

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

function validateRecipe(recipe: McpRecipe): void {
  if (recipe.command) {
    validateCommand(recipe.command);
  }
  if (recipe.args && recipe.args.length > 0) {
    validateArgs(recipe.args);
  }
  if (recipe.url) {
    try {
      const url = new URL(recipe.url);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('URL must use http or https protocol');
      }
    } catch {
      throw new Error('Invalid URL format');
    }
  }
  validateEnvMap(recipe.env);
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
      case 'antigravity':
        return parseAntigravityConfig(raw);
      case 'grok':
        return parseGrokConfig(raw);
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

function parseAntigravityConfig(raw: string): ConfigReadResult<AntigravitySettings> {
  try {
    const config = JSON.parse(raw) as AntigravitySettings;
    return { config, exists: true };
  } catch {
    return { config: null, exists: true, raw };
  }
}

function parseGrokConfig(raw: string): ConfigReadResult<GrokConfig> {
  try {
    const config = TOML.parse(raw) as GrokConfig;
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
    case 'antigravity':
      content = JSON.stringify(config, null, 2);
      break;
    case 'grok':
      content = TOML.stringify(config as any);
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
): Promise<string> {
  // Validate server name
  validateServerName(serverName);
  validateRecipe(recipe);

  const result = await readNativeConfig(target, configPath);

  let config: any;
  switch (target) {
    case 'claude':
      config = result.config ?? { mcpServers: {} };
      break;
    case 'codex':
      config = result.config ?? { mcp_servers: {} };
      break;
    case 'antigravity':
      config = result.config ?? { mcpServers: {} };
      break;
    case 'grok':
      config = result.config ?? { mcp_servers: {} };
      break;
  }

  const actualServerName = await addMcpServer(target, config, serverName, recipe);
  await writeNativeConfig(target, configPath, config);
  return actualServerName;
}

export async function updateMcpInConfig(
  target: TargetName,
  configPath: string,
  serverName: string,
  recipe: McpRecipe
): Promise<string> {
  validateServerName(serverName);

  const result = await readNativeConfig(target, configPath);
  const existingServers = await getMcpServers(target, configPath);
  const existingRecipe = existingServers[serverName]?.recipe;
  const mergedRecipe: McpRecipe = {
    ...(existingRecipe ?? {}),
    ...recipe,
    env: recipe.env ?? existingRecipe?.env,
  };
  validateRecipe(mergedRecipe);

  let config: any;
  switch (target) {
    case 'claude':
      config = result.config ?? { mcpServers: {} };
      break;
    case 'codex':
      config = result.config ?? { mcp_servers: {} };
      break;
    case 'antigravity':
      config = result.config ?? { mcpServers: {} };
      break;
    case 'grok':
      config = result.config ?? { mcp_servers: {} };
      break;
  }

  const actualServerName = await addMcpServer(target, config, serverName, mergedRecipe);
  await writeNativeConfig(target, configPath, config);
  return actualServerName;
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
): Promise<string> {
  switch (target) {
    case 'claude': {
      const server: ClaudeMcpServer = {};
      if (recipe.url) {
        server.type = 'http';
        server.url = recipe.url;
      } else if (recipe.command) {
        server.type = 'stdio';
        server.command = recipe.command;
        if (recipe.args) server.args = recipe.args;
      }
      const claudeEnv = normalizeEnvMap(recipe.env);
      if (claudeEnv) server.env = claudeEnv;
      
      if (!config.mcpServers) config.mcpServers = {};
      (config as ClaudeMcpConfig).mcpServers[serverName] = server;
      return serverName;
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
      const codexEnv = normalizeEnvMap(recipe.env);
      if (codexEnv) server.env = codexEnv;

      const codexServerName = getTomlServerKey(config as CodexConfig, serverName);
      if (!config.mcp_servers) config.mcp_servers = {};
      (config as CodexConfig).mcp_servers![codexServerName] = server;
      return codexServerName;
    }

    case 'grok': {
      const server: GrokMcpServer = { enabled: true };
      if (recipe.url) {
        server.url = recipe.url;
      } else if (recipe.command) {
        server.command = recipe.command;
        if (recipe.args) server.args = recipe.args;
      }
      const grokEnv = normalizeEnvMap(recipe.env);
      if (grokEnv) server.env = grokEnv;

      const grokServerName = getTomlServerKey(config as GrokConfig, serverName);
      if (!config.mcp_servers) config.mcp_servers = {};
      (config as GrokConfig).mcp_servers![grokServerName] = server;
      return grokServerName;
    }

    case 'antigravity': {
      const server: AntigravityMcpServer = {};
      if (recipe.url) {
        server.serverUrl = recipe.url;
      } else if (recipe.command) {
        server.command = recipe.command;
        if (recipe.args) server.args = recipe.args;
      }
      if (recipe.cwd) server.cwd = recipe.cwd;
      const antigravityEnv = normalizeEnvMap(recipe.env);
      if (antigravityEnv) server.env = antigravityEnv;
      
      if (!config.mcpServers) config.mcpServers = {};
      (config as AntigravitySettings).mcpServers![serverName] = server;
      return serverName;
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

    case 'codex': {
      const codexServerName = resolveTomlServerKey(config as CodexConfig, serverName);
      if (config.mcp_servers && codexServerName) {
        delete config.mcp_servers[codexServerName];
      }
      break;
    }

    case 'grok': {
      const grokServerName = resolveTomlServerKey(config as GrokConfig, serverName);
      if (config.mcp_servers && grokServerName) {
        delete config.mcp_servers[grokServerName];
      }
      break;
    }

    case 'antigravity':
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

    case 'codex': {
      const codexServerName = resolveTomlServerKey(config as CodexConfig, serverName);
      if (codexServerName && config.mcp_servers?.[codexServerName]) {
        (config.mcp_servers[codexServerName] as CodexMcpServer).enabled = enabled;
      }
      break;
    }

    case 'grok': {
      const grokServerName = resolveTomlServerKey(config as GrokConfig, serverName);
      if (grokServerName && config.mcp_servers?.[grokServerName]) {
        (config.mcp_servers[grokServerName] as GrokMcpServer).enabled = enabled;
      }
      break;
    }

    case 'antigravity':
      // Antigravity doesn't support enabled flag - remove when disabled
      if (!enabled) {
        delete (config as AntigravitySettings).mcpServers?.[serverName];
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
        if (server.url) {
          recipe.url = server.url;
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
          const resolvedName = inferCanonicalServerName(name, server);
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
          servers[resolvedName] = {
            enabled: server.enabled !== false,
            recipe: server.enabled !== false ? recipe : undefined,
          };
        }
      }
      return servers;
    }

    case 'grok': {
      const config = result.config as GrokConfig;
      const servers: Record<string, { enabled: boolean; recipe?: McpRecipe }> = {};
      if (config.mcp_servers) {
        for (const [name, server] of Object.entries(config.mcp_servers)) {
          const resolvedName = inferCanonicalServerName(name, server);
          const recipe: McpRecipe = {};
          if (server.url) {
            recipe.url = server.url;
            recipe.transport = 'http';
          } else if (server.command) {
            recipe.command = server.command;
            recipe.args = server.args ?? [];
            recipe.transport = 'stdio';
          }
          if (server.env) recipe.env = server.env;
          servers[resolvedName] = {
            enabled: server.enabled !== false,
            recipe: server.enabled !== false ? recipe : undefined,
          };
        }
      }
      return servers;
    }

    case 'antigravity': {
      const config = result.config as AntigravitySettings;
      const servers: Record<string, { enabled: boolean; recipe?: McpRecipe }> = {};
      if (config.mcpServers) {
        for (const [name, server] of Object.entries(config.mcpServers)) {
          const recipe: McpRecipe = {};
          if (server.serverUrl) {
            recipe.url = server.serverUrl;
            recipe.transport = 'http';
          } else if (server.command) {
            recipe.command = server.command;
            recipe.args = server.args ?? [];
            recipe.transport = 'stdio';
          }
          if (server.cwd) recipe.cwd = server.cwd;
          if (server.env) recipe.env = server.env;
          servers[name] = {
            enabled: true,
            recipe,
          };
        }
      }
      return servers;
    }
  }
}

/** Codex and Grok both key MCP servers by a TOML table name under mcp_servers. */
type TomlMcpConfig = { mcp_servers?: Record<string, { command?: string; args?: string[] }> };

function inferCanonicalServerName(name: string, server: CodexMcpServer | GrokMcpServer): string {
  return inferPackageIdFromRecipe(server.command, server.args) ?? name;
}

function resolveTomlServerKey(config: TomlMcpConfig, requestedName: string): string | null {
  if (!config.mcp_servers) return null;
  if (config.mcp_servers[requestedName]) return requestedName;

  for (const [name, server] of Object.entries(config.mcp_servers)) {
    if (inferCanonicalServerName(name, server) === requestedName) {
      return name;
    }
  }

  return null;
}

function getTomlServerKey(config: TomlMcpConfig, serverName: string): string {
  const existing = resolveTomlServerKey(config, serverName);
  if (existing) {
    return existing;
  }

  const baseName = sanitizeTomlServerName(serverName);
  if (!config.mcp_servers?.[baseName]) {
    return baseName;
  }

  let suffix = 2;
  while (config.mcp_servers[`${baseName}_${suffix}`]) {
    suffix++;
  }

  return `${baseName}_${suffix}`;
}

function sanitizeTomlServerName(serverName: string): string {
  if (CODEX_SERVER_NAME_PATTERN.test(serverName)) {
    return serverName;
  }

  const packageName = serverName.split('/').pop() ?? serverName;
  const normalized = packageName
    .replace(/^server-/, '')
    .replace(/-mcp$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/-+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || 'server';
}

function inferPackageIdFromRecipe(command?: string, args?: string[]): string | null {
  if (!command || !args || args.length === 0) {
    return null;
  }

  if (!['npx', 'npm', 'pnpm', 'yarn', 'bunx'].includes(command)) {
    return null;
  }

  for (const arg of args) {
    if (arg.startsWith('-')) continue;
    if (arg === 'exec' || arg === 'dlx') continue;
    if (SERVER_NAME_PATTERN.test(arg)) {
      return arg;
    }
  }

  return null;
}
