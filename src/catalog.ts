import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import * as TOML from 'smol-toml';
import { getCatalogDir } from './acm-config.js';
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
const CATALOG_DIR = '.acm';

/**
 * Migrates ~/.acm directory to ~/.acm if the old directory exists
 * but the new one does not.
 */
async function migrateCatalogDir(): Promise<void> {
  const home = os.homedir();
  const oldDir = path.join(home, '.acm');
  const newDir = path.join(home, '.acm');

  try {
    await fs.access(oldDir);
    try {
      await fs.access(newDir);
    } catch {
      await fs.rename(oldDir, newDir);
    }
  } catch {
    // Ignore
  }
}

/** Maximum catalog file size (10MB) */
const MAX_CATALOG_SIZE = 10 * 1024 * 1024;

/** Catalog filename */
const CATALOG_FILE = 'catalog.toml';

/** Old catalog filename (for migration) */
const OLD_CATALOG_FILE = 'catalog.json';

/** Old YAML catalog filename (for migration) */
const OLD_CATALOG_FILE_YAML = 'catalog.yaml';

/** Catalog schema filename */
const CATALOG_SCHEMA_FILE = 'catalog-schema.json';

/** Catalog lock filename */
const CATALOG_LOCK_FILE = 'catalog.lock';

// ============================================================================
// Path Resolution
// ============================================================================

/**
 * Get the catalog directory path.
 * Configurable via ACM_CATALOG_DIR or `catalog_dir` in ~/.acm/config.toml.
 */
export { getCatalogDir };

/**
 * Get the catalog file path.
 */
export function getCatalogPath(): string {
  return path.join(getCatalogDir(), CATALOG_FILE);
}

/**
 * Get the old catalog file path (for migration).
 */
export function getOldCatalogPath(): string {
  return path.join(getCatalogDir(), OLD_CATALOG_FILE);
}

/**
 * Get the old YAML catalog file path (for migration).
 */
