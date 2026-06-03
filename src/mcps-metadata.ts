/**
 * Enhanced MCP Metadata Store
 *
 * Reads/writes ~/.acm/mcps-metadata.toml — a separate file from catalog.toml
 * with rich metadata for MCP servers.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as TOML from 'smol-toml';
import type { EnhancedMcpMetadata, McpsMetadataFile } from './types.js';

// ============================================================================
// Constants
// ============================================================================

const METADATA_DIR = '.acm';
const METADATA_FILE = 'mcps-metadata.toml';
const METADATA_VERSION = '1.0';

// ============================================================================
// Path Resolution
// ============================================================================

export function getMcpsMetadataPath(): string {
  return path.join(os.homedir(), METADATA_DIR, METADATA_FILE);
}

// ============================================================================
// CRUD Operations
// ============================================================================

export async function loadMcpsMetadata(): Promise<McpsMetadataFile> {
  const filePath = getMcpsMetadataPath();
  try {
    await fs.access(filePath);
  } catch {
    return { version: METADATA_VERSION, mcps: {} };
  }
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = TOML.parse(raw) as any;
  return {
    version: parsed?.version ?? METADATA_VERSION,
    mcps: parsed?.mcps ?? {},
  };
}

export async function saveMcpsMetadata(data: McpsMetadataFile): Promise<void> {
  const filePath = getMcpsMetadataPath();
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, TOML.stringify(data as any), 'utf8');
  await fs.rename(tempPath, filePath);
}

export async function getMcpMetadata(id: string): Promise<EnhancedMcpMetadata | null> {
  const data = await loadMcpsMetadata();
  // Exact match first
  if (data.mcps[id]) return data.mcps[id];
  // Try fuzzy match: check if any metadata key contains the id or vice versa
  for (const [key, meta] of Object.entries(data.mcps)) {
    if (key.includes(id) || id.includes(key)) return meta;
    // Match by package name
    if (meta.package && (meta.package === id || id.includes(meta.package) || meta.package.includes(id))) return meta;
  }
  return null;
}

export async function setMcpMetadata(id: string, meta: EnhancedMcpMetadata): Promise<void> {
  const data = await loadMcpsMetadata();
  data.mcps[id] = meta;
  await saveMcpsMetadata(data);
}

// ============================================================================
// Filter
// ============================================================================

export interface McpMetadataFilter {
  category?: string;
  language?: string;
  transport?: string;
  popularity?: string;
  pinned?: boolean;
  deprecated?: boolean;
  search?: string;
}

export async function listMcpsMetadata(filter?: McpMetadataFilter): Promise<EnhancedMcpMetadata[]> {
  const data = await loadMcpsMetadata();
  const entries = Object.values(data.mcps);
  if (!filter) return entries;
  return entries.filter((e) => {
    if (filter.category !== undefined && e.category !== filter.category) return false;
    if (filter.language !== undefined && e.language !== filter.language) return false;
    if (filter.transport !== undefined && e.transport !== filter.transport) return false;
    if (filter.popularity !== undefined && e.popularity !== filter.popularity) return false;
    if (filter.pinned !== undefined && e.pinned !== filter.pinned) return false;
    if (filter.deprecated !== undefined && e.deprecated !== filter.deprecated) return false;
    return true;
  });
}

export async function bulkImportMcpsMetadata(entries: Record<string, EnhancedMcpMetadata>): Promise<number> {
  const data = await loadMcpsMetadata();
  let count = 0;
  for (const [id, meta] of Object.entries(entries)) {
    const existing = data.mcps[id];
    data.mcps[id] = {
      displayName: meta.displayName ?? existing?.displayName,
      descriptionJa: meta.descriptionJa ?? existing?.descriptionJa,
      descriptionEn: meta.descriptionEn ?? existing?.descriptionEn,
      category: meta.category ?? existing?.category,
      language: meta.language ?? existing?.language,
      transport: meta.transport ?? existing?.transport,
      package: meta.package ?? existing?.package,
      github: meta.github ?? existing?.github,
      website: meta.website ?? existing?.website,
      popularity: meta.popularity ?? existing?.popularity,
      sourceType: meta.sourceType ?? existing?.sourceType,
      agent: meta.agent ?? existing?.agent,
      addedAt: meta.addedAt ?? existing?.addedAt,
      pinned: meta.pinned ?? existing?.pinned,
      deprecated: meta.deprecated ?? existing?.deprecated,
      tags: meta.tags ?? existing?.tags,
    };
    count++;
  }
  await saveMcpsMetadata(data);
  return count;
}
