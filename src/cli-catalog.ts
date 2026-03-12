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

  const ID_WIDTH = 45;
  const NAME_WIDTH = 19;
  const DESC_WIDTH = 30;

  const borderH = '┌' + '─'.repeat(ID_WIDTH + 2) + '┬' + '─'.repeat(NAME_WIDTH + 2) + '┬' + '─'.repeat(DESC_WIDTH + 2) + '┐';
  const borderM = '├' + '─'.repeat(ID_WIDTH + 2) + '┼' + '─'.repeat(NAME_WIDTH + 2) + '┼' + '─'.repeat(DESC_WIDTH + 2) + '┤';
  const borderF = '└' + '─'.repeat(ID_WIDTH + 2) + '┴' + '─'.repeat(NAME_WIDTH + 2) + '┴' + '─'.repeat(DESC_WIDTH + 2) + '┘';

  console.log(borderH);
  console.log('│ ' + padRight('ID', ID_WIDTH) + ' │ ' + padRight('Display Name', NAME_WIDTH) + ' │ ' + padRight('Description', DESC_WIDTH) + ' │');
  console.log(borderM);

  for (const entry of entries) {
    const id = truncate(entry.id, ID_WIDTH);
    const name = padRight(entry.displayName, NAME_WIDTH);
    const desc = truncate(entry.description, DESC_WIDTH);
    console.log('│ ' + padRight(id, ID_WIDTH) + ' │ ' + name + ' │ ' + padRight(desc, DESC_WIDTH) + ' │');
  }

  console.log(borderF);
  console.log();
  console.log('Run `acsync catalog mcp show <id>` for details.');
}