export function getOldCatalogPathYaml(): string {
  return path.join(getCatalogDir(), OLD_CATALOG_FILE_YAML);
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
  await migrateCatalogDir();
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
  await migrateCatalogDir();
  const catalogPath = getCatalogPath();
  const oldCatalogPath = getOldCatalogPath();
  const oldCatalogPathYaml = getOldCatalogPathYaml();

  // 1. Try migrating old JSON catalog if it exists
  try {
    await fs.access(oldCatalogPath);
    const rawOld = await fs.readFile(oldCatalogPath, 'utf8');
    const parsedOld = JSON.parse(rawOld) as CatalogFile;
    
    await fs.mkdir(getCatalogDir(), { recursive: true });
    await writeCatalogAtomic(parsedOld);
    await fs.rm(oldCatalogPath, { force: true });
  } catch {
    // Ignore
  }

  // 2. Try migrating old YAML catalog if it exists
  try {
    await fs.access(oldCatalogPathYaml);
    const rawOldYaml = await fs.readFile(oldCatalogPathYaml, 'utf8');
    const parsedOldYaml = YAML.parse(rawOldYaml) as CatalogFile;
    
    await fs.mkdir(getCatalogDir(), { recursive: true });
    await writeCatalogAtomic(parsedOldYaml);
    await fs.rm(oldCatalogPathYaml, { force: true });
  } catch {
    // Ignore
  }

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

  const rawObj = TOML.parse(raw) as any;
  const catalog: CatalogFile = {
    $schema: rawObj?.$schema ?? `./${CATALOG_SCHEMA_FILE}`,
    version: rawObj?.version ?? CATALOG_VERSION,
    mcps: rawObj?.mcps ?? {},
    skills: rawObj?.skills ?? {},
  };

  // Validate version
  if (catalog.version !== CATALOG_VERSION) {
    throw new Error(
      `Unsupported catalog version: ${catalog.version}. Expected: ${CATALOG_VERSION}`
    );
  }

  let needsSync = false;

  // 1. MCP Copy-Paste Detection & Normalization
  if (rawObj && typeof rawObj === 'object') {
    const mcpServers = rawObj.mcpServers ?? rawObj.mcp_servers;
    if (mcpServers && typeof mcpServers === 'object') {
      for (const [name, server] of Object.entries(mcpServers)) {
        if (!server || typeof server !== 'object') continue;
        const s = server as any;
        
        const recipe: McpRecipe = {};
        if (s.serverUrl || s.url || s.httpUrl) {
          recipe.url = s.serverUrl || s.url || s.httpUrl;
          recipe.transport = 'http';
        } else if (s.command) {
          recipe.command = s.command;
          recipe.args = s.args ?? [];
          recipe.transport = 'stdio';
        }
        if (s.cwd) recipe.cwd = s.cwd;
        if (s.env) recipe.env = s.env;

        const existing = catalog.mcps[name];
        const recipeChanged = !existing || JSON.stringify(existing.recipe) !== JSON.stringify(recipe);

        if (recipeChanged || !existing) {
          catalog.mcps[name] = {
            id: name,
            displayName: existing?.displayName ?? extractDisplayName(name),
            description: existing?.description ?? `MCP server: ${name}`,
            recipe,
            addedAt: existing?.addedAt ?? new Date().toISOString(),
            tags: existing?.tags ?? [],
          };
          needsSync = true;
        }
      }
    }
  }

  // 2. Skill Drag-and-Drop Auto-Discovery & Synchronization
  await adoptAddedAtFromCatalog(catalog);
  const { skillAddedAt, skillTags } = await loadSkillIndexMetadata();
  const skillsDir = getSkillsDir();
  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    const activeSkillIds = new Set<string>();

    for (const entry of entries) {
      let isDir = entry.isDirectory();
      if (entry.isSymbolicLink()) {
        try {
          const stat = await fs.stat(path.join(skillsDir, entry.name));
          isDir = stat.isDirectory();
        } catch {
          // Dead symlink, skip
          isDir = false;
        }
      }

      if (!isDir) continue;
      const skillId = entry.name;
      
      try {
        validateSkillId(skillId);
      } catch {
        continue;
      }

      const skillFilePath = getSkillFilePath(skillId);
      try {
        await fs.access(skillFilePath);
        activeSkillIds.add(skillId);

        const content = await fs.readFile(skillFilePath, 'utf8');
        const recipe = parseSkillFrontmatter(content);

        // The index is derived, not stored: every field here comes from the
        // directory or the file's own frontmatter. Only `addedAt` is knowledge
        // the filesystem does not hold, and that lives in skills-metadata.toml.
        catalog.skills[skillId] = {
          id: skillId,
          displayName: recipe.name || skillId,
          description: recipe.description || '',
          path: `skills/${skillId}`,
          addedAt: skillAddedAt.get(skillId) ?? new Date().toISOString(),
          tags: skillTags.get(skillId) ?? [],
          license: recipe.license,
        };
      } catch {
        // Skip directory if SKILL.md not accessible
      }
    }

    for (const skillId of Object.keys(catalog.skills)) {
      if (!activeSkillIds.has(skillId)) {
        delete catalog.skills[skillId];
      }
    }
  } catch {
    // Directory doesn't exist, skip
  }

  if (needsSync) {
    await writeCatalogAtomic(catalog);
  }

  // Auto-migrate from old format if needed
  await ensureMigrated();

  return catalog;
}

const LOCK_TIMEOUT = 5000; // 5 seconds
const LOCK_RETRY_INTERVAL = 50; // 50ms

/**
 * Acquire a file lock for catalog mutations.
 */
async function acquireLock(): Promise<void> {
  const lockPath = getCatalogLockPath();
  const startTime = Date.now();

  while (true) {
    try {
      // Create the lock file. 'wx' fails if the file already exists.
      const handle = await fs.open(lockPath, 'wx');
      await handle.close();
      return; // Lock acquired
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        // Lock file exists, check if it's orphaned (e.g. older than 10 seconds)
        try {
          const stat = await fs.stat(lockPath);
          const age = Date.now() - stat.mtimeMs;
          if (age > 10000) {
            // Orphaned lock, remove it
            await fs.rm(lockPath, { force: true });
            continue; // Try acquiring again immediately
          }
        } catch {
          // If stat fails (e.g. file was just deleted), ignore and retry
        }

        if (Date.now() - startTime > LOCK_TIMEOUT) {
          throw new Error(`Failed to acquire lock on ${lockPath}: timeout reached`);
        }
        await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_INTERVAL));
      } else {
        throw err;
      }
    }
  }
}

