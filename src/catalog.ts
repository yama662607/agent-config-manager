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

/** Maximum catalog file size (10MB) */
const MAX_CATALOG_SIZE = 10 * 1024 * 1024;

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

  // Check file size
  if (raw.length > MAX_CATALOG_SIZE) {
    throw new Error('Catalog file too large. Please clean up the catalog.');
  }

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

  // Auto-migrate from old format if needed
  await ensureMigrated();

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
// Skill Catalog Operations (File-based storage)
// ============================================================================

/**
 * Get the skills directory path.
 */
export function getSkillsDir(): string {
  return path.join(getCatalogDir(), 'skills');
}

/**
 * Get a specific skill directory path.
 */
export function getSkillDir(id: string): string {
  return path.join(getSkillsDir(), id);
}

/**
 * Get the SKILL.md file path for a skill.
 */
export function getSkillFilePath(id: string): string {
  return path.join(getSkillDir(id), 'SKILL.md');
}

/**
 * Ensure skills directory exists.
 */
async function ensureSkillsDir(): Promise<void> {
  await fs.mkdir(getSkillsDir(), { recursive: true });
}

/**
 * Validate skill ID to prevent path traversal.
 */
function validateSkillId(id: string): void {
  if (!id || id.length === 0) {
    throw new Error('Skill ID cannot be empty');
  }

  if (id.length > 100) {
    throw new Error('Skill ID too long (max 100 characters)');
  }

  // Prevent path traversal
  if (id.includes('..') || id.includes('/') || id.includes('\\')) {
    throw new Error('Skill ID cannot contain path traversal characters');
  }

  // Prevent leading/trailing dots and dashes
  if (id.startsWith('.') || id.startsWith('-') || id.endsWith('.') || id.endsWith('-')) {
    throw new Error('Skill ID cannot start or end with a dot or dash');
  }
}

/**
 * List all skill entries in the catalog (metadata only).
 */
export async function listSkills(): Promise<SkillCatalogEntry[]> {
  const catalog = await loadCatalog();
  return Object.values(catalog.skills);
}

/**
 * Get a specific skill entry by ID (metadata only).
 */
export async function getSkill(id: string): Promise<SkillCatalogEntry | null> {
  const catalog = await loadCatalog();
  return catalog.skills[id] ?? null;
}

/**
 * Get full skill data including content from file.
 */
export async function getSkillWithContent(id: string): Promise<{ entry: SkillCatalogEntry; content: string } | null> {
  const entry = await getSkill(id);
  if (!entry) {
    return null;
  }

  try {
    const skillPath = getSkillFilePath(id);
    const content = await fs.readFile(skillPath, 'utf8');
    return { entry, content };
  } catch {
    return null;
  }
}

/**
 * Add or update a skill entry in the catalog (file-based).
 * Creates a directory and saves SKILL.md file.
 */
export async function addSkill(entry: SkillCatalogEntry, content: string): Promise<void> {
  validateSkillId(entry.id);
  await ensureSkillsDir();

  const skillDir = getSkillDir(entry.id);
  const skillPath = getSkillFilePath(entry.id);

  // Create skill directory
  await fs.mkdir(skillDir, { recursive: true });

  // Write SKILL.md atomically
  const tempPath = `${skillPath}.tmp`;
  await fs.writeFile(tempPath, content, 'utf8');
  await fs.rename(tempPath, skillPath);

  // Update catalog metadata
  const catalog = await loadCatalog();
  catalog.skills[entry.id] = {
    id: entry.id,
    displayName: entry.displayName,
    description: entry.description,
    path: `skills/${entry.id}`,
    addedAt: entry.addedAt ?? new Date().toISOString(),
    tags: entry.tags ?? [],
    license: entry.license,
  };
  await writeCatalogAtomic(catalog);
}

/**
 * Add a skill from a local directory (copies all files).
 */
