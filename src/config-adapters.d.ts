import type { TargetName, McpRecipe, ConfigReadResult } from './types.js';
/**
 * Read and parse a native config file for a target.
 */
export declare function readNativeConfig(target: TargetName, configPath: string): Promise<ConfigReadResult<any>>;
/**
 * Write a native config file atomically.
 */
export declare function writeNativeConfig(target: TargetName, configPath: string, config: any): Promise<void>;
/**
 * Add an MCP server to a native config.
 */
export declare function addMcpToConfig(target: TargetName, configPath: string, serverName: string, recipe: McpRecipe): Promise<void>;
/**
 * Remove an MCP server from a native config.
 */
export declare function removeMcpFromConfig(target: TargetName, configPath: string, serverName: string): Promise<void>;
/**
 * Enable an MCP server in a native config.
 */
export declare function enableMcpInConfig(target: TargetName, configPath: string, serverName: string): Promise<void>;
/**
 * Disable an MCP server in a native config.
 */
export declare function disableMcpInConfig(target: TargetName, configPath: string, serverName: string): Promise<void>;
/**
 * Get all MCP servers from a native config.
 */
export declare function getMcpServers(target: TargetName, configPath: string): Promise<Record<string, {
    enabled: boolean;
    recipe?: McpRecipe;
}>>;
