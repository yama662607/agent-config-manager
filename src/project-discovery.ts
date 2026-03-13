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
  gemini: path.join('.gemini', 'settings.json'),
};

/** Skills directory paths for each target relative to project root */
const TARGET_SKILLS_PATHS: Record<TargetName, string> = {
  claude: path.join('.claude', 'skills'),
  codex: path.join('.codex', 'skills'),
  gemini: path.join('.gemini', 'antigravity', 'skills'),
};

// ============================================================================
// Project Discovery
// ============================================================================

/**
 * Discover the active project from the current working directory.
 *
 * Priority:
 * 1. Nearest ancestor that is a Git repository root (excluding home directory)
 * 2. Nearest ancestor containing any supported native config file
 * 3. Fail with clear error
 */
export async function discoverProject(cwd: string = process.cwd()): Promise<ProjectDiscovery> {
  const gitRoot = await findGitRoot(cwd);
  const projectRoot = gitRoot ?? (await findNativeConfigRoot(cwd));

  if (!projectRoot) {
    throw new Error(
      'Not inside a managed project. ' +
      'Navigate to a Git repository or a directory with native agent config files.'
    );
  }

  const targets = await resolveNativeConfigPaths(projectRoot);
  return { root: projectRoot, targets };
}

/**
 * Find the nearest Git repository root by traversing upwards.
 * Excludes home directory to prevent false positives.
 */
async function findGitRoot(cwd: string): Promise<string | null> {
  let current = path.resolve(cwd);
  const homeDir = os.homedir();

  while (true) {
    // Check if we've reached or passed the home directory
    const normalizedCurrent = path.normalize(current);
    const normalizedHome = path.normalize(homeDir);

    // Skip if we're at or above home directory
    if (normalizedCurrent === normalizedHome || normalizedCurrent === path.dirname(normalizedHome)) {
      return null;
    }

    const gitDir = path.join(current, '.git');
    try {
      const stat = await fs.stat(gitDir);
      if (stat.isDirectory() || stat.isFile()) {
        // .git exists (directory for normal repos, file for worktrees)
        return current;
      }
    } catch {
      // .git doesn't exist, continue
    }

    const parent = path.dirname(current);
    if (parent === current) {
      // Reached root
      return null;
    }
    current = parent;
  }
}

/**
 * Find the nearest ancestor containing any supported native config file.
 * Excludes home directory.
 */
async function findNativeConfigRoot(cwd: string): Promise<string | null> {
  let current = path.resolve(cwd);
  const homeDir = os.homedir();

  while (true) {
    // Check if we've reached or passed the home directory
    const normalizedCurrent = path.normalize(current);
    const normalizedHome = path.normalize(homeDir);

    // Skip if we're at or above home directory
    if (normalizedCurrent === normalizedHome || normalizedCurrent === path.dirname(normalizedHome)) {
      return null;
    }

    for (const targetPath of Object.values(TARGET_CONFIG_PATHS)) {
      const fullPath = path.join(current, targetPath);
      try {
        await fs.access(fullPath);
        return current;
      } catch {
        // File doesn't exist, try next
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      // Reached root
      return null;
    }
    current = parent;
  }
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