export async function addSkillFromDir(
  id: string,
  sourceDir: string,
  metadata: Partial<SkillCatalogEntry> = {}
): Promise<void> {
  validateSkillId(id);
  await ensureSkillsDir();

  const skillDir = getSkillDir(id);

  // Create skill directory
  await fs.mkdir(skillDir, { recursive: true });

  // Copy all files from source directory
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(sourceDir, entry.name);
    const destPath = path.join(skillDir, entry.name);

    if (entry.isDirectory()) {
      // Recursively copy subdirectories (e.g., references/)
      await fs.mkdir(destPath, { recursive: true });
      const subEntries = await fs.readdir(srcPath, { withFileTypes: true });
      for (const subEntry of subEntries) {
        if (subEntry.isFile()) {
          const subSrcPath = path.join(srcPath, subEntry.name);
          const subDestPath = path.join(destPath, subEntry.name);
          await fs.copyFile(subSrcPath, subDestPath);
        }
      }
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath);
    }
  }

  // Parse SKILL.md for metadata
  const skillPath = getSkillFilePath(id);
  let content = '';
  let displayName = metadata.displayName ?? id;
  let description = metadata.description ?? '';
  let license: string | undefined = metadata.license;

  try {
    content = await fs.readFile(skillPath, 'utf8');
    const recipe = parseSkillFrontmatter(content);
    displayName = recipe.name || displayName;
    description = recipe.description || description;
    license = recipe.license || license;
  } catch {
    // SKILL.md not found, use provided metadata
  }

  // Update catalog metadata
  const catalog = await loadCatalog();
  catalog.skills[id] = {
    id,
    displayName,
    description,
    path: `skills/${id}`,
    addedAt: metadata.addedAt ?? new Date().toISOString(),
    tags: metadata.tags ?? [],
    license,
  };
  await writeCatalogAtomic(catalog);
}

/**
 * Remove a skill entry from the catalog (deletes directory).
 */
export async function removeSkill(id: string): Promise<boolean> {
  const catalog = await loadCatalog();

  if (!catalog.skills[id]) {
    return false;
  }

  delete catalog.skills[id];
  await writeCatalogAtomic(catalog);

  // Delete skill directory
  const skillDir = getSkillDir(id);
  await fs.rm(skillDir, { recursive: true, force: true });

  return true;
}

/**
 * Normalize a skill identifier and content into a catalog entry.
 * This extracts metadata from content but doesn't store the content.
 */
export function normalizeSkillPackage(
  packageId: string,
  content: string,
  catalogEntry?: Partial<SkillCatalogEntry>
): SkillCatalogEntry {
  const now = new Date().toISOString();

  // Parse YAML frontmatter to extract name and description
  const recipe = parseSkillFrontmatter(content);

  return {
    id: packageId,
    displayName: catalogEntry?.displayName ?? recipe.name,
    description: catalogEntry?.description ?? recipe.description,
    path: catalogEntry?.path ?? `skills/${packageId}`,
    addedAt: catalogEntry?.addedAt ?? now,
    tags: catalogEntry?.tags ?? [],
    license: recipe.license,
  };
}

/**
 * Parse YAML frontmatter from skill content.
 */
