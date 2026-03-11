import type { McpCatalogEntry } from './types.js';
import {
  getMcp,
  listMcps,
  addMcp,
  removeMcp,
  normalizeMcpPackage,
} from './catalog.js';

// ============================================================================
// List Command
// ============================================================================

/**
 * List all MCP entries in the catalog.
 */
export async function catalogMcpList(): Promise<void> {
  const entries = await listMcps();

  if (entries.length === 0) {
    console.log('No MCP entries in catalog.\n');
    console.log('Run `acsync catalog mcp add <package>` to add an entry.');
    return;
  }

  console.log(`MCP Catalog (${entries.length} entries):\n`);

  console.log('┌──────────────────────────────┬─────────────────────┬──────────────────────────────────────┐');
  console.log('│ ID                           │ Display Name        │ Description                            │');
  console.log('├──────────────────────────────┼─────────────────────┼──────────────────────────────────────┤');

  for (const entry of entries) {
    const id = padRight(entry.id.slice(0, 28), 28);
    const name = padRight(entry.displayName.slice(0, 19), 19);
    const desc = padRight(entry.description.slice(0, 38), 38);
    console.log(`│ ${id} │ ${name} │ ${desc} │`);
  }

  console.log('└──────────────────────────────┴─────────────────────┴──────────────────────────────────────┘');
  console.log();
  console.log('Run `acsync catalog mcp show <id>` for details.');
}

function padRight(str: string, len: number): string {
  return str.padEnd(len, ' ');
}

// ============================================================================
// Show Command
// ============================================================================

/**
 * Show details of a specific catalog entry.
 */
export async function catalogMcpShow(id: string): Promise<void> {
  const entry = await getMcp(id);

  if (!entry) {
    console.error(`MCP entry not found: ${id}\n`);
    console.log('Run `acsync catalog mcp list` to see available entries.');
    process.exitCode = 1;
    return;
  }

  console.log(`MCP Entry: ${entry.id}\n`);
  console.log(`  Display Name: ${entry.displayName}`);
  console.log(`  Description: ${entry.description}`);
  console.log(`  Recipe:`);
  console.log(`    Command: ${entry.recipe.command}`);
  console.log(`    Args: ${JSON.stringify(entry.recipe.args)}`);
  if (entry.recipe.env && Object.keys(entry.recipe.env).length > 0) {
    console.log(`    Env: ${JSON.stringify(entry.recipe.env)}`);
  }
  console.log(`  Added: ${entry.addedAt}`);
  if (entry.tags && entry.tags.length > 0) {
    console.log(`  Tags: ${entry.tags.join(', ')}`);
  }
  console.log();
}

// ============================================================================
// Add Command
// ============================================================================

export interface CatalogMcpAddOptions {
  packageId: string;
  displayName?: string;
  description?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Add an MCP entry to the catalog.
 */
export async function catalogMcpAdd(options: CatalogMcpAddOptions): Promise<void> {
  // Check if already exists
  const existing = await getMcp(options.packageId);
  if (existing) {
    console.error(`MCP entry already exists: ${options.packageId}\n`);
    console.log('Use `acsync catalog mcp edit` to modify the entry.');
    process.exitCode = 1;
    return;
  }

  // Build entry
  const entry = normalizeMcpPackage(options.packageId, {
    displayName: options.displayName,
    description: options.description,
    ...(options.command && {
      recipe: {
        command: options.command,
        args: options.args ?? [],
        env: options.env ?? {},
      },
    }),
  });

  await addMcp(entry);
  console.log(`Added to catalog: ${entry.id}\n`);
  console.log('Run `acsync mcp add <package>` to add it to your project.');
}

// ============================================================================
// Remove Command
// ============================================================================

/**
 * Remove an MCP entry from the catalog.
 */
export async function catalogMcpRemove(id: string): Promise<void> {
  const removed = await removeMcp(id);

  if (!removed) {
    console.error(`MCP entry not found: ${id}\n`);
    console.log('Run `acsync catalog mcp list` to see available entries.');
    process.exitCode = 1;
    return;
  }

  console.log(`Removed from catalog: ${id}\n`);
}
