import type { SkillWorkspaceStatus, TargetName } from './types.js';
import { discoverProject } from './project-discovery.js';
import { getSkills } from './skill-adapters.js';

// ============================================================================
// Status Command
// ============================================================================

/**
 * Show skill status for the current project.
 */
export async function skillStatus(verbose: boolean = false): Promise<void> {
  const discovery = await discoverProject();
  const status = await buildSkillStatus(discovery.root);

  printSkillStatus(status, verbose);
}

async function buildSkillStatus(projectRoot: string): Promise<SkillWorkspaceStatus> {
  const { targets } = await discoverProject();

  const skillMap = new Map<string, { name: string; enabled: boolean; targets: TargetName[]; source: 'catalog' | 'inline' }>();

  for (const [target, configPath] of targets.entries()) {
    if (!configPath.exists) continue;

    const skills = await getSkills(projectRoot, target);

    for (const [name, info] of Object.entries(skills)) {
      if (!info.enabled) continue;

      const existing = skillMap.get(name);
      if (existing) {
        existing.targets.push(target);
      } else {
        skillMap.set(name, {
          name,
          enabled: true,
          targets: [target],
          source: 'inline', // TODO: detect from catalog
        });
      }
    }
  }

  const skills = Array.from(skillMap.values());
  const enabledCount = skills.filter((s) => s.enabled).length;

  return {
    projectRoot,
    skills,
    totalCount: skills.length,
    enabledCount,
  };
}

function printSkillStatus(status: SkillWorkspaceStatus, verbose: boolean): void {
  console.log(`Project: ${status.projectRoot}`);
  console.log(`Skills (${status.totalCount} total, ${status.enabledCount} enabled):\n`);

  if (status.skills.length === 0) {
    console.log('No skills configured.');
    console.log('Run `acsync skill add <name>` to add a skill.\n');
    return;
  }

  if (verbose) {
    // Verbose output
    for (const skill of status.skills) {
      console.log(`Skill: ${skill.name}`);
      console.log(`  Status: ${skill.enabled ? '✓' : '✗'} ${skill.enabled ? 'Enabled' : 'Disabled'}`);
      console.log(`  Targets: ${skill.targets.join(', ') || '(none)'}`);
      console.log(`  Source: ${skill.source}\n`);
    }
  } else {
    // Compact table output
    const NAME_WIDTH = 30;
    const ENABLED_WIDTH = 7;
    const TARGETS_WIDTH = 15;
    const SOURCE_WIDTH = 7;

    const borderH = '┌' + '─'.repeat(NAME_WIDTH + 2) + '┬' + '─'.repeat(ENABLED_WIDTH + 2) + '┬' + '─'.repeat(TARGETS_WIDTH + 2) + '┬' + '─'.repeat(SOURCE_WIDTH + 2) + '┐';
    const borderM = '├' + '─'.repeat(NAME_WIDTH + 2) + '┼' + '─'.repeat(ENABLED_WIDTH + 2) + '┼' + '─'.repeat(TARGETS_WIDTH + 2) + '┼' + '─'.repeat(SOURCE_WIDTH + 2) + '┤';
    const borderF = '└' + '─'.repeat(NAME_WIDTH + 2) + '┴' + '─'.repeat(ENABLED_WIDTH + 2) + '┴' + '─'.repeat(TARGETS_WIDTH + 2) + '┴' + '─'.repeat(SOURCE_WIDTH + 2) + '┘';

    console.log(borderH);
    console.log('│ ' + padRight('Name', NAME_WIDTH) + ' │ ' + padRight('Enabled', ENABLED_WIDTH) + ' │ ' + padRight('Targets', TARGETS_WIDTH) + ' │ ' + padRight('Source', SOURCE_WIDTH) + ' │');
    console.log(borderM);

    for (const skill of status.skills) {
      const name = truncate(skill.name, NAME_WIDTH);
      const enabled = skill.enabled ? '✓' : '✗';
      const targets = truncate(skill.targets.join(', ') || '(none)', TARGETS_WIDTH);
      const source = padRight(skill.source, SOURCE_WIDTH);

      console.log('│ ' + padRight(name, NAME_WIDTH) + ' │ ' + center(enabled, ENABLED_WIDTH) + ' │ ' + padRight(targets, TARGETS_WIDTH) + ' │ ' + source + ' │');
    }

    console.log(borderF);
    console.log();
    console.log('Run `acsync skill <name>` for details, `acsync skill add` to add new skills.\n');
  }
}

