import type { McpCatalogEntry } from './types.js';
import {
  getMcp,
  listMcps,
  addMcp,
  removeMcp,
  normalizeMcpPackage,
} from './catalog.js';
import { padRightWide, truncateWide } from './table-utils.js';

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
  const NAME_WIDTH = 25;
  const DESC_WIDTH = 35;

  const borderH = '┌' + '─'.repeat(ID_WIDTH + 2) + '┬' + '─'.repeat(NAME_WIDTH + 2) + '┬' + '─'.repeat(DESC_WIDTH + 2) + '┐';
  const borderM = '├' + '─'.repeat(ID_WIDTH + 2) + '┼' + '─'.repeat(NAME_WIDTH + 2) + '┼' + '─'.repeat(DESC_WIDTH + 2) + '┤';
  const borderF = '└' + '─'.repeat(ID_WIDTH + 2) + '┴' + '─'.repeat(NAME_WIDTH + 2) + '┴' + '─'.repeat(DESC_WIDTH + 2) + '┘';

  console.log(borderH);
  console.log('│ ' + padRightWide('ID', ID_WIDTH) + ' │ ' + padRightWide('Display Name', NAME_WIDTH) + ' │ ' + padRightWide('Description', DESC_WIDTH) + ' │');
  console.log(borderM);

  for (const entry of entries) {
    const id = truncateWide(entry.id, ID_WIDTH);
    const name = truncateWide(entry.displayName, NAME_WIDTH);
    const desc = truncateWide(entry.description, DESC_WIDTH);
    console.log('│ ' + padRightWide(id, ID_WIDTH) + ' │ ' + padRightWide(name, NAME_WIDTH) + ' │ ' + padRightWide(desc, DESC_WIDTH) + ' │');
  }

  console.log(borderF);
  console.log();
  console.log('Run `acsync catalog mcp show <id>` for details.');
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
// Install Command (from registry)
// ============================================================================

export interface CatalogSkillInstallOptions {
  skillId: string;
  force?: boolean;
}

/**
 * Install a skill from the skills.directory registry into the catalog.
 */
export async function catalogSkillInstall(options: CatalogSkillInstallOptions): Promise<void> {
  const { getSkillInfo, downloadSkillContent } = await import('./registry.js');

  console.log(`Fetching info for "${options.skillId}" from registry...`);

  const info = await getSkillInfo(options.skillId);

  if (!info) {
    console.error(`Skill not found in registry: ${options.skillId}\n`);
    console.log('Run `acsync catalog skill search <query>` to search the registry.');
    process.exitCode = 1;
    return;
  }

  // Display skill info
  console.log(`\nFound: ${info.name}`);
  console.log(`  Author: ${info.author}`);
  console.log(`  Description: ${info.description}`);
  console.log(`  Stars: ${info.stars}`);
  console.log(`  Repo: ${info.links.repo}`);

  // Download content
  console.log(`\nDownloading skill content...`);
  const content = await downloadSkillContent(info.links.skill_md);

  // Add to catalog
  const { normalizeSkillPackage, addSkill, getSkill } = await import('./catalog.js');

  const existing = await getSkill(options.skillId);
  if (existing && !options.force) {
    console.error(`Skill already exists in catalog: ${options.skillId}\n`);
    console.log('Use `acsync catalog skill install ' + options.skillId + ' --force` to reinstall.');
    process.exitCode = 1;
    return;
  }

  const entry = normalizeSkillPackage(info.name, content, {
    displayName: info.name,
    description: info.description,
  });

  await addSkill(entry, content);
  console.log(`\n✓ Added to catalog: ${entry.id}`);
  console.log('\nRun `acsync skill add ' + entry.id + '` to add it to your project.');
}

// ============================================================================
// Search Command
// ============================================================================

/**
 * Search the skills.directory registry for skills.
 */
export async function catalogSkillSearch(query: string): Promise<void> {
  const { searchSkills } = await import('./registry.js');

  console.log(`Searching registry for "${query}"...\n`);

  const results = await searchSkills(query);

  if (results.length === 0) {
    console.log('No skills found.\n');
    console.log('Try a different search term or visit https://skills.directory\n');
    return;
  }

  console.log(`Found ${results.length} skill(s):\n`);

  const NAME_WIDTH = 30;
  const AUTHOR_WIDTH = 15;
  const STARS_WIDTH = 8;

  const borderH = '┌' + '─'.repeat(NAME_WIDTH + 2) + '┬' + '─'.repeat(AUTHOR_WIDTH + 2) + '┬' + '─'.repeat(STARS_WIDTH + 2) + '┐';
  const borderM = '├' + '─'.repeat(NAME_WIDTH + 2) + '┼' + '─'.repeat(AUTHOR_WIDTH + 2) + '┼' + '─'.repeat(STARS_WIDTH + 2) + '┤';
  const borderF = '└' + '─'.repeat(NAME_WIDTH + 2) + '┴' + '─'.repeat(AUTHOR_WIDTH + 2) + '┴' + '─'.repeat(STARS_WIDTH + 2) + '┘';

  console.log(borderH);
  console.log('│ ' + padRightWide('Name', NAME_WIDTH) + ' │ ' + padRightWide('Author', AUTHOR_WIDTH) + ' │ ' + padRightWide('Stars', STARS_WIDTH) + ' │');
  console.log(borderM);

  for (const skill of results.slice(0, 20)) {
    const name = truncateWide(skill.name, NAME_WIDTH);
    const author = truncateWide(skill.author, AUTHOR_WIDTH);
    const stars = padRightWide('★ ' + formatNumber(skill.stars), STARS_WIDTH);

    console.log('│ ' + padRightWide(name, NAME_WIDTH) + ' │ ' + padRightWide(author, AUTHOR_WIDTH) + ' │ ' + stars + ' │');
  }

  console.log(borderF);

  if (results.length > 20) {
    console.log(`\n... and ${results.length - 20} more results`);
  }

  console.log(`\nRun \`acsync catalog skill install <name>\` to install a skill.`);
  console.log(`Visit https://skills.directory for more information.\n`);
}

