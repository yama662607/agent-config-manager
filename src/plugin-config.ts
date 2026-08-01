/**
 * Plugin Configuration
 *
 * Manages ~/.acm/config.toml — user-configurable scan paths and settings.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as TOML from 'smol-toml';
import { getConfigPath } from './acm-config.js';

const CONFIG_PATH = getConfigPath();

interface PluginConfig {
  /** Additional plugin scan paths (absolute) */
  extraPluginPaths?: string[];
  /** Last scan timestamp (ISO 8601) */
  lastScanAt?: string;
  /** Last scan snapshot file path */
  lastSnapshotPath?: string;
}

export async function loadPluginConfig(): Promise<PluginConfig> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    const parsed = TOML.parse(raw) as any;
    return {
      extraPluginPaths: parsed?.extraPluginPaths ?? [],
      lastScanAt: parsed?.lastScanAt,
      lastSnapshotPath: parsed?.lastSnapshotPath,
    };
  } catch {
    return { extraPluginPaths: [] };
  }
}

/**
 * Write plugin settings, preserving every other key in the file.
 * config.toml is shared with the rest of the tool (catalog_dir lives there too),
 * so a plugin scan must not drop settings it does not know about.
 */
export async function savePluginConfig(config: PluginConfig): Promise<void> {
  const dir = path.dirname(CONFIG_PATH);
  await fs.mkdir(dir, { recursive: true });

  let existing: Record<string, unknown> = {};
  try {
    existing = TOML.parse(await fs.readFile(CONFIG_PATH, 'utf8')) as Record<string, unknown>;
  } catch {
    // No file yet, or unreadable: start from an empty document.
  }

  const merged = { ...existing, ...config };
  const tmp = CONFIG_PATH + '.tmp';
  await fs.writeFile(tmp, TOML.stringify(merged as any), 'utf8');
  await fs.rename(tmp, CONFIG_PATH);
}


