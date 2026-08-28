/**
 * Enhanced Skill Metadata Store
 *
 * Reads/writes ~/.acm/skills-metadata.toml — a separate file from catalog.toml
 * to avoid breaking external tools that share the same catalog.toml schema.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as TOML from 'smol-toml';
import { getCatalogDir } from './acm-config.js';
import type { EnhancedSkillMetadata, SkillsMetadataFile } from './types.js';

// ============================================================================
// Constants
// ============================================================================

const METADATA_FILE = 'skills-metadata.toml';
const METADATA_VERSION = '1.0';

// ============================================================================
// Path Resolution
// ============================================================================

export function getSkillsMetadataPath(): string {
  return path.join(getCatalogDir(), METADATA_FILE);
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Load skills metadata from disk.
 * Returns empty if file doesn't exist.
 */
export async function loadSkillsMetadata(): Promise<SkillsMetadataFile> {
  const filePath = getSkillsMetadataPath();

  try {
    await fs.access(filePath);
  } catch {
    return { version: METADATA_VERSION, skills: {} };
  }

  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = TOML.parse(raw) as any;

  return {
    version: parsed?.version ?? METADATA_VERSION,
    skills: parsed?.skills ?? {},
  };
}

/**
 * Save skills metadata to disk atomically.
 */
export async function saveSkillsMetadata(data: SkillsMetadataFile): Promise<void> {
  const filePath = getSkillsMetadataPath();
  const dir = path.dirname(filePath);

  await fs.mkdir(dir, { recursive: true });

  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, TOML.stringify(data as any), 'utf8');
  await fs.rename(tempPath, filePath);
}

/**
 * Get metadata for a single skill.
 */
export async function getSkillMetadata(id: string): Promise<EnhancedSkillMetadata | null> {
  const data = await loadSkillsMetadata();
  return data.skills[id] ?? null;
}

/**
 * Set metadata for a single skill.
 */
export async function setSkillMetadata(id: string, meta: EnhancedSkillMetadata): Promise<void> {
  const data = await loadSkillsMetadata();
  data.skills[id] = meta;
  await saveSkillsMetadata(data);
}

/**
 * List all skill metadata entries, optionally filtered.
 */
export interface SkillMetadataFilter {
  plugin?: string;
  agent?: string;
  sourceType?: string;
  category?: string;
  pinned?: boolean;
  deprecated?: boolean;
  /** Free-text search in displayName and description (from catalog) */
  search?: string;
}

export async function listSkillsMetadata(filter?: SkillMetadataFilter): Promise<EnhancedSkillMetadata[]> {
  const data = await loadSkillsMetadata();
  const entries = Object.values(data.skills);

  if (!filter) return entries;

  return entries.filter((e) => {
    if (filter.plugin !== undefined && e.plugin !== filter.plugin) return false;
    if (filter.agent !== undefined && e.agent !== filter.agent) return false;
    if (filter.sourceType !== undefined && e.sourceType !== filter.sourceType) return false;
    if (filter.category !== undefined && e.category !== filter.category) return false;
    if (filter.pinned !== undefined && e.pinned !== filter.pinned) return false;
    if (filter.deprecated !== undefined && e.deprecated !== filter.deprecated) return false;
    return true;
  });
}

/**
 * Bulk import metadata entries (merge with existing).
 */
export async function bulkImportMetadata(entries: Record<string, EnhancedSkillMetadata>): Promise<number> {
  const data = await loadSkillsMetadata();
  let count = 0;

  for (const [id, meta] of Object.entries(entries)) {
    const existing = data.skills[id];
    // Merge: new fields overwrite, but preserve existing if new is undefined
    data.skills[id] = {
      sourceType: meta.sourceType ?? existing?.sourceType,
      agent: meta.agent ?? existing?.agent,
      plugin: meta.plugin ?? existing?.plugin,
      category: meta.category ?? existing?.category,
      version: meta.version ?? existing?.version,
      author: meta.author ?? existing?.author,
      updatedAt: meta.updatedAt ?? existing?.updatedAt,
      pinned: meta.pinned ?? existing?.pinned,
      deprecated: meta.deprecated ?? existing?.deprecated,
      tags: meta.tags ?? existing?.tags,
    };
    count++;
  }

  await saveSkillsMetadata(data);
  return count;
}
