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

export interface McpListFilter {
  /** Free text matched against id, display name and description. */
  search?: string;
  category?: string;
  language?: string;
  popularity?: string;
  sourceType?: string;
  pinned?: boolean;
  deprecated?: boolean;
}

/**
 * List all MCP entries in the catalog with enhanced metadata.
 */
export async function catalogMcpList(filter?: McpListFilter): Promise<void> {
  const entries = await listMcps();
  const { loadMcpsMetadata } = await import('./mcps-metadata.js');
  const metaFile = await loadMcpsMetadata();

  // Merge catalog entries with enhanced metadata (with fuzzy matching)
  let enriched = entries.map(entry => {
    // Try exact match first, then fuzzy
    let meta = metaFile.mcps[entry.id];
    if (!meta) {
      for (const [key, m] of Object.entries(metaFile.mcps)) {
        if (key.includes(entry.id) || entry.id.includes(key) ||
            (m.package && (m.package === entry.id || entry.id.includes(m.package) || m.package.includes(entry.id)))) {
          meta = m;
          break;
        }
      }
    }
    return {
      id: entry.id,
      displayName: meta?.displayName || entry.displayName,
      description: meta?.descriptionJa || entry.description,
      category: meta?.category,
      language: meta?.language,
      popularity: meta?.popularity,
      sourceType: meta?.sourceType,
      agent: meta?.agent,
      pinned: meta?.pinned,
      deprecated: meta?.deprecated,
    };
  });

  // Apply filters
  if (filter) {
    enriched = enriched.filter(e => {
      if (filter.category !== undefined && e.category !== filter.category) return false;
      if (filter.search !== undefined && !matchesSearch(filter.search, [e.id, e.displayName, e.description])) return false;
      if (filter.language !== undefined && e.language !== filter.language) return false;
      if (filter.sourceType !== undefined && e.sourceType !== filter.sourceType) return false;
      if (filter.popularity !== undefined && e.popularity !== filter.popularity) return false;
      if (filter.pinned !== undefined && e.pinned !== filter.pinned) return false;
      if (filter.deprecated !== undefined && e.deprecated !== filter.deprecated) return false;
      return true;
    });
  }

  if (enriched.length === 0) {
    console.log('No matching MCP entries.\n');
    return;
  }

  const filterDesc = filter ? `, filter: ${describeMcpFilter(filter)}` : '';
  console.log(`MCP Catalog (${enriched.length} entries${filterDesc}):\n`);

  const ID_WIDTH = 34;
  const NAME_WIDTH = 18;
  const CAT_WIDTH = 12;
  const SRC_WIDTH = 7;
  const LANG_WIDTH = 9;
  const POP_WIDTH = 6;

  const borderH = '┌' + '─'.repeat(ID_WIDTH + 2) + '┬' + '─'.repeat(NAME_WIDTH + 2) + '┬' + '─'.repeat(CAT_WIDTH + 2) + '┬' + '─'.repeat(SRC_WIDTH + 2) + '┬' + '─'.repeat(LANG_WIDTH + 2) + '┬' + '─'.repeat(POP_WIDTH + 2) + '┐';
  const borderM = '├' + '─'.repeat(ID_WIDTH + 2) + '┼' + '─'.repeat(NAME_WIDTH + 2) + '┼' + '─'.repeat(CAT_WIDTH + 2) + '┼' + '─'.repeat(SRC_WIDTH + 2) + '┼' + '─'.repeat(LANG_WIDTH + 2) + '┼' + '─'.repeat(POP_WIDTH + 2) + '┤';
  const borderF = '└' + '─'.repeat(ID_WIDTH + 2) + '┴' + '─'.repeat(NAME_WIDTH + 2) + '┴' + '─'.repeat(CAT_WIDTH + 2) + '┴' + '─'.repeat(SRC_WIDTH + 2) + '┴' + '─'.repeat(LANG_WIDTH + 2) + '┴' + '─'.repeat(POP_WIDTH + 2) + '┘';

  console.log(borderH);
  console.log('│ ' + padRightWide('ID', ID_WIDTH) + ' │ ' + padRightWide('Name', NAME_WIDTH) + ' │ ' + padRightWide('Category', CAT_WIDTH) + ' │ ' + padRightWide('Source', SRC_WIDTH) + ' │ ' + padRightWide('Lang', LANG_WIDTH) + ' │ ' + padRightWide('Pop', POP_WIDTH) + ' │');
  console.log(borderM);

  for (const e of enriched) {
    const id = truncateWide(e.id, ID_WIDTH);
    const name = truncateWide(e.displayName, NAME_WIDTH);
    const cat = truncateWide(e.category || '-', CAT_WIDTH);
    const src = sourceAbbr(e.sourceType, e.agent);
    const lang = truncateWide(e.language || '-', LANG_WIDTH);
    const pop = popularityIcon(e.popularity);
    console.log('│ ' + padRightWide(id, ID_WIDTH) + ' │ ' + padRightWide(name, NAME_WIDTH) + ' │ ' + padRightWide(cat, CAT_WIDTH) + ' │ ' + padRightWide(src, SRC_WIDTH) + ' │ ' + padRightWide(lang, LANG_WIDTH) + ' │ ' + padRightWide(pop, POP_WIDTH) + ' │');
  }

  console.log(borderF);
  console.log();
  console.log('Run `acm mcp show -g <id>` for details.');
  console.log('Filter: --category <cat>  --language <lang>  --popularity <high|medium|low>  --pinned  --deprecated');
}

