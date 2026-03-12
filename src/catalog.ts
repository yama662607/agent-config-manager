import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  CatalogFile,
  McpCatalogEntry,
  McpRecipe,
  SkillCatalogEntry,
  SkillRecipe,
} from './types.js';
import { CATALOG_VERSION } from './types.js';

// ============================================================================
// Constants
// ============================================================================

/** Catalog directory name in user's home directory */
const CATALOG_DIR = '.acsync';

/** Catalog filename */
const CATALOG_FILE = 'catalog.json';

/** Catalog schema filename */
const CATALOG_SCHEMA_FILE = 'catalog-schema.json';

/** Catalog lock filename */
const CATALOG_LOCK_FILE = 'catalog.lock';

// ============================================================================
// Path Resolution
// ============================================================================

/**
 * Get the catalog directory path for the current platform.
 */
export function getCatalogDir(): string {
  const home = os.homedir();
  return path.join(home, CATALOG_DIR);
}

/**
 * Get the catalog file path.
 */
export function getCatalogPath(): string {
  return path.join(getCatalogDir(), CATALOG_FILE);
}

/**
 * Get the catalog schema file path.
 */
export function getCatalogSchemaPath(): string {
  return path.join(getCatalogDir(), CATALOG_SCHEMA_FILE);
}

/**
 * Get the catalog lock file path.
 */
export function getCatalogLockPath(): string {
  return path.join(getCatalogDir(), CATALOG_LOCK_FILE);
}

// ============================================================================
// Catalog CRUD Operations
// ============================================================================

/**
 * Initialize an empty catalog if it doesn't exist.
 */
export async function initCatalog(): Promise<void> {
  const catalogDir = getCatalogDir();
  const catalogPath = getCatalogPath();

  try {
    await fs.access(catalogPath);
    return; // Already exists
  } catch {
    // Create catalog directory and file
  }

  await fs.mkdir(catalogDir, { recursive: true });

  const emptyCatalog: CatalogFile = {
    $schema: `./${CATALOG_SCHEMA_FILE}`,
    version: CATALOG_VERSION,
    mcps: {},
    skills: {},
  };

  await writeCatalogAtomic(emptyCatalog);
}

/**
 * Load the catalog from disk.
 */
export async function loadCatalog(): Promise<CatalogFile> {
  const catalogPath = getCatalogPath();

  try {
    await fs.access(catalogPath);
  } catch {
    // Initialize if doesn't exist
    await initCatalog();
  }

  const raw = await fs.readFile(catalogPath, 'utf8');
  const parsed = JSON.parse(raw) as CatalogFile;

  // Validate version
  if (parsed.version !== CATALOG_VERSION) {
    throw new Error(
      `Unsupported catalog version: ${parsed.version}. Expected: ${CATALOG_VERSION}`
    );
  }

  // Ensure skills field exists (for backward compatibility)
  if (!parsed.skills) {
    parsed.skills = {};
  }

  return parsed;
}

/**
 * Write the catalog to disk atomically.
 */
async function writeCatalogAtomic(catalog: CatalogFile): Promise<void> {
  const catalogPath = getCatalogPath();
  const tempPath = `${catalogPath}.tmp`;

  await fs.writeFile(tempPath, JSON.stringify(catalog, null, 2), 'utf8');
  await fs.rename(tempPath, catalogPath);
}

/**
 * List all MCP entries in the catalog.
 */
export async function listMcps(): Promise<McpCatalogEntry[]> {
  const catalog = await loadCatalog();
  return Object.values(catalog.mcps);
}

/**
 * Get a specific MCP entry by ID.
 */
export async function getMcp(id: string): Promise<McpCatalogEntry | null> {
  const catalog = await loadCatalog();
  return catalog.mcps[id] ?? null;
}

/**
 * Add or update an MCP entry in the catalog.
 */
export async function addMcp(entry: McpCatalogEntry): Promise<void> {
  const catalog = await loadCatalog();
  catalog.mcps[entry.id] = entry;
  await writeCatalogAtomic(catalog);
}

/**
 * Remove an MCP entry from the catalog.
 */
export async function removeMcp(id: string): Promise<boolean> {
  const catalog = await loadCatalog();

  if (!catalog.mcps[id]) {
    return false;
  }

  delete catalog.mcps[id];
  await writeCatalogAtomic(catalog);
  return true;
}