function truncate(str: string, maxLen: number): string {
  if (str.length > maxLen) {
    return str.slice(0, maxLen - 1) + '…';
  }
  return str;
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

  if (entry.recipe.url) {
    console.log(`    Transport: http`);
    console.log(`    URL: ${entry.recipe.url}`);
  } else if (entry.recipe.command) {
    console.log(`    Transport: stdio`);
    console.log(`    Command: ${entry.recipe.command}`);
    if (entry.recipe.args && entry.recipe.args.length > 0) {
      console.log(`    Args: ${JSON.stringify(entry.recipe.args)}`);
    }
    if (entry.recipe.cwd) {
      console.log(`    CWD: ${entry.recipe.cwd}`);
    }
  } else {
    console.log(`    Transport: (none)`);
  }

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
  url?: string;
  cwd?: string;
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

  // Build recipe
  const recipe: { command?: string; args?: string[]; url?: string; cwd?: string; env?: Record<string, string> } = {};

  if (options.url) {
    recipe.url = options.url;
  } else if (options.command) {
    recipe.command = options.command;
    recipe.args = options.args ?? [];
    recipe.cwd = options.cwd;
  }

  if (options.env) {
    recipe.env = options.env;
  }

  // Build entry
  const entry = normalizeMcpPackage(options.packageId, {
    displayName: options.displayName,
    description: options.description,
    ...(Object.keys(recipe).length > 0 ? { recipe } : {}),
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

// ============================================================================
// Skill Catalog Commands
// ============================================================================

/**
 * List all skill entries in the catalog.
 */
export async function catalogSkillList(): Promise<void> {
  const { listSkills } = await import('./catalog.js');
  const entries = await listSkills();

  if (entries.length === 0) {
    console.log('No skill entries in catalog.\n');
    console.log('Run `acsync catalog skill add <name>` to add an entry.');
    return;
  }

  console.log(`Skill Catalog (${entries.length} entries):\n`);

  const ID_WIDTH = 45;
  const NAME_WIDTH = 19;
  const DESC_WIDTH = 30;

  const borderH = '┌' + '─'.repeat(ID_WIDTH + 2) + '┬' + '─'.repeat(NAME_WIDTH + 2) + '┬' + '─'.repeat(DESC_WIDTH + 2) + '┐';
  const borderM = '├' + '─'.repeat(ID_WIDTH + 2) + '┼' + '─'.repeat(NAME_WIDTH + 2) + '┼' + '─'.repeat(DESC_WIDTH + 2) + '┤';
  const borderF = '└' + '─'.repeat(ID_WIDTH + 2) + '┴' + '─'.repeat(NAME_WIDTH + 2) + '┴' + '─'.repeat(DESC_WIDTH + 2) + '┘';

  console.log(borderH);
  console.log('│ ' + padRight('ID', ID_WIDTH) + ' │ ' + padRight('Display Name', NAME_WIDTH) + ' │ ' + padRight('Description', DESC_WIDTH) + ' │');
  console.log(borderM);

  for (const entry of entries) {
    const id = truncate(entry.id, ID_WIDTH);
    const name = padRight(entry.displayName, NAME_WIDTH);
    const desc = truncate(entry.description, DESC_WIDTH);
    console.log('│ ' + padRight(id, ID_WIDTH) + ' │ ' + name + ' │ ' + padRight(desc, DESC_WIDTH) + ' │');
  }

  console.log(borderF);
  console.log();
  console.log('Run `acsync catalog skill show <id>` for details.');
}

// ============================================================================
// Show Command
// ============================================================================

/**
 * Show details of a specific skill catalog entry.
 */
export async function catalogSkillShow(id: string): Promise<void> {
  const { getSkill } = await import('./catalog.js');
  const entry = await getSkill(id);

  if (!entry) {
    console.error(`Skill entry not found: ${id}\n`);
    console.log('Run `acsync catalog skill list` to see available entries.');
    process.exitCode = 1;
    return;
  }

  console.log(`Skill Entry: ${entry.id}\n`);
  console.log(`  Display Name: ${entry.displayName}`);
  console.log(`  Description: ${entry.description}`);
  console.log(`  Content:\n`);

  // Show preview of skill content
  const lines = entry.recipe.content.split('\n');
  const previewLines = lines.slice(0, 20); // Show first 20 lines
  console.log(previewLines.join('\n'));

  if (lines.length > 20) {
    console.log(`\n... (${lines.length - 20} more lines)`);
  }

  console.log(`\n  Added: ${entry.addedAt}`);
  if (entry.tags && entry.tags.length > 0) {
    console.log(`  Tags: ${entry.tags.join(', ')}`);
  }
  console.log();
}

// ============================================================================
// Add Command
// ============================================================================

export interface CatalogSkillAddOptions {
  skillId: string;
  file?: string;
  displayName?: string;
  description?: string;
}

/**
 * Add a skill entry to the catalog.
 */
export async function catalogSkillAdd(options: CatalogSkillAddOptions): Promise<void> {
  const { getSkill, normalizeSkillPackage, addSkill } = await import('./catalog.js');
  const fs = await import('node:fs/promises');

  // Check if already exists
  const existing = await getSkill(options.skillId);
  if (existing) {
    console.error(`Skill entry already exists: ${options.skillId}\n`);
    console.log('Use `acsync skill add` to add it to your project.');
    process.exitCode = 1;
    return;
  }

  // Read skill content from file or create default
  let content: string;
  if (options.file) {
    content = await fs.readFile(options.file, 'utf8');
  } else {
    content = `---
name: ${options.skillId}
description: ${options.description || `Skill: ${options.skillId}`}
---

# ${options.displayName || options.skillId}

Skill content for ${options.skillId}.
`;
  }

  // Build entry
  const entry = normalizeSkillPackage(options.skillId, content, {
    displayName: options.displayName,
    description: options.description,
  });

  await addSkill(entry);
  console.log(`Added to catalog: ${entry.id}\n`);
  console.log('Run `acsync skill add <name>` to add it to your project.');
}

// ============================================================================
// Remove Command
// ============================================================================

/**
 * Remove a skill entry from the catalog.
 */
export async function catalogSkillRemove(id: string): Promise<void> {
  const { removeSkill } = await import('./catalog.js');
  const removed = await removeSkill(id);

  if (!removed) {
    console.error(`Skill entry not found: ${id}\n`);
    console.log('Run `acsync catalog skill list` to see available entries.');
    process.exitCode = 1;
    return;
  }

  console.log(`Removed from catalog: ${id}\n`);
}