function sourceAbbr(sourceType?: string, agent?: string): string {
  if (!sourceType) return '-';
  const a = agent === 'claude' ? 'Cl' : agent === 'codex' ? 'Cx' : agent === 'antigravity' ? 'Ag' : agent === 'grok' ? 'Gk' : (agent || '??');
  return sourceType === 'plugin' ? `p:${a}` : sourceType === 'config' ? `c:${a}` : sourceType;
}

function popularityIcon(pop?: string): string {
  switch (pop) {
    case 'high': return '★★★';
    case 'medium': return '★★';
    case 'low': return '★';
    default: return '-';
  }
}

function describeMcpFilter(filter: McpListFilter): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(filter)) {
    if (v !== undefined) parts.push(`${k}=${v}`);
  }
  return parts.join(', ');
}

// ============================================================================
// Show Command
// ============================================================================

/**
 * Show details of a specific catalog entry with enhanced metadata.
 */
export async function catalogMcpShow(id: string): Promise<void> {
  const entry = await getMcp(id);

  if (!entry) {
    console.error(`MCP entry not found: ${id}\n`);
    console.log('Run `acm mcp list -g` to see available entries.');
    process.exitCode = 1;
    return;
  }

  // Load enhanced metadata
  const { getMcpMetadata } = await import('./mcps-metadata.js');
  const meta = await getMcpMetadata(id);

  console.log(`MCP Entry: ${entry.id}\n`);
  console.log(`  Display Name: ${meta?.displayName || entry.displayName}`);
  console.log(`  Description: ${meta?.descriptionJa || entry.description}`);
  if (meta?.descriptionEn) console.log(`  Description (EN): ${meta.descriptionEn}`);

  // Enhanced metadata
  if (meta?.category) console.log(`  Category: ${meta.category}`);
  if (meta?.sourceType) console.log(`  Source: ${meta.sourceType} (${meta.agent || 'unknown'})`);
  if (meta?.language) console.log(`  Language: ${meta.language}`);
  if (meta?.popularity) console.log(`  Popularity: ${meta.popularity} ${popularityIcon(meta.popularity)}`);
  if (meta?.package) console.log(`  Package: ${meta.package}`);
  if (meta?.github) console.log(`  GitHub: https://github.com/${meta.github}`);
  if (meta?.website) console.log(`  Website: ${meta.website}`);

  console.log(`\n  Recipe:`);

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
  if (meta?.addedAt) console.log(`  Metadata Updated: ${meta.addedAt}`);
  if (meta?.pinned === true) console.log(`  Pinned: yes`);
  if (meta?.deprecated === true) console.log(`  Deprecated: yes`);
  if (meta?.tags && meta.tags.length > 0) {
    console.log(`  Tags: ${meta.tags.join(', ')}`);
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
    console.log('Use `acm mcp edit` to modify the entry.');
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
  console.log('Run `acm mcp add <package>` to add it to your project.');
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
    console.log('Run `acm mcp list -g` to see available entries.');
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
    console.log('Run `acm skill search <query>` to search the registry.');
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
    console.log('Use `acm skill install ' + options.skillId + ' -g --force` to reinstall.');
    process.exitCode = 1;
    return;
  }

  const entry = normalizeSkillPackage(info.name, content, {
    displayName: info.name,
    description: info.description,
  });

  await addSkill(entry, content);
  console.log(`\n✓ Added to catalog: ${entry.id}`);
  console.log('\nRun `acm skill add ' + entry.id + '` to add it to your project.');
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

  console.log(`\nRun \`acm skill install <url>\` to install a skill.`);
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
  console.log('\nRun `acm skill add ' + entry.id + '` to add it to your project.');
}