/**
 * Normalize an MCP package identifier into a catalog entry.
 */
export function normalizeMcpPackage(packageId: string, catalogEntry?: Partial<McpCatalogEntry>): McpCatalogEntry {
  const now = new Date().toISOString();

  // Build recipe from catalog entry or use default npx recipe
  const recipe: McpRecipe = catalogEntry?.recipe ?? {};
  if (!recipe.url && !recipe.command) {
    // Default: use npx for npm packages
    recipe.command = 'npx';
    recipe.args = ['-y', packageId];
    recipe.transport = 'stdio';
  } else if (recipe.url && !recipe.transport) {
    recipe.transport = 'http';
  } else if (!recipe.transport) {
    recipe.transport = 'stdio';
  }

  return {
    id: packageId,
    displayName: catalogEntry?.displayName ?? extractDisplayName(packageId),
    description: catalogEntry?.description ?? `MCP server: ${packageId}`,
    recipe,
    addedAt: catalogEntry?.addedAt ?? now,
    tags: catalogEntry?.tags ?? [],
  };
}

/**
 * Extract a display name from a package ID.
 */
function extractDisplayName(packageId: string): string {
  // @modelcontextprotocol/server-github -> GitHub
  // @upstash/context7-mcp -> Context7 MCP
  const parts = packageId.split('/');
  const lastPart = parts[parts.length - 1] ?? packageId;

  // Remove common prefixes
  const cleaned = lastPart
    .replace(/^server-/, '')
    .replace(/-mcp$/, '');

  // Convert kebab-case to Title Case
  return cleaned
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// ============================================================================
// Skill Catalog Operations
// ============================================================================

/**
 * List all skill entries in the catalog.
 */
export async function listSkills(): Promise<SkillCatalogEntry[]> {
  const catalog = await loadCatalog();
  return Object.values(catalog.skills);
}

/**
 * Get a specific skill entry by ID.
 */
export async function getSkill(id: string): Promise<SkillCatalogEntry | null> {
  const catalog = await loadCatalog();
  return catalog.skills[id] ?? null;
}

/**
 * Add or update a skill entry in the catalog.
 */
export async function addSkill(entry: SkillCatalogEntry): Promise<void> {
  const catalog = await loadCatalog();
  catalog.skills[entry.id] = entry;
  await writeCatalogAtomic(catalog);
}

/**
 * Remove a skill entry from the catalog.
 */
export async function removeSkill(id: string): Promise<boolean> {
  const catalog = await loadCatalog();

  if (!catalog.skills[id]) {
    return false;
  }

  delete catalog.skills[id];
  await writeCatalogAtomic(catalog);
  return true;
}

/**
 * Normalize a skill identifier into a catalog entry.
 */
export function normalizeSkillPackage(
  packageId: string,
  content: string,
  catalogEntry?: Partial<SkillCatalogEntry>
): SkillCatalogEntry {
  const now = new Date().toISOString();

  // Parse YAML frontmatter to extract name and description
  const recipe: SkillRecipe = parseSkillFrontmatter(content);

  return {
    id: packageId,
    displayName: catalogEntry?.displayName ?? recipe.name,
    description: catalogEntry?.description ?? recipe.description,
    recipe: {
      ...recipe,
      content,
    },
    addedAt: catalogEntry?.addedAt ?? now,
    tags: catalogEntry?.tags ?? [],
  };
}

/**
 * Parse YAML frontmatter from skill content.
 */
function parseSkillFrontmatter(content: string): SkillRecipe {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    // No frontmatter found, return basic recipe
    return {
      name: 'unknown',
      description: 'No description',
      content,
    };
  }

  const yamlText = match[1];
  const body = match[2];
  const recipe: SkillRecipe = {
    name: 'unknown',
    description: '',
    content,
  };

  // Parse YAML frontmatter
  const lines = yamlText.split('\n');
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();

    switch (key) {
      case 'name':
        recipe.name = value.replace(/^["']|["']$/g, '');
        break;
      case 'description':
        recipe.description = value.replace(/^["']|["']$/g, '');
        break;
      case 'license':
        recipe.license = value.replace(/^["']|["']$/g, '');
        break;
      case 'metadata':
        // Skip metadata for now (would need YAML parser)
        break;
    }
  }

  return recipe;
}
