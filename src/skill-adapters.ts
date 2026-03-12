import fs from 'node:fs/promises';
import path from 'node:path';
import type { TargetName, SkillRecipe } from './types.js';

// ============================================================================
// Skill Path Resolution
// ============================================================================

/**
 * Get the skills directory path for a target.
 * - Claude: <project>/.claude/skills/
 * - Codex: <project>/.codex/skills/
 * - Gemini: <project>/.gemini/antigravity/skills/
 */
export function getSkillsDir(projectRoot: string, target: TargetName): string {
  switch (target) {
    case 'claude':
      return path.join(projectRoot, '.claude', 'skills');
    case 'codex':
      return path.join(projectRoot, '.codex', 'skills');
    case 'gemini':
      return path.join(projectRoot, '.gemini', 'antigravity', 'skills');
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
  const skillPath = getSkillFilePath(projectRoot, target, skillName);

  try {
    await fs.access(skillPath);
    const content = await fs.readFile(skillPath, 'utf8');
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
