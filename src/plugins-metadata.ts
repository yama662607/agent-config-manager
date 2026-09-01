/**
 * Plugin Metadata Store
 *
 * Reads/writes ~/.acm/plugins-metadata.toml — the plugin registry.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as TOML from 'smol-toml';
import { getCatalogDir } from './acm-config.js';
import type { PluginEntry, PluginsMetadataFile } from './types.js';

// ============================================================================
// Constants
// ============================================================================

const METADATA_FILE = 'plugins-metadata.toml';
const METADATA_VERSION = '1.0';

// ============================================================================
// Path Resolution
// ============================================================================

export function getPluginsMetadataPath(): string {
  return path.join(getCatalogDir(), METADATA_FILE);
}

/** Validate plugin name to prevent path traversal. */
export function validatePluginName(name: string): void {
  if (!name || name.length === 0) throw new Error('Plugin name cannot be empty');
  if (name.length > 100) throw new Error('Plugin name too long (max 100)');
  if (name.includes('..') || name.includes('/') || name.includes('\\')) throw new Error('Plugin name cannot contain path traversal characters');
  if (name.startsWith('.') || name.startsWith('-')) throw new Error('Plugin name cannot start with . or -');
  // Block unicode confusables (homoglyph protection)
  if (/[Ѐ-ӿ​-‍﻿]/.test(name)) throw new Error('Plugin name contains potentially confusing unicode characters');
}

export function getPluginInstallDir(name: string): string {
  return path.join(getCatalogDir(), 'plugins', name);
}

// ============================================================================
// CRUD Operations
// ============================================================================

export async function loadPluginsMetadata(): Promise<PluginsMetadataFile> {
  const filePath = getPluginsMetadataPath();
  try {
    await fs.access(filePath);
  } catch {
    return { version: METADATA_VERSION, plugins: {} };
  }
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = TOML.parse(raw) as any;
  return {
    version: parsed?.version ?? METADATA_VERSION,
    plugins: parsed?.plugins ?? {},
  };
}

export async function savePluginsMetadata(data: PluginsMetadataFile): Promise<void> {
  const filePath = getPluginsMetadataPath();
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, TOML.stringify(data as any), 'utf8');
  await fs.rename(tempPath, filePath);
}

export async function getPluginEntry(name: string): Promise<PluginEntry | null> {
  const data = await loadPluginsMetadata();
  return data.plugins[name] ?? null;
}

export async function addPluginEntry(entry: PluginEntry): Promise<void> {
  const data = await loadPluginsMetadata();
  data.plugins[entry.name] = entry;
  await savePluginsMetadata(data);
}

export async function removePluginEntry(name: string): Promise<boolean> {
  const data = await loadPluginsMetadata();
  if (!data.plugins[name]) return false;
  delete data.plugins[name];
  await savePluginsMetadata(data);
  return true;
}

export async function listPlugins(): Promise<PluginEntry[]> {
  const data = await loadPluginsMetadata();
  return Object.values(data.plugins);
}