function truncate(str: string, maxLen: number): string {
  if (str.length > maxLen) {
    return str.slice(0, maxLen - 1) + '…';
  }
  return str;
}

function center(str: string, width: number): string {
  const len = str.length;
  if (len >= width) return str;
  const left = Math.floor((width - len) / 2);
  const right = width - len - left;
  return ' '.repeat(left) + str + ' '.repeat(right);
}

function padRight(str: string, len: number): string {
  return str.padEnd(len, ' ');
}

// ============================================================================
// Add Command
// ============================================================================

export interface SkillAddOptions {
  skillId: string;
  targets: TargetName[];
  noRegister: boolean;
}

/**
 * Add a skill to the current project.
 */
export async function skillAdd(options: SkillAddOptions): Promise<void> {
  const { normalizeSkillPackage, getSkill, addSkill } = await import('./catalog.js');

  // Check if entry exists in catalog first
  let entry = await getSkill(options.skillId);

  // If not in catalog, read from file and optionally add
  if (!entry) {
    // For now, we'll create a basic entry from the skill ID
    // In a full implementation, this would read from a local file or URL
    const defaultContent = `---
name: ${options.skillId}
description: Skill: ${options.skillId}
---

# ${options.skillId}

Skill content for ${options.skillId}.
`;
    entry = normalizeSkillPackage(options.skillId, defaultContent);

    // Add to catalog if --no-register is false
    if (!options.noRegister) {
      await addSkill(entry);
      console.log(`Added to catalog: ${entry.id}`);
    }
  }

  // Add to each target
  const discovery = await discoverProject();
  const { addSkillToConfig } = await import('./skill-adapters.js');

  for (const target of options.targets) {
    await addSkillToConfig(discovery.root, target, entry.id, entry.recipe.content);
    console.log(`Added to ${target}: ${entry.id}`);
  }

  console.log('\nRun `acsync skill` to see the updated status.');
}

// ============================================================================
// Remove Command
// ============================================================================

export interface SkillRemoveOptions {
  skillName: string;
  targets: TargetName[];
}

/**
 * Remove a skill from the current project.
 */
export async function skillRemove(options: SkillRemoveOptions): Promise<void> {
  const discovery = await discoverProject();
  const { removeSkillFromConfig } = await import('./skill-adapters.js');

  for (const target of options.targets) {
    await removeSkillFromConfig(discovery.root, target, options.skillName);
    console.log(`Removed from ${target}: ${options.skillName}`);
  }

  console.log('\nRun `acsync skill` to see the updated status.');
}

// ============================================================================
// Enable Command (currently no-op, skills are always enabled if present)
// ============================================================================

export interface SkillEnableOptions {
  skillName: string;
  targets: TargetName[];
}

/**
 * Enable a skill in the current project.
 * Note: Skills are always enabled if the SKILL.md file exists.
 * This is a no-op for now but kept for API consistency.
 */
export async function skillEnable(options: SkillEnableOptions): Promise<void> {
  console.log('Skills are enabled when present. Use `acsync skill add` to add skills.\n');
}

// ============================================================================
// Disable Command (equivalent to remove for skills)
// ============================================================================

export interface SkillDisableOptions {
  skillName: string;
  targets: TargetName[];
}

/**
 * Disable a skill in the current project.
 * Note: For skills, disabling is equivalent to removing.
 */
export async function skillDisable(options: SkillDisableOptions): Promise<void> {
  // For skills, disable = remove since there's no enabled flag
  await skillRemove(options);
}