function parseSkillFrontmatter(content: string): SkillRecipe {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
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

  // Parse YAML frontmatter with improved handling
  const lines = yamlText.split(/\r?\n/);
  let inMultiline = false;
  let multilineKey = '';
  let multilineValues: string[] = [];

  for (const line of lines) {
    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith('#')) {
      continue;
    }

    // Handle multiline values
    if (inMultiline) {
      if (line.startsWith('  ') || line.startsWith('\t')) {
        multilineValues.push(line.trim());
        continue;
      } else {
        inMultiline = false;
        // Store the accumulated multiline value
        if (multilineKey === 'description') {
          recipe.description = multilineValues.join(' ').replace(/^["']|["']$/g, '');
        }
        multilineValues = [];
        multilineKey = '';
      }
    }

    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();

    // Handle empty values (start of multiline)
    if (!value && (key === 'description' || key === 'name')) {
      inMultiline = true;
      multilineKey = key;
      continue;
    }

    // Sanitize values: remove quotes and limit length
    const sanitizedValue = value.replace(/^["']|["']$/g, '').slice(0, 500);

    switch (key) {
      case 'name':
        recipe.name = sanitizedValue || 'unknown';
        break;
      case 'description':
        recipe.description = sanitizedValue || '';
        break;
      case 'license':
        recipe.license = sanitizedValue;
        break;
      case 'metadata':
        // Skip metadata for now (would need YAML parser)
        break;
    }
  }

  // Handle trailing multiline value
  if (inMultiline && multilineKey === 'description' && multilineValues.length > 0) {
    recipe.description = multilineValues.join(' ').replace(/^["']|["']$/g, '');
  }

  // Sanitize name to prevent injection
  recipe.name = recipe.name.replace(/[^\w\s-]/g, '').trim().slice(0, 100) || 'unknown';
  recipe.description = recipe.description.slice(0, 500);

  return recipe;
}

// ============================================================================
// Migration
// ============================================================================

/**
 * Check if a skill entry uses the old format (with embedded content).
 */
function isOldSkillFormat(entry: any): entry is { recipe: { content: string; name?: string; description?: string; license?: string }; id?: string; displayName?: string; description?: string; addedAt?: string; tags?: string[] } {
  return entry.recipe && typeof entry.recipe.content === 'string';
}

/**
 * Migrate a single skill from old format to new file-based format.
 */
async function migrateSkill(id: string, oldEntry: any): Promise<void> {
  if (!isOldSkillFormat(oldEntry)) {
    return; // Already migrated or invalid format
  }

  const content = oldEntry.recipe.content;
  if (!content) {
    return;
  }

  // Create skill directory and write content
  await ensureSkillsDir();
  const skillDir = getSkillDir(id);
  const skillPath = getSkillFilePath(id);

  await fs.mkdir(skillDir, { recursive: true });

  // Write SKILL.md atomically
  const tempPath = `${skillPath}.tmp`;
  await fs.writeFile(tempPath, content, 'utf8');
  await fs.rename(tempPath, skillPath);
}

/**
 * Migrate all skills from old JSON format to new file-based format.
 * Returns the number of skills migrated.
 */
export async function migrateSkills(): Promise<number> {
  const catalogPath = getCatalogPath();

  try {
    await fs.access(catalogPath);
  } catch {
    return 0; // Catalog doesn't exist, nothing to migrate
  }

  const raw = await fs.readFile(catalogPath, 'utf8');
  const catalog = JSON.parse(raw) as CatalogFile;

  if (!catalog.skills || Object.keys(catalog.skills).length === 0) {
    return 0; // No skills to migrate
  }

  let migratedCount = 0;
  const newSkills: Record<string, SkillCatalogEntry> = {};

  for (const [id, entry] of Object.entries(catalog.skills)) {
    if (isOldSkillFormat(entry)) {
      // Migrate to file-based format
      await migrateSkill(id, entry);

      // Create new entry structure
      newSkills[id] = {
        id: entry.id || id,
        displayName: entry.displayName || entry.recipe.name || id,
        description: entry.description || entry.recipe.description || '',
        path: `skills/${id}`,
        addedAt: entry.addedAt || new Date().toISOString(),
        tags: entry.tags || [],
        license: entry.recipe.license,
      };

      migratedCount++;
    } else {
      // Already in new format, keep as-is
      newSkills[id] = entry;
    }
  }

  if (migratedCount > 0) {
    // Update catalog with new format
    catalog.skills = newSkills;
    await writeCatalogAtomic(catalog);
  }

  return migratedCount;
}

/**
 * Auto-migrate on catalog load if needed.
 */
let migrationChecked = false;

async function ensureMigrated(): Promise<void> {
  if (migrationChecked) {
    return;
  }
  migrationChecked = true;

  try {
    const count = await migrateSkills();
    if (count > 0) {
      console.log(`Migrated ${count} skill(s) to file-based format.`);
    }
  } catch {
    // Silently ignore migration errors
  }
}
