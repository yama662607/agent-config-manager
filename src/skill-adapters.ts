import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { TargetName, SkillRecipe } from './types.js';
import { AGENT_GLOBAL_SKILLS_DIR, isHomeScope } from './agent-paths.js';

// ============================================================================
// Constants
// ============================================================================

/** Maximum size for skill files (1MB) */
const MAX_SKILL_SIZE = 1024 * 1024;

/**
 * How a skill directory is placed into a target.
 * - `link`: symlink to the catalog directory (no duplication, cannot drift)
 * - `copy`: independent copy (portable, but drifts once the catalog changes)
 */
export type SkillPlacementMode = 'link' | 'copy';

/**
 * Default placement for a destination.
 *
 * Home directories are personal, so linking keeps every provider pointing at the
 * one catalog copy. Project directories are shared through version control, where
 * an absolute symlink would break for anyone else, so those are copied.
 */
export function defaultPlacementMode(projectRoot: string): SkillPlacementMode {
  return path.resolve(projectRoot) === os.homedir() ? 'link' : 'copy';
}

/** Valid skill name pattern: alphanumeric, hyphens, underscores, dots */
const SKILL_NAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a skill name to prevent path traversal and injection.
 */
export function validateSkillName(skillName: string): void {
  if (!skillName || skillName.length === 0) {
    throw new Error('Skill name cannot be empty');
  }

  if (skillName.length > 100) {
    throw new Error('Skill name too long (max 100 characters)');
  }

  if (!SKILL_NAME_PATTERN.test(skillName)) {
    throw new Error('Skill name must contain only alphanumeric characters, hyphens, underscores, and dots');
  }

  // Prevent path traversal
  if (skillName.includes('..') || skillName.includes('/') || skillName.includes('\\')) {
    throw new Error('Skill name cannot contain path traversal characters');
  }

  // Prevent leading/trailing dots and dashes (security issues)
  if (skillName.startsWith('.') || skillName.startsWith('-') ||
      skillName.endsWith('.') || skillName.endsWith('-')) {
    throw new Error('Skill name cannot start or end with a dot or dash');
  }
}

// ============================================================================
// Skill Path Resolution
// ============================================================================

/**
 * Get the skills directory path for a target.
 * - Claude: <project>/.claude/skills/
 * - Codex: <project>/.codex/skills/
 * - Antigravity: <project>/.agents/skills/
 * - Grok: <project>/.grok/skills/
 *
 * The home directory is not a project: each target has its own machine-wide
 * root, which for Antigravity is not simply `~` plus the project-relative path.
 */
export function getSkillsDir(projectRoot: string, target: TargetName): string {
  if (isHomeScope(projectRoot)) {
    return AGENT_GLOBAL_SKILLS_DIR[target];
  }

  switch (target) {
    case 'claude':
      return path.join(projectRoot, '.claude', 'skills');
    case 'codex':
      return path.join(projectRoot, '.codex', 'skills');
    case 'antigravity':
      return path.join(projectRoot, '.agents', 'skills');
    case 'grok':
      return path.join(projectRoot, '.grok', 'skills');
  }
}

/**
 * Get the skill directory path for a specific skill.
 */
export function getSkillDir(projectRoot: string, target: TargetName, skillName: string): string {
  const skillsDir = getSkillsDir(projectRoot, target);
  return path.join(skillsDir, skillName);
}

/**
 * Get the SKILL.md file path for a specific skill.
 */
export function getSkillFilePath(projectRoot: string, target: TargetName, skillName: string): string {
  const skillDir = getSkillDir(projectRoot, target, skillName);
  return path.join(skillDir, 'SKILL.md');
}

// ============================================================================
// Skill File Operations
// ============================================================================

/**
 * Read a skill file from disk.
 */
export async function readSkill(
  projectRoot: string,
  target: TargetName,
  skillName: string
): Promise<{ exists: boolean; content: string | null }> {
  validateSkillName(skillName);

  const skillPath = getSkillFilePath(projectRoot, target, skillName);

  try {
    await fs.access(skillPath);
    const content = await fs.readFile(skillPath, 'utf8');

    // Check content size
    if (content.length > MAX_SKILL_SIZE) {
      throw new Error('Skill file too large');
    }

    return { exists: true, content };
  } catch {
    return { exists: false, content: null };
  }
}

/**
 * Write a skill file to disk atomically.
 */
export async function writeSkill(
  projectRoot: string,
  target: TargetName,
  skillName: string,
  content: string
): Promise<void> {
  validateSkillName(skillName);

  // Check content size before writing
  if (content.length > MAX_SKILL_SIZE) {
    throw new Error(`Skill content too large (${content.length} bytes, max ${MAX_SKILL_SIZE})`);
  }

  const skillDir = getSkillDir(projectRoot, target, skillName);
  const skillPath = getSkillFilePath(projectRoot, target, skillName);

  // Create skill directory if it doesn't exist
  await fs.mkdir(skillDir, { recursive: true });

  // Write atomically
  const tempPath = `${skillPath}.tmp`;
  await fs.writeFile(tempPath, content, 'utf8');
  await fs.rename(tempPath, skillPath);
}

/**
 * Remove a skill directory.
 */
export async function removeSkill(
  projectRoot: string,
  target: TargetName,
  skillName: string
): Promise<boolean> {
  validateSkillName(skillName);

  const skillDir = getSkillDir(projectRoot, target, skillName);

  try {
    await fs.access(skillDir);
  } catch {
    return false; // Doesn't exist
  }

  await fs.rm(skillDir, { recursive: true, force: true });
  return true;
}

