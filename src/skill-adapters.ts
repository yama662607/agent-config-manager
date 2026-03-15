import fs from 'node:fs/promises';
import path from 'node:path';
import type { TargetName, SkillRecipe } from './types.js';

// ============================================================================
// Constants
// ============================================================================

/** Maximum size for skill files (1MB) */
const MAX_SKILL_SIZE = 1024 * 1024;

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
 * - Gemini: <project>/.gemini/skills/
 */
export function getSkillsDir(projectRoot: string, target: TargetName): string {
  switch (target) {
    case 'claude':
      return path.join(projectRoot, '.claude', 'skills');
    case 'codex':
      return path.join(projectRoot, '.codex', 'skills');
    case 'gemini':
      return path.join(projectRoot, '.gemini', 'skills');
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

  try {
    await fs.access(skillsDir);
  } catch {
    return skills; // Directory doesn't exist
  }

  const entries = await fs.readdir(skillsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

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
