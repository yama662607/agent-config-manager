import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { ProjectDiscovery, NativeConfigPath, TargetName } from './types.js';

// ============================================================================
// Constants
// ============================================================================

/** Native config file paths for each target relative to project root */
const TARGET_CONFIG_PATHS: Record<TargetName, string> = {
  claude: '.mcp.json',
  codex: path.join('.codex', 'config.toml'),
  antigravity: path.join('.agents', 'mcp_config.json'),
};

/** Skills directory paths for each target relative to project root */
const TARGET_SKILLS_PATHS: Record<TargetName, string> = {
  claude: path.join('.claude', 'skills'),
  codex: path.join('.codex', 'skills'),
  antigravity: path.join('.agents', 'skills'),
};

// ============================================================================
// Project Discovery
// ============================================================================

/**
 * Options for project discovery.
 */
export interface DiscoverProjectOptions {
  /** Allow using home directory as project root */
  allowHome?: boolean;
}

/**
 * Discover the active project from the current working directory.
 * Uses the current directory as the project root, unless `allowHome` is set,
 * in which case the home directory is targeted regardless of cwd.
 */
export async function discoverProject(
  cwd: string = process.cwd(),
  options?: DiscoverProjectOptions
): Promise<ProjectDiscovery> {
  const homeDir = os.homedir();

  // --home targets the home directory (global configs) regardless of cwd.
  if (options?.allowHome) {
    const targets = await resolveNativeConfigPaths(homeDir);
    return { root: homeDir, targets };
  }

  const currentDir = path.resolve(cwd);

  // Prevent using home directory as project root unless --home was passed.
  if (currentDir === homeDir || currentDir === path.dirname(homeDir)) {
    throw new Error(
      'Cannot use home directory as project root. ' +
      'Use --home to enable global config management, or navigate to a project directory.'
    );
  }

  const targets = await resolveNativeConfigPaths(currentDir);
  return { root: currentDir, targets };
}

/**
 * Resolve native config paths for all targets relative to the project root.
 */
async function resolveNativeConfigPaths(projectRoot: string): Promise<Map<TargetName, NativeConfigPath>> {
  const targets = new Map<TargetName, NativeConfigPath>();

  for (const [target, relativePath] of Object.entries(TARGET_CONFIG_PATHS) as [TargetName, string][]) {
    const fullPath = path.join(projectRoot, relativePath);
    let exists = false;

    try {
      await fs.access(fullPath);
      exists = true;
    } catch {
      // File doesn't exist
    }

    targets.set(target, {
      target,
      path: fullPath,
      exists,
    });
  }

  return targets;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Get the relative path from project root to a config file.
 */
export function getRelativeConfigPath(projectRoot: string, target: TargetName): string {
  return TARGET_CONFIG_PATHS[target];
}

/**
 * Get the relative path from project root to the skills directory.
 */
export function getSkillsPath(projectRoot: string, target: TargetName): string {
  return path.join(projectRoot, TARGET_SKILLS_PATHS[target]);
}

/**
 * Get the skills directory paths constant.
 */
export { TARGET_SKILLS_PATHS };
