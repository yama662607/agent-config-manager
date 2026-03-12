import fs from 'node:fs/promises';
import path from 'node:path';
import TOML from '@iarna/toml';
// ============================================================================
// Config Reading
// ============================================================================
/**
 * Read and parse a native config file for a target.
 */
export async function readNativeConfig(target, configPath) {
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
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return { config: null, exists: false };
        }
        throw error;
    }
}
function parseClaudeConfig(raw) {
    try {
        const config = JSON.parse(raw);
        return { config, exists: true };
    }
    catch {
        return { config: null, exists: true, raw };
    }
}
function parseCodexConfig(raw) {
    try {
        const config = TOML.parse(raw);
        return { config, exists: true };
    }
    catch {
        return { config: null, exists: true, raw };
    }
}
function parseGeminiConfig(raw) {
    try {
        const config = JSON.parse(raw);
        return { config, exists: true };
    }
    catch {
        return { config: null, exists: true, raw };
    }
}
// ============================================================================
// Config Writing
// ============================================================================
/**
 * Write a native config file atomically.
 */
export async function writeNativeConfig(target, configPath, config) {
    const tempPath = `${configPath}.tmp`;
    let content;
    switch (target) {
        case 'claude':
            content = JSON.stringify(config, null, 2);
            break;
        case 'codex':
            content = TOML.stringify(config);
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
export async function addMcpToConfig(target, configPath, serverName, recipe) {
    const result = await readNativeConfig(target, configPath);
    let config;
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
export async function removeMcpFromConfig(target, configPath, serverName) {
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
export async function enableMcpInConfig(target, configPath, serverName) {
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
export async function disableMcpInConfig(target, configPath, serverName) {
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
async function addMcpServer(target, config, serverName, recipe) {
    switch (target) {
        case 'claude': {
            const server = {};
            if (recipe.url) {
                server.httpUrl = recipe.url;
            }
            else if (recipe.command) {
                server.command = recipe.command;
                if (recipe.args)
                    server.args = recipe.args;
            }
            if (recipe.env)
                server.env = recipe.env;
            config.mcpServers[serverName] = server;
            break;
        }
        case 'codex': {
            const server = { enabled: true };
            if (recipe.url) {
                server.httpUrl = recipe.url;
            }
            else if (recipe.command) {
                server.command = recipe.command;
                if (recipe.args)
                    server.args = recipe.args;
            }
            if (recipe.cwd)
                server.cwd = recipe.cwd;
            if (recipe.env)
                server.env = recipe.env;
            config.mcp_servers[serverName] = server;
            break;
        }
        case 'gemini': {
            const server = { enabled: true };
            if (recipe.url) {
                server.url = recipe.url;
            }
            else if (recipe.command) {
                server.command = recipe.command;
                if (recipe.args)
                    server.args = recipe.args;
            }
            if (recipe.cwd)
                server.cwd = recipe.cwd;
            config.mcpServers[serverName] = server;
            break;
        }
    }
}
async function removeMcpServer(target, config, serverName) {
    switch (target) {
        case 'claude':
            delete config.mcpServers[serverName];
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
async function setMcpEnabled(target, config, serverName, enabled) {
    switch (target) {
        case 'claude':
            // Claude doesn't have enabled flag - remove when disabled
            if (!enabled) {
                delete config.mcpServers[serverName];
            }
            break;
        case 'codex':
            if (config.mcp_servers?.[serverName]) {
                config.mcp_servers[serverName].enabled = enabled;
            }
            break;
        case 'gemini':
            if (config.mcpServers?.[serverName]) {
                config.mcpServers[serverName].enabled = enabled;
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
export async function getMcpServers(target, configPath) {
    const result = await readNativeConfig(target, configPath);
    if (!result.config) {
        return {};
    }
    switch (target) {
        case 'claude': {
            const config = result.config;
            const servers = {};
            for (const [name, server] of Object.entries(config.mcpServers)) {
                const recipe = {};
                if (server.httpUrl) {
                    recipe.url = server.httpUrl;
                    recipe.transport = 'http';
                }
                else if (server.command) {
                    recipe.command = server.command;
                    recipe.args = server.args ?? [];
                    recipe.transport = 'stdio';
                }
                if (server.env)
                    recipe.env = server.env;
                servers[name] = {
                    enabled: true,
                    recipe,
                };
            }
            return servers;
        }
        case 'codex': {
            const config = result.config;
            const servers = {};
            if (config.mcp_servers) {
                for (const [name, server] of Object.entries(config.mcp_servers)) {
                    const recipe = {};
                    if (server.httpUrl) {
                        recipe.url = server.httpUrl;
                        recipe.transport = 'http';
                    }
                    else if (server.command) {
                        recipe.command = server.command;
                        recipe.args = server.args ?? [];
                        recipe.transport = 'stdio';
                    }
                    if (server.cwd)
                        recipe.cwd = server.cwd;
                    if (server.env)
                        recipe.env = server.env;
                    servers[name] = {
                        enabled: server.enabled !== false,
                        recipe: server.enabled !== false ? recipe : undefined,
                    };
                }
            }
            return servers;
        }
        case 'gemini': {
            const config = result.config;
            const servers = {};
            if (config.mcpServers) {
                for (const [name, server] of Object.entries(config.mcpServers)) {
                    const recipe = {};
                    if (server.url) {
                        recipe.url = server.url;
                        recipe.transport = 'http';
                    }
                    else if (server.command) {
                        recipe.command = server.command;
                        recipe.args = server.args ?? [];
                        recipe.transport = 'stdio';
                    }
                    if (server.cwd)
                        recipe.cwd = server.cwd;
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
//# sourceMappingURL=config-adapters.js.map