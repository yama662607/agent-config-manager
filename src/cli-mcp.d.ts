import type { TargetName } from './types.js';
/**
 * Show MCP status for the current project.
 */
export declare function mcpStatus(verbose?: boolean): Promise<void>;
export interface McpAddOptions {
    packageId: string;
    targets: TargetName[];
    noRegister: boolean;
}
/**
 * Add an MCP server to the current project.
 */
export declare function mcpAdd(options: McpAddOptions): Promise<void>;
export interface McpRemoveOptions {
    serverName: string;
    targets: TargetName[];
}
/**
 * Remove an MCP server from the current project.
 */
export declare function mcpRemove(options: McpRemoveOptions): Promise<void>;
export interface McpEnableOptions {
    serverName: string;
    targets: TargetName[];
}
/**
 * Enable an MCP server in the current project.
 */
export declare function mcpEnable(options: McpEnableOptions): Promise<void>;
export interface McpDisableOptions {
    serverName: string;
    targets: TargetName[];
}
/**
 * Disable an MCP server in the current project.
 */
export declare function mcpDisable(options: McpDisableOptions): Promise<void>;