function formatNumber(num: number): string {
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'k';
  }
  return num.toString();
}

// ============================================================================
// Import Command (import from local path)
// ============================================================================

/** Maximum size for skill files (1MB) */
const MAX_SKILL_FILE_SIZE = 1024 * 1024;

/**
 * Validate that a path doesn't escape the allowed base directory.
 */
function validatePath(resolvedPath: string, allowedBase: string): void {
  if (!resolvedPath.startsWith(allowedBase)) {
    throw new Error('Path must be within the allowed directory');
  }
}

export interface CatalogSkillImportOptions {
  path: string;
  skillId?: string;
  displayName?: string;
  description?: string;
}

/**
 * Import a skill from a local path into the catalog.
 */
export async function catalogSkillImport(options: CatalogSkillImportOptions): Promise<void> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { normalizeSkillPackage, addSkill, getSkill } = await import('./catalog.js');

  const skillPath = path.resolve(options.path);

  // Security: Validate path is within allowed directories
  const homeDir = path.join(path.resolve(process.env.HOME || '~'));
  const currentDir = path.resolve(process.cwd());
  const allowedBases = [homeDir, currentDir];

  if (!allowedBases.some(base => {
    try {
      validatePath(skillPath, base);
      return true;
    } catch {
      return false;
    }
  })) {
    console.error(`Invalid path: Path must be within home directory or current project\n`);
    process.exitCode = 1;
    return;
  }

  const skillMdPath = path.join(skillPath, 'SKILL.md');

  console.log(`Importing skill from: ${skillPath}`);

  // Check if SKILL.md exists and get stats
  let stats: import('fs').Stats;
  try {
    stats = await fs.stat(skillMdPath);
  } catch {
    console.error(`SKILL.md not found at: ${skillMdPath}\n`);
    console.log('Ensure the directory contains a SKILL.md file.');
    process.exitCode = 1;
    return;
  }

  // Security: Check file size
  if (stats.size > MAX_SKILL_FILE_SIZE) {
    console.error(`File too large: ${stats.size} bytes (max: ${MAX_SKILL_FILE_SIZE})\n`);
    process.exitCode = 1;
    return;
  }

  // Read skill content
  const content = await fs.readFile(skillMdPath, 'utf8');

  // Parse skill name from content or use provided name
  let skillId = options.skillId;
  if (!skillId) {
    const nameMatch = content.match(/^name:\s*(.+)$/m);
    if (nameMatch) {
      skillId = nameMatch[1].trim().replace(/^["']|["']$/g, '');
    } else {
      // Use directory name
      skillId = path.basename(skillPath);
    }
  }

  console.log(`  Skill name: ${skillId}`);

  // Check if already exists
  const existing = await getSkill(skillId);
  if (existing) {
    console.error(`Skill already exists in catalog: ${skillId}\n`);
    console.log('Use a different name or remove the existing entry first.');
    process.exitCode = 1;
    return;
  }

  // Add to catalog
  const entry = normalizeSkillPackage(skillId, content, {
    displayName: options.displayName,
    description: options.description,
  });

  await addSkill(entry, content);
  console.log(`✓ Added to catalog: ${entry.id}`);
  console.log('\nRun `acsync skill add ' + entry.id + '` to add it to your project.');
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
  const NAME_WIDTH = 25;
  const DESC_WIDTH = 35;

  const borderH = '┌' + '─'.repeat(ID_WIDTH + 2) + '┬' + '─'.repeat(NAME_WIDTH + 2) + '┬' + '─'.repeat(DESC_WIDTH + 2) + '┐';
  const borderM = '├' + '─'.repeat(ID_WIDTH + 2) + '┼' + '─'.repeat(NAME_WIDTH + 2) + '┼' + '─'.repeat(DESC_WIDTH + 2) + '┤';
  const borderF = '└' + '─'.repeat(ID_WIDTH + 2) + '┴' + '─'.repeat(NAME_WIDTH + 2) + '┴' + '─'.repeat(DESC_WIDTH + 2) + '┘';

  console.log(borderH);
  console.log('│ ' + padRightWide('ID', ID_WIDTH) + ' │ ' + padRightWide('Display Name', NAME_WIDTH) + ' │ ' + padRightWide('Description', DESC_WIDTH) + ' │');
  console.log(borderM);

  for (const entry of entries) {
    const id = truncateWide(entry.id, ID_WIDTH);
    const name = truncateWide(entry.displayName, NAME_WIDTH);
    const desc = truncateWide(entry.description, DESC_WIDTH);
    console.log('│ ' + padRightWide(id, ID_WIDTH) + ' │ ' + padRightWide(name, NAME_WIDTH) + ' │ ' + padRightWide(desc, DESC_WIDTH) + ' │');
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
  const { getSkillWithContent } = await import('./catalog.js');
  const skillWithData = await getSkillWithContent(id);

  if (!skillWithData) {
    console.error(`Skill entry not found: ${id}\n`);
    console.log('Run `acsync catalog skill list` to see available entries.');
    process.exitCode = 1;
    return;
  }

  const { entry, content } = skillWithData;

  console.log(`Skill Entry: ${entry.id}\n`);
  console.log(`  Display Name: ${entry.displayName}`);
  console.log(`  Description: ${entry.description}`);
  console.log(`  Content:\n`);

  // Show preview of skill content
  const lines = content.split('\n');
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

  await addSkill(entry, content);
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