/**
 * Add a skill to a project.
 */
export async function addSkillToConfig(
  projectRoot: string,
  target: TargetName,
  skillId: string,
  content: string
): Promise<void> {
  await writeSkill(projectRoot, target, skillId, content);
}

/**
 * Place an entire skill directory (SKILL.md plus any references/, scripts/,
 * assets/, etc. subdirectories) from a source directory into a project's
 * target skill directory.
 *
 * - `link` creates a symlink to the catalog directory. The catalog stays the
 *   single source of truth, so the destination can never drift.
 * - `copy` duplicates the directory, which keeps the destination portable
 *   (a repository can be shared without the symlink target existing).
 *
 * An existing destination is replaced either way.
 */
export async function copySkillDirToConfig(
  projectRoot: string,
  target: TargetName,
  skillId: string,
  sourceDir: string,
  mode: SkillPlacementMode = 'copy'
): Promise<void> {
  validateSkillName(skillId);

  const skillDir = getSkillDir(projectRoot, target, skillId);
  await fs.mkdir(path.dirname(skillDir), { recursive: true });
  await fs.rm(skillDir, { recursive: true, force: true });

  if (mode === 'link') {
    await fs.symlink(await stableLinkTarget(sourceDir, skillId), skillDir);
    return;
  }

  // dereference: a catalog entry may itself be a link to a development
  // repository, and a copy must be real content — that is the whole point of
  // copying into a project rather than linking.
  await fs.cp(sourceDir, skillDir, { recursive: true, force: true, dereference: true });
}

/**
 * Remove a skill from a project.
 */
export async function removeSkillFromConfig(
  projectRoot: string,
  target: TargetName,
  skillName: string
): Promise<void> {
  await removeSkill(projectRoot, target, skillName);
}

// ============================================================================
// Skill Status Queries
// ============================================================================

/**
 * Get all skills from a project's native config directories.
 */
export async function getSkills(
  projectRoot: string,
  target: TargetName
): Promise<Record<string, { enabled: boolean }>> {
  const skillsDir = getSkillsDir(projectRoot, target);
  const skills: Record<string, { enabled: boolean }> = {};

  // Grok reads skills from directories registered in config.toml rather than
  // from copies ACM places, so those registrations are part of its status.
  if (target === 'grok') {
    Object.assign(skills, await getGrokRegisteredSkills(projectRoot));
  }

  try {
    await fs.access(skillsDir);
  } catch {
    return skills; // Directory doesn't exist
  }

  const entries = await fs.readdir(skillsDir, { withFileTypes: true });

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

    const skillName = entry.name;

    // Validate skill name to skip invalid entries
    try {
      validateSkillName(skillName);
    } catch {
      // Skip invalid skill names
      continue;
    }

    const skillPath = path.join(skillsDir, skillName, 'SKILL.md');

    try {
      await fs.access(skillPath);
      // All skills are considered "enabled" if the SKILL.md file exists
      skills[skillName] = { enabled: true };
    } catch {
      // SKILL.md doesn't exist, skip
    }
  }

  return skills;
}

/**
 * Check if a skill is enabled for a target.
 */
export async function isSkillEnabled(
  projectRoot: string,
  target: TargetName,
  skillName: string
): Promise<boolean> {
  const { exists } = await readSkill(projectRoot, target, skillName);
  return exists;
}

/**
 * Skills Grok picks up through `[skills] paths` registrations, with
 * `[skills] disabled` applied.
 */
async function getGrokRegisteredSkills(
  projectRoot: string
): Promise<Record<string, { enabled: boolean }>> {
  const { getDisabledSkills, getRegisteredSkillPaths } = await import('./grok-skills.js');

  const configPath = path.join(projectRoot, '.grok', 'config.toml');
  const skills: Record<string, { enabled: boolean }> = {};

  let registeredPaths: string[];
  let disabled: string[];
  try {
    registeredPaths = await getRegisteredSkillPaths(configPath);
    disabled = await getDisabledSkills(configPath);
  } catch {
    return skills; // Unreadable or unparsable config
  }

  for (const dir of registeredPaths) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // Registered path no longer exists
    }

    for (const entry of entries) {
      const name = entry.name;

      try {
        validateSkillName(name);
      } catch {
        continue;
      }

      try {
        await fs.access(path.join(dir, name, 'SKILL.md'));
      } catch {
        continue; // Not a skill directory
      }

      skills[name] = { enabled: !disabled.includes(name) };
    }
  }

  return skills;
}

/**
 * Prefer the state directory as the link target when it leads to the same
 * content.
 *
 * `~/.acm/skills/<id>` is a fixed address; the catalog behind it can be moved.
 * Pointing thousands of distributed links at that address instead of at the
 * catalog's current location means relocating the catalog only requires
 * updating one symlink rather than every distribution.
 *
 * Falls back to the source path whenever the state directory does not resolve
 * to the very same directory.
 */
async function stableLinkTarget(sourceDir: string, skillId: string): Promise<string> {
  const resolved = path.resolve(sourceDir);
  const viaState = path.join(os.homedir(), '.acm', 'skills', skillId);

  try {
    const [a, b] = await Promise.all([fs.realpath(viaState), fs.realpath(resolved)]);
    if (a === b) return viaState;
  } catch {
    // No state-directory entrance, or it points somewhere else.
  }

  return resolved;
}
