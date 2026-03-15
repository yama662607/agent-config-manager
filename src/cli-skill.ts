import type { SkillWorkspaceStatus, TargetName } from './types.js';
import { discoverProject } from './project-discovery.js';
import { getSkills, validateSkillName } from './skill-adapters.js';
import { padRightWide, truncateWide, getStringWidth } from './table-utils.js';

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Sanitize skill ID for use in content.
 */
function sanitizeSkillId(skillId: string): string {
  return skillId.replace(/[^\w.-]/g, '').slice(0, 50);
}

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
    const NAME_WIDTH = 35;
    const ENABLED_WIDTH = 7;
    const TARGETS_WIDTH = 15;
    const SOURCE_WIDTH = 7;

    const borderH = '┌' + '─'.repeat(NAME_WIDTH + 2) + '┬' + '─'.repeat(ENABLED_WIDTH + 2) + '┬' + '─'.repeat(TARGETS_WIDTH + 2) + '┬' + '─'.repeat(SOURCE_WIDTH + 2) + '┐';
    const borderM = '├' + '─'.repeat(NAME_WIDTH + 2) + '┼' + '─'.repeat(ENABLED_WIDTH + 2) + '┼' + '─'.repeat(TARGETS_WIDTH + 2) + '┼' + '─'.repeat(SOURCE_WIDTH + 2) + '┤';
    const borderF = '└' + '─'.repeat(NAME_WIDTH + 2) + '┴' + '─'.repeat(ENABLED_WIDTH + 2) + '┴' + '─'.repeat(TARGETS_WIDTH + 2) + '┴' + '─'.repeat(SOURCE_WIDTH + 2) + '┘';

    console.log(borderH);
    console.log('│ ' + padRightWide('Name', NAME_WIDTH) + ' │ ' + padRightWide('Enabled', ENABLED_WIDTH) + ' │ ' + padRightWide('Targets', TARGETS_WIDTH) + ' │ ' + padRightWide('Source', SOURCE_WIDTH) + ' │');
    console.log(borderM);

    for (const skill of status.skills) {
      const name = truncateWide(skill.name, NAME_WIDTH);
      const enabled = skill.enabled ? '✓' : '✗';
      const targets = truncateWide(skill.targets.join(', ') || '(none)', TARGETS_WIDTH);
      const source = padRightWide(skill.source, SOURCE_WIDTH);

      console.log('│ ' + padRightWide(name, NAME_WIDTH) + ' │ ' + centerWide(enabled, ENABLED_WIDTH) + ' │ ' + padRightWide(targets, TARGETS_WIDTH) + ' │ ' + source + ' │');
    }

    console.log(borderF);
    console.log();
    console.log('Run `acsync skill <name>` for details, `acsync skill add` to add new skills.\n');
  }
}

/**
 * Center a string within a width, considering multibyte characters.
 */
function centerWide(str: string, width: number): string {
  const strWidth = getStringWidth(str);
  if (strWidth >= width) return str;
  const left = Math.floor((width - strWidth) / 2);
  const right = width - strWidth - left;
  return ' '.repeat(left) + str + ' '.repeat(right);
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
  const { normalizeSkillPackage, getSkill, addSkill, getSkillWithContent } = await import('./catalog.js');

  // Validate skill ID
  try {
    validateSkillName(options.skillId);
  } catch (error) {
    console.error(`Invalid skill name: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }

  // Check if entry exists in catalog first
  let entry = await getSkill(options.skillId);
  let content: string;

  // If not in catalog, create a basic entry
  if (!entry) {
    const sanitizedId = sanitizeSkillId(options.skillId);
    const defaultContent = `---
name: ${sanitizedId}
description: Skill: ${sanitizedId}
---

# ${sanitizedId}

Skill content for ${sanitizedId}.
`;
    entry = normalizeSkillPackage(options.skillId, defaultContent);
    content = defaultContent;

    // Add to catalog if --no-register is false
    if (!options.noRegister) {
      await addSkill(entry, content);
      console.log(`Added to catalog: ${entry.id}`);
    }
  } else {
    // Load content from file
    const skillWithData = await getSkillWithContent(options.skillId);
    if (!skillWithData) {
      console.error(`Skill content not found for: ${options.skillId}\n`);
      process.exitCode = 1;
      return;
    }
    content = skillWithData.content;
  }

  // Add to each target
  const discovery = await discoverProject();
  const { addSkillToConfig } = await import('./skill-adapters.js');

  for (const target of options.targets) {
    await addSkillToConfig(discovery.root, target, entry.id, content);
    console.log(`Added to ${target}: ${entry.id}`);
  }

  console.log('\nRun `acsync skill` to see the updated status.');
}

// ============================================================================
// Install from GitHub Command
// ============================================================================

export interface SkillInstallFromGitHubOptions {
  githubUrl: string;
  skillName?: string;
  targets: TargetName[];
  addToCatalog?: boolean;
}

/**
 * Install a skill from a GitHub URL.
 */
export async function skillInstallFromGitHub(options: SkillInstallFromGitHubOptions): Promise<void> {
  const { installFromGitHub } = await import('./registry.js');
  const { normalizeSkillPackage, addSkill, getSkill } = await import('./catalog.js');

  console.log(`Installing skill from GitHub...`);

  // Download and parse skill
  const { name, content } = await installFromGitHub(options.githubUrl, options.skillName);

  // Validate the parsed skill name
  try {
    validateSkillName(name);
  } catch (error) {
    console.error(`Invalid skill name from GitHub: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`  Skill name: ${name}`);

  // Add to catalog if requested
  if (options.addToCatalog !== false) {
    const existing = await getSkill(name);
    if (existing && !options.skillName) {
      console.log(`\nSkill already exists in catalog. Use --force to reinstall.`);
      return;
    }

    const entry = normalizeSkillPackage(name, content, {
      displayName: name,
      description: `Skill: ${name}`,
    });

    await addSkill(entry, content);
    console.log(`✓ Added to catalog: ${entry.id}`);
  }

  // Add to project
  const discovery = await discoverProject();
  const { addSkillToConfig } = await import('./skill-adapters.js');

  for (const target of options.targets) {
    await addSkillToConfig(discovery.root, target, name, content);
    console.log(`✓ Added to ${target}: ${name}`);
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
  // Validate skill name
  try {
    validateSkillName(options.skillName);
  } catch (error) {
    console.error(`Invalid skill name: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }

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