/**
 * Release the file lock.
 */
async function releaseLock(): Promise<void> {
  const lockPath = getCatalogLockPath();
  await fs.rm(lockPath, { force: true });
}

/**
 * Write the catalog to disk atomically.
 */
async function writeCatalogAtomic(catalog: CatalogFile): Promise<void> {
  const catalogPath = getCatalogPath();
  const tempPath = `${catalogPath}.tmp`;

  // The skill index is rebuilt from the directory on every load, so persisting
  // it only produced a second place to disagree with — and the two did, by 62
  // entries. The file holds MCP recipes, which have no directory to derive
  // them from.
  const { skills: _derived, ...persisted } = catalog;

  await acquireLock();
  try {
    await fs.writeFile(tempPath, TOML.stringify(persisted as any), 'utf8');
    await fs.rename(tempPath, catalogPath);
  } finally {
    await releaseLock();
  }
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
/**
 * Read the parts of a skill's record the filesystem cannot supply.
 *
 * `addedAt` and user tags are knowledge, not derivable from files, so they live
 * in skills-metadata.toml. Everything else in the index — id, path, display
 * name, description, license — is read from the directory and its frontmatter,
 * which is why the index is no longer written back to catalog.toml.
 */
/**
 * Move `addedAt` out of a catalog file written by an older version.
 *
 * Runs once: after the index stops being persisted, there is nothing left to
 * adopt. Existing metadata always wins, so re-running cannot rewrite history.
 */
async function adoptAddedAtFromCatalog(catalog: CatalogFile): Promise<void> {
  const stored = Object.values(catalog.skills ?? {});
  if (stored.length === 0) return;

  try {
    const { loadSkillsMetadata, saveSkillsMetadata } = await import('./skills-metadata.js');
    const data = await loadSkillsMetadata();

    let adopted = 0;
    for (const entry of stored) {
      if (!entry.addedAt) continue;
      const meta = data.skills[entry.id] ?? {};
      if (meta.installedAt) continue;
      data.skills[entry.id] = { ...meta, installedAt: entry.addedAt };
      adopted++;
    }

    if (adopted > 0) await saveSkillsMetadata(data);
  } catch {
    // Metadata is optional; the index still works without it.
  }
}

async function loadSkillIndexMetadata(): Promise<{
  skillAddedAt: Map<string, string>;
  skillTags: Map<string, string[]>;
}> {
  const skillAddedAt = new Map<string, string>();
  const skillTags = new Map<string, string[]>();

  try {
    const { loadSkillsMetadata } = await import('./skills-metadata.js');
    const data = await loadSkillsMetadata();
    for (const [id, meta] of Object.entries(data.skills)) {
      if (meta.installedAt) skillAddedAt.set(id, meta.installedAt);
      if (meta.tags) skillTags.set(id, meta.tags);
    }
  } catch {
    // Metadata is optional.
  }

  return { skillAddedAt, skillTags };
}

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

  // Copy all files from source directory recursively
  await fs.cp(sourceDir, skillDir, { recursive: true });

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
  const recipe: SkillRecipe = {
    name: 'unknown',
    description: '',
    content,
  };

  try {
    const parsed = YAML.parse(yamlText);
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.name === 'string') {
        recipe.name = parsed.name;
      }
      if (typeof parsed.description === 'string') {
        recipe.description = parsed.description;
      }
      if (typeof parsed.license === 'string') {
        recipe.license = parsed.license;
      }
    }
  } catch {
    // Malformed YAML frontmatter, fallback
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
  const catalog = YAML.parse(raw) as CatalogFile;

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
