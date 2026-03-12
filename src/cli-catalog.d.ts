/**
 * List all MCP entries in the catalog.
 */
export declare function catalogMcpList(): Promise<void>;
/**
 * Show details of a specific catalog entry.
 */
export declare function catalogMcpShow(id: string): Promise<void>;
export interface CatalogMcpAddOptions {
    packageId: string;
    displayName?: string;
    description?: string;
    command?: string;
    args?: string[];
    url?: string;
    cwd?: string;
    env?: Record<string, string>;
}
/**
 * Add an MCP entry to the catalog.
 */
export declare function catalogMcpAdd(options: CatalogMcpAddOptions): Promise<void>;
/**
 * Remove an MCP entry from the catalog.
 */
export declare function catalogMcpRemove(id: string): Promise<void>;
