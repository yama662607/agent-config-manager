import type { CatalogFile, McpCatalogEntry } from './types.js';
/**
 * Get the catalog directory path for the current platform.
 */
export declare function getCatalogDir(): string;
/**
 * Get the catalog file path.
 */
export declare function getCatalogPath(): string;
/**
 * Get the catalog schema file path.
 */
export declare function getCatalogSchemaPath(): string;
/**
 * Get the catalog lock file path.
 */
export declare function getCatalogLockPath(): string;
/**
 * Initialize an empty catalog if it doesn't exist.
 */
export declare function initCatalog(): Promise<void>;
/**
 * Load the catalog from disk.
 */
export declare function loadCatalog(): Promise<CatalogFile>;
/**
 * List all MCP entries in the catalog.
 */
export declare function listMcps(): Promise<McpCatalogEntry[]>;
/**
 * Get a specific MCP entry by ID.
 */
export declare function getMcp(id: string): Promise<McpCatalogEntry | null>;
/**
 * Add or update an MCP entry in the catalog.
 */
export declare function addMcp(entry: McpCatalogEntry): Promise<void>;
/**
 * Remove an MCP entry from the catalog.
 */
export declare function removeMcp(id: string): Promise<boolean>;
/**
 * Normalize an MCP package identifier into a catalog entry.
 */
export declare function normalizeMcpPackage(packageId: string, catalogEntry?: Partial<McpCatalogEntry>): McpCatalogEntry;