// ============================================================================
// Skill Catalog Commands
// ============================================================================

/**
 * List all skill entries in the catalog.
 */
export interface SkillListFilter {
  plugin?: string;
  /** Substring matched against the recorded upstream URL. */
  source?: string;
  /** Free text matched against id, display name, description and tags. */
  search?: string;
  agent?: string;
  sourceType?: string;
  category?: string;
  pinned?: boolean;
  deprecated?: boolean;
}

export async function catalogSkillList(filter?: SkillListFilter): Promise<void> {
  const { listSkills } = await import('./catalog.js');
  const { loadSkillsMetadata } = await import('./skills-metadata.js');

  const catalogEntries = await listSkills();
  const metaFile = await loadSkillsMetadata();

  // Merge catalog entries with metadata
  let enriched = catalogEntries.map(entry => {
    const meta = metaFile.skills[entry.id];
    return {
      id: entry.id,
      displayName: entry.displayName,
      description: entry.description,
      agent: meta?.agent,
      plugin: meta?.plugin,
      sourceType: meta?.sourceType,
      category: meta?.category,
      pinned: meta?.pinned,
      deprecated: meta?.deprecated,
      sourceUrl: meta?.sourceUrl,
      tags: entry.tags,
    };
  });

  // Apply filters
  if (filter) {
    enriched = enriched.filter(e => {
      if (filter.search !== undefined && !matchesSearch(filter.search, [e.id, e.displayName, e.description, ...(e.tags ?? [])])) return false;
      if (filter.source !== undefined && !(e.sourceUrl ?? '').includes(filter.source)) return false;
      if (filter.plugin !== undefined && e.plugin !== filter.plugin) return false;
      if (filter.agent !== undefined && e.agent !== filter.agent) return false;
      if (filter.sourceType !== undefined && e.sourceType !== filter.sourceType) return false;
      if (filter.category !== undefined && e.category !== filter.category) return false;
      if (filter.pinned !== undefined && e.pinned !== filter.pinned) return false;
      if (filter.deprecated !== undefined && e.deprecated !== filter.deprecated) return false;
      return true;
    });
  }

  if (enriched.length === 0) {
    const filterDesc = filter ? ` (${describeFilter(filter)})` : '';
    console.log(`No matching skill entries${filterDesc}.\n`);
    console.log('Run `acm skill import <path> -g` to add an entry.');
    return;
  }

  const filterDesc = filter ? `, filter: ${describeFilter(filter)}` : '';
  console.log(`Skill Catalog (${enriched.length} entries${filterDesc}):\n`);

  const ID_WIDTH = 35;
  const NAME_WIDTH = 20;
  const AGENT_WIDTH = 10;
  const CAT_WIDTH = 16;
  const DESC_WIDTH = 30;

  const borderH = '┌' + '─'.repeat(ID_WIDTH + 2) + '┬' + '─'.repeat(NAME_WIDTH + 2) + '┬' + '─'.repeat(AGENT_WIDTH + 2) + '┬' + '─'.repeat(CAT_WIDTH + 2) + '┬' + '─'.repeat(DESC_WIDTH + 2) + '┐';
  const borderM = '├' + '─'.repeat(ID_WIDTH + 2) + '┼' + '─'.repeat(NAME_WIDTH + 2) + '┼' + '─'.repeat(AGENT_WIDTH + 2) + '┼' + '─'.repeat(CAT_WIDTH + 2) + '┼' + '─'.repeat(DESC_WIDTH + 2) + '┤';
  const borderF = '└' + '─'.repeat(ID_WIDTH + 2) + '┴' + '─'.repeat(NAME_WIDTH + 2) + '┴' + '─'.repeat(AGENT_WIDTH + 2) + '┴' + '─'.repeat(CAT_WIDTH + 2) + '┴' + '─'.repeat(DESC_WIDTH + 2) + '┘';

  console.log(borderH);
  console.log('│ ' + padRightWide('ID', ID_WIDTH) + ' │ ' + padRightWide('Display Name', NAME_WIDTH) + ' │ ' + padRightWide('Agent', AGENT_WIDTH) + ' │ ' + padRightWide('Category', CAT_WIDTH) + ' │ ' + padRightWide('Description', DESC_WIDTH) + ' │');
  console.log(borderM);

  for (const e of enriched) {
    const id = truncateWide(e.id, ID_WIDTH);
    const name = truncateWide(e.displayName, NAME_WIDTH);
    const agent = padRightWide(agentAbbr(e.agent), AGENT_WIDTH);
    const cat = truncateWide(e.category || '-', CAT_WIDTH);
    const desc = truncateWide(e.description, DESC_WIDTH);
    console.log('│ ' + padRightWide(id, ID_WIDTH) + ' │ ' + padRightWide(name, NAME_WIDTH) + ' │ ' + agent + ' │ ' + padRightWide(cat, CAT_WIDTH) + ' │ ' + padRightWide(desc, DESC_WIDTH) + ' │');
  }

  console.log(borderF);
  console.log();
  console.log('Narrow this list: `acm skill list -g --search <text>`');
  console.log('One entry:      `acm skill show -g <id>`');
  console.log('More filters:   --plugin <name>  --agent <name>  --source-type <type>  --category <cat>  --pinned  --deprecated');
}

