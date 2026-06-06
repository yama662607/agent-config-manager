/**
 * Plugin Configuration
 *
 * Manages ~/.acm/config.toml — user-configurable scan paths and settings.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as TOML from 'smol-toml';

const CONFIG_PATH = path.join(os.homedir(), '.acm', 'config.toml');

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

export async function savePluginConfig(config: PluginConfig): Promise<void> {
  const dir = path.dirname(CONFIG_PATH);
  await fs.mkdir(dir, { recursive: true });
  const tmp = CONFIG_PATH + '.tmp';
  await fs.writeFile(tmp, TOML.stringify(config as any), 'utf8');
  await fs.rename(tmp, CONFIG_PATH);
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}