function agentAbbr(agent?: string): string {
  switch (agent) {
    case 'claude': return 'claude';
    case 'codex': return 'codex';
    case 'antigravity': return 'antigrav';
    case 'grok': return 'grok';
    default: return agent || '-';
  }
}

/** Case-insensitive substring match across a record's searchable fields. */
function matchesSearch(query: string, fields: Array<string | undefined>): boolean {
  const needle = query.toLowerCase();
  return fields.some((field) => field !== undefined && field.toLowerCase().includes(needle));
}

function describeFilter(filter: SkillListFilter): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(filter)) {
    if (v !== undefined) parts.push(`${k}=${v}`);
  }
  return parts.join(', ');
}

// ============================================================================
// Show Command
// ============================================================================

/**
 * Show details of a specific skill catalog entry.
 */
export async function catalogSkillShow(id: string): Promise<void> {
  const { getSkillWithContent } = await import('./catalog.js');
  const { getSkillMetadata } = await import('./skills-metadata.js');

  const skillWithData = await getSkillWithContent(id);

  if (!skillWithData) {
    console.error(`Skill entry not found: ${id}\n`);
    console.log('Run `acm skill list -g` to see available entries.');
    process.exitCode = 1;
    return;
  }

  const { entry, content } = skillWithData;
  const meta = await getSkillMetadata(id);

  console.log(`Skill Entry: ${entry.id}\n`);
  console.log(`  Display Name: ${entry.displayName}`);
  console.log(`  Description: ${entry.description}`);

  // Enhanced metadata
  if (meta?.sourceType) console.log(`  Source Type: ${meta.sourceType}`);
  if (meta?.agent) console.log(`  Agent: ${meta.agent}`);
  if (meta?.plugin) console.log(`  Plugin: ${meta.plugin}`);
  if (meta?.category) console.log(`  Category: ${meta.category}`);
  if (meta?.version) console.log(`  Version: ${meta.version}`);
  if (meta?.author) console.log(`  Author: ${meta.author}`);

  console.log(`  Added: ${entry.addedAt}`);
  if (meta?.updatedAt) console.log(`  Updated: ${meta.updatedAt}`);
  if (meta?.pinned === true) console.log(`  Pinned: yes`);
  if (meta?.deprecated === true) console.log(`  Deprecated: yes`);
  if (entry.license) console.log(`  License: ${entry.license}`);
  if (entry.tags && entry.tags.length > 0) {
    console.log(`  Tags: ${entry.tags.join(', ')}`);
  }

  console.log(`\n  Content:\n`);

  // Show preview of skill content
  const lines = content.split('\n');
  const previewLines = lines.slice(0, 20); // Show first 20 lines
  console.log(previewLines.join('\n'));

  if (lines.length > 20) {
    console.log(`\n... (${lines.length - 20} more lines)`);
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
    console.log('Use `acm skill add` to add it to your project.');
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
  console.log('Run `acm skill add <name>` to add it to your project.');
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
    console.log('Run `acm skill list -g` to see available entries.');
    process.exitCode = 1;
    return;
  }

  console.log(`Removed from catalog: ${id}\n`);
}
