import os from 'node:os';
import path from 'node:path';
import type { SkillPlacementState, SkillStatus, SkillWorkspaceStatus, TargetName } from './types.js';
import { discoverProject } from './project-discovery.js';
import { defaultPlacementMode, getSkills, validateSkillName } from './skill-adapters.js';
import type { SkillPlacementMode } from './skill-adapters.js';
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

/**
 * Format an absolute path for display, collapsing the home directory to `~`.
 */
function formatHomePath(absolutePath: string): string {
  const homeDir = os.homedir();
  return absolutePath === homeDir || absolutePath.startsWith(homeDir + '/')
    ? '~' + absolutePath.slice(homeDir.length)
    : absolutePath;
}

// ============================================================================
// Status Command
// ============================================================================

/**
 * Show skill status for the current project.
 */
export async function skillStatus(
  verbose: boolean = false,
  allowHome: boolean = false,
  json: boolean = false
): Promise<void> {
  const discovery = await discoverProject(process.cwd(), { allowHome });
  const status = await buildSkillStatus(discovery.root, allowHome);

  if (json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  await printSkillStatus(status, verbose);
}

async function buildSkillStatus(projectRoot: string, allowHome: boolean = false): Promise<SkillWorkspaceStatus> {
  const { targets } = await discoverProject(process.cwd(), { allowHome });
  const { listSkills, getSkillDir: getCatalogSkillDir } = await import('./catalog.js');
  const { inspectSkillPlacement } = await import('./skill-placement.js');
  const catalogSkillIds = new Set((await listSkills()).map((s) => s.id));

  const skillMap = new Map<string, SkillStatus>();

  for (const target of targets.keys()) {
    // Skill directories are independent of native MCP config files, so a
    // target is checked for skills even if it has no MCP config yet.
    const skills = await getSkills(projectRoot, target);

    for (const [name, info] of Object.entries(skills)) {
      if (!info.enabled) continue;

      const catalogDir = catalogSkillIds.has(name) ? getCatalogSkillDir(name) : undefined;
      let placement = (await inspectSkillPlacement(projectRoot, target, name, catalogDir)).state;
      // Grok reads registered catalog paths directly, so nothing is placed on disk.
      if (target === 'grok' && placement === 'missing') {
        placement = 'registered';
      }

      const existing = skillMap.get(name);
      if (existing) {
        existing.targets.push(target);
        existing.placement![target] = placement;
      } else {
        skillMap.set(name, {
          name,
          enabled: true,
          targets: [target],
          source: catalogDir ? 'catalog' : 'inline',
          placement: { [target]: placement },
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

async function printSkillStatus(status: SkillWorkspaceStatus, verbose: boolean): Promise<void> {
  console.log(`Project: ${status.projectRoot}`);
  console.log(`Skills (${status.totalCount} total, ${status.enabledCount} enabled):\n`);

  if (status.skills.length === 0) {
    console.log('No skills configured.');
    console.log('Run `acm skill add <name>` to add a skill.\n');
    return;
  }

  if (verbose) {
    // Verbose output
    for (const skill of status.skills) {
      console.log(`Skill: ${skill.name}`);
      console.log(`  Status: ${skill.enabled ? '✓' : '✗'} ${skill.enabled ? 'Enabled' : 'Disabled'}`);
      console.log(`  Targets: ${skill.targets.join(', ') || '(none)'}`);
      console.log(`  Source: ${skill.source}`);
      console.log(`  Placement: ${formatPlacement(skill)}`);
      for (const line of await describeResolution(status.projectRoot, skill)) {
        console.log(`  ${line}`);
      }
      console.log();
    }
  } else {
    // Compact table output
    const NAME_WIDTH = 30;
    const ENABLED_WIDTH = 7;
    const TARGETS_WIDTH = 15;
    const SOURCE_WIDTH = 7;
    const PLACEMENT_WIDTH = 18;

    const widths = [NAME_WIDTH, ENABLED_WIDTH, TARGETS_WIDTH, SOURCE_WIDTH, PLACEMENT_WIDTH];
    const line = (l: string, m: string, r: string) => l + widths.map(w => '─'.repeat(w + 2)).join(m) + r;
    const borderH = line('┌', '┬', '┐');
    const borderM = line('├', '┼', '┤');
    const borderF = line('└', '┴', '┘');

    console.log(borderH);
    console.log('│ ' + padRightWide('Name', NAME_WIDTH) + ' │ ' + padRightWide('Enabled', ENABLED_WIDTH) + ' │ ' + padRightWide('Targets', TARGETS_WIDTH) + ' │ ' + padRightWide('Source', SOURCE_WIDTH) + ' │ ' + padRightWide('Placement', PLACEMENT_WIDTH) + ' │');
    console.log(borderM);

    for (const skill of status.skills) {
      const name = truncateWide(skill.name, NAME_WIDTH);
      const enabled = skill.enabled ? '✓' : '✗';
      const targets = truncateWide(skill.targets.join(', ') || '(none)', TARGETS_WIDTH);
      const source = padRightWide(skill.source, SOURCE_WIDTH);

      const placement = padRightWide(truncateWide(formatPlacement(skill), PLACEMENT_WIDTH), PLACEMENT_WIDTH);

      console.log('│ ' + padRightWide(name, NAME_WIDTH) + ' │ ' + centerWide(enabled, ENABLED_WIDTH) + ' │ ' + padRightWide(targets, TARGETS_WIDTH) + ' │ ' + source + ' │ ' + placement + ' │');
    }

    console.log(borderF);
    console.log();
    console.log('Run `acm skill <name>` for details, `acm skill add` to add new skills.\n');
  }
}

/**
 * Describe where a distributed skill actually resolves to.
 *
 * A link can pass through the state directory and again through the catalog
 * before reaching real content, which makes "where does this file come from?"
 * hard to answer during diagnosis.
 */
async function describeResolution(projectRoot: string, skill: SkillStatus): Promise<string[]> {
  const fsp = await import('node:fs/promises');
  const { getSkillDir } = await import('./skill-adapters.js');

  const lines: string[] = [];

  for (const target of skill.targets) {
    const dir = getSkillDir(projectRoot, target, skill.name);
    let stat;
    try {
      stat = await fsp.lstat(dir);
    } catch {
      continue;
    }
    if (!stat.isSymbolicLink()) continue;

    const chain: string[] = [formatHomePath(dir)];
    let current = dir;
    for (let hop = 0; hop < 8; hop++) {
      let next: string;
      try {
        next = await fsp.readlink(current);
      } catch {
        break;
      }
      const resolved = next.startsWith('/') ? next : path.resolve(path.dirname(current), next);
      chain.push(formatHomePath(resolved));
      current = resolved;
      try {
        if (!(await fsp.lstat(resolved)).isSymbolicLink()) break;
      } catch {
        break;
      }
    }

    lines.push(`Resolves (${target}): ${chain.join(' -> ')}`);
  }

  return lines;
}

/** Short label for a placement state. */
const PLACEMENT_LABELS: Record<SkillPlacementState, string> = {
  linked: 'link',
  registered: 'catalog',
  'copy-current': 'copy',
  'copy-stale': 'stale',
  'broken-link': 'broken',
  unlinked: 'unlinked',
  missing: '-',
};

/**
 * Summarize placement across targets. Reports the single state when every
 * target agrees, otherwise lists them per target.
 */
function formatPlacement(skill: SkillStatus): string {
  const entries = Object.entries(skill.placement ?? {}) as [TargetName, SkillPlacementState][];
  if (entries.length === 0) return '-';

  const states = new Set(entries.map(([, state]) => state));
  if (states.size === 1) {
    return PLACEMENT_LABELS[entries[0][1]];
  }

  const short: Record<TargetName, string> = {
    claude: 'cl',
    codex: 'cx',
    antigravity: 'ag',
    grok: 'gk',
  };
  return entries.map(([target, state]) => `${short[target]}:${PLACEMENT_LABELS[state]}`).join(' ');
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

/** Say so when a target will not read the scope being written. */
async function warnUnsupportedScopes(
  targets: TargetName[],
  kind: 'skill' | 'mcp',
  isHome: boolean
): Promise<void> {
  const { unsupportedScopeWarning } = await import('./provider-support.js');
  for (const target of targets) {
    const warning = unsupportedScopeWarning(target, kind, isHome);
    if (warning) console.warn(warning);
  }
}

/**
 * A symlink inside a repository records an absolute path from this machine.
 * Anyone else who clones it — and any container or remote runtime — gets a
 * dangling link, so say so at the moment it happens.
 */
async function warnIfLinkingIntoRepository(
  projectRoot: string,
  placement: SkillPlacementMode
): Promise<void> {
  if (placement !== 'link') return;

  const fsp = await import('node:fs/promises');
  const os = await import('node:os');
  if (path.resolve(projectRoot) === os.homedir()) return;

  try {
    await fsp.access(path.join(projectRoot, '.git'));
  } catch {
    return; // Not a repository; nothing to warn about.
  }

  console.warn(
    'Warning: linking into a git repository. The link stores an absolute path,\n' +
    '         so it breaks for anyone else who clones it and inside containers.\n' +
    '         Use --copy for anything shared or run in a sandbox.'
  );
}

// ============================================================================
// Grok Helpers
// ============================================================================

/**
 * Grok reads skills straight out of directories listed in `[skills] paths`, and
 * already scans `~/.claude/skills`. So instead of copying, ACM registers the
 * catalog once and clears any `[skills] disabled` entry for this skill.
 */
async function addSkillForGrok(projectRoot: string, skillId: string): Promise<void> {
  const { registerSkillPath, setSkillDisabled } = await import('./grok-skills.js');
  const { getSkillsDir: getCatalogSkillsDir } = await import('./catalog.js');

  const configPath = path.join(projectRoot, '.grok', 'config.toml');
  const catalogSkillsDir = getCatalogSkillsDir();

  const registered = await registerSkillPath(configPath, catalogSkillsDir);
  await setSkillDisabled(configPath, skillId, false);

  if (registered) {
    console.log(
      `Added to grok: registered catalog ${formatHomePath(catalogSkillsDir)} in ${formatHomePath(configPath)}`
    );
  }
  console.log(`Added to grok: ${skillId} (read from the catalog, not copied)`);
}

/**
 * Grok cannot "uninstall" a single catalog skill, because the whole directory is
 * registered at once. Disabling it by name is the equivalent operation.
 */
async function removeSkillForGrok(projectRoot: string, skillName: string): Promise<void> {
  const { setSkillDisabled } = await import('./grok-skills.js');

  const configPath = path.join(projectRoot, '.grok', 'config.toml');
  await setSkillDisabled(configPath, skillName, true);

  console.log(`Removed from grok: ${skillName} (added to [skills] disabled)`);
}

// ============================================================================
// Add Command
// ============================================================================

export interface SkillAddOptions {
  skillId: string;
  targets: TargetName[];
  noRegister: boolean;
  allowHome?: boolean;
  /** Placement override. Defaults to link for home, copy for projects. */
  placement?: SkillPlacementMode;
}

/**
 * Add a skill to the current project.
 */
export async function skillAdd(options: SkillAddOptions): Promise<void> {
  const { normalizeSkillPackage, getSkill, addSkill, getSkillWithContent, getSkillDir: getCatalogSkillDir } = await import('./catalog.js');

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
  // When the skill has a catalog directory (existing or newly registered), copy
  // the whole directory (SKILL.md + references/, scripts/, assets/, etc.)
  // instead of only the SKILL.md content.
  let sourceDir: string | undefined;

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
      sourceDir = getCatalogSkillDir(entry.id);
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
    sourceDir = getCatalogSkillDir(options.skillId);
  }

  // Add to each target
  const discovery = await discoverProject(process.cwd(), { allowHome: options.allowHome });
  const { addSkillToConfig, copySkillDirToConfig, getSkillDir } = await import('./skill-adapters.js');
  const placement = options.placement ?? defaultPlacementMode(discovery.root);
  await warnIfLinkingIntoRepository(discovery.root, placement);
  await warnUnsupportedScopes(options.targets, 'skill', options.allowHome === true);

  for (const target of options.targets) {
    if (target === 'grok') {
      await addSkillForGrok(discovery.root, entry.id);
      continue;
    }
    if (sourceDir) {
      await copySkillDirToConfig(discovery.root, target, entry.id, sourceDir, placement);
    } else {
      await addSkillToConfig(discovery.root, target, entry.id, content);
    }
    const destination = getSkillDir(discovery.root, target, entry.id);
    const how = sourceDir && placement === 'link' ? ' (symlink)' : '';
    console.log(`Added to ${target}: ${entry.id} -> ${formatHomePath(destination)}${how}`);
  }

  console.log('\nRun `acm skill` to see the updated status.');
  console.log('Already-running agent sessions keep their old skill list until restarted.');
}

// ============================================================================
// Install from GitHub Command
// ============================================================================

export interface SkillInstallFromGitHubOptions {
  githubUrl: string;
  skillName?: string;
  targets: TargetName[];
  addToCatalog?: boolean;
  allowHome?: boolean;
  /** Placement override. Defaults to link for home, copy for projects. */
  placement?: SkillPlacementMode;
  /** Replace a skill the catalog already holds. */
  force?: boolean;
}

/**
 * Fetch everything beside SKILL.md into the catalog's copy of the skill.
 *
 * Best effort by design: the listing needs the GitHub API, which is rate
 * limited without a token, and a skill whose SKILL.md alone installed is still
 * more useful than a failed install. Returns how many extra files landed.
 */
async function downloadSkillDirectory(githubUrl: string, name: string): Promise<number> {
  const { listSkillDirectory, downloadSkillFile } = await import('./registry.js');
  const { getSkillDir } = await import('./catalog.js');
  const fsp = await import('node:fs/promises');
  const pathMod = await import('node:path');

  const files = await listSkillDirectory(githubUrl);
  if (!files) return 0;

  const destination = getSkillDir(name);
  let written = 0;

  for (const file of files) {
    if (file.path === 'SKILL.md') continue;
    // A skill directory is documentation and small scripts. Anything larger is
    // not something to pull into every provider's config directory.
    if (file.size > 1024 * 1024) {
      console.log(`  skipped ${file.path} (${Math.round(file.size / 1024)}KB)`);
      continue;
    }

    const content = await downloadSkillFile(githubUrl, file.path);
    if (!content) continue;

    const target = pathMod.join(destination, file.path);
    // The listing comes from an external service; keep writes inside the skill.
    if (!pathMod.resolve(target).startsWith(pathMod.resolve(destination) + pathMod.sep)) continue;

    await fsp.mkdir(pathMod.dirname(target), { recursive: true });
    await fsp.writeFile(target, content);
    written++;
  }

  return written;
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
    if (existing && !options.force && !options.skillName) {
      console.log(`\nSkill already exists in catalog. Use --force to reinstall.`);
      return;
    }

    const entry = normalizeSkillPackage(name, content, {
      displayName: name,
      description: `Skill: ${name}`,
    });

    await addSkill(entry, content);

    // A skill is a directory, so bring the rest of it too. SKILL.md is already
    // written above, and stays authoritative if the listing cannot be read.
    const extra = await downloadSkillDirectory(options.githubUrl, name);
    console.log(
      `✓ Added to catalog: ${entry.id}${extra > 0 ? ` (SKILL.md + ${extra} files)` : ''}`
    );
  }

  // Record where this came from, so it can be revisited when upstream moves.
  if (options.addToCatalog !== false) {
    await recordProvenance(name, options.githubUrl);
  }

  // Add to project
  const discovery = await discoverProject(process.cwd(), { allowHome: options.allowHome });
  const { addSkillToConfig, copySkillDirToConfig, getSkillDir } = await import('./skill-adapters.js');
  const { getSkillDir: getCatalogSkillDir } = await import('./catalog.js');
  const placement = options.placement ?? defaultPlacementMode(discovery.root);
  const sourceDir = options.addToCatalog !== false ? getCatalogSkillDir(name) : undefined;

  for (const target of options.targets) {
    if (target === 'grok') {
      await addSkillForGrok(discovery.root, name);
      continue;
    }
    if (sourceDir) {
      await copySkillDirToConfig(discovery.root, target, name, sourceDir, placement);
    } else {
      await addSkillToConfig(discovery.root, target, name, content);
    }
    const destination = getSkillDir(discovery.root, target, name);
    const how = sourceDir && placement === 'link' ? ' (symlink)' : '';
    console.log(`✓ Added to ${target}: ${name} -> ${formatHomePath(destination)}${how}`);
  }

  console.log('\nRun `acm skill` to see the updated status.');
  console.log('Already-running agent sessions keep their old skill list until restarted.');
}

// ============================================================================
// Remove Command
// ============================================================================

export interface SkillRemoveOptions {
  skillName: string;
  targets: TargetName[];
  allowHome?: boolean;
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

  const discovery = await discoverProject(process.cwd(), { allowHome: options.allowHome });
  const { removeSkillFromConfig } = await import('./skill-adapters.js');

  for (const target of options.targets) {
    if (target === 'grok') {
      await removeSkillForGrok(discovery.root, options.skillName);
      continue;
    }
    await removeSkillFromConfig(discovery.root, target, options.skillName);
    console.log(`Removed from ${target}: ${options.skillName}`);
  }

  console.log('\nRun `acm skill` to see the updated status.');
  console.log('Already-running agent sessions keep their old skill list until restarted.');
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
  console.log('Skills are enabled when present. Use `acm skill add` to add skills.\n');
}

// ============================================================================
// Disable Command (equivalent to remove for skills)
// ============================================================================

export interface SkillDisableOptions {
  skillName: string;
  targets: TargetName[];
  allowHome?: boolean;
}

/**
 * Disable a skill in the current project.
 * Note: For skills, disabling is equivalent to removing.
 */
export async function skillDisable(options: SkillDisableOptions): Promise<void> {
  // For skills, disable = remove since there's no enabled flag
  await skillRemove(options);
}

// ============================================================================
// Link Command
// ============================================================================

export interface SkillLinkOptions {
  /** Path to the skill directory that stays the source of truth. */
  sourcePath: string;
  /** Catalog id. Defaults to the source directory name. */
  skillId?: string;
}

/**
 * Register a skill in the catalog as a symlink instead of a copy.
 *
 * The source stays where it is — typically its own development repository — and
 * the catalog points at it. Combined with linked distribution, an edit in the
 * development repository reaches every provider with no further action.
 */
export async function skillLink(options: SkillLinkOptions): Promise<void> {
  const fsp = await import('node:fs/promises');
  const { getSkillsDir: getCatalogSkillsDir } = await import('./catalog.js');

  const sourcePath = path.resolve(options.sourcePath);
  const skillId = options.skillId ?? path.basename(sourcePath);

  try {
    validateSkillName(skillId);
  } catch (error) {
    console.error(`Invalid skill name: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    const stat = await fsp.stat(sourcePath);
    if (!stat.isDirectory()) throw new Error('not a directory');
  } catch {
    console.error(`Not a directory: ${sourcePath}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    await fsp.access(path.join(sourcePath, 'SKILL.md'));
  } catch {
    console.error(`No SKILL.md in ${formatHomePath(sourcePath)}\n`);
    process.exitCode = 1;
    return;
  }

  const catalogSkillsDir = getCatalogSkillsDir();
  const destination = path.join(catalogSkillsDir, skillId);

  // Refuse to replace real content; a link is cheap to redo, a copy is not.
  try {
    const existing = await fsp.lstat(destination);
    if (!existing.isSymbolicLink()) {
      console.error(
        `${skillId} already exists in the catalog as a directory.\n` +
        `Remove it first if you want to link ${formatHomePath(sourcePath)} instead.\n`
      );
      process.exitCode = 1;
      return;
    }
    await fsp.rm(destination);
  } catch {
    // Nothing there yet.
  }

  await fsp.mkdir(catalogSkillsDir, { recursive: true });
  await fsp.symlink(sourcePath, destination);

  console.log(`Linked into the catalog: ${skillId} -> ${formatHomePath(sourcePath)}`);
  console.log(`\nRun \`acm skill add ${skillId} -t <targets> -H\` to distribute it.`);
}

/**
 * Remove a catalog link. Only links are removed, never real content.
 */
export async function skillUnlink(skillId: string): Promise<void> {
  const fsp = await import('node:fs/promises');
  const { getSkillDir: getCatalogSkillDir } = await import('./catalog.js');

  try {
    validateSkillName(skillId);
  } catch (error) {
    console.error(`Invalid skill name: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }

  const destination = getCatalogSkillDir(skillId);

  let stat;
  try {
    stat = await fsp.lstat(destination);
  } catch {
    console.error(`Not in the catalog: ${skillId}\n`);
    process.exitCode = 1;
    return;
  }

  if (!stat.isSymbolicLink()) {
    console.error(`${skillId} is real content in the catalog, not a link. Not removing it.\n`);
    process.exitCode = 1;
    return;
  }

  const target = await fsp.readlink(destination);
  await fsp.rm(destination);
  console.log(`Unlinked from the catalog: ${skillId} (source left at ${formatHomePath(target)})`);
}

// ============================================================================
// Update Command
// ============================================================================

export interface SkillUpdateOptions {
  /** Limit to one skill. Defaults to every skill that has drifted. */
  skillName?: string;
  targets: TargetName[];
  allowHome?: boolean;
  placement?: SkillPlacementMode;
}

/**
 * Refresh distributions that no longer match the catalog.
 *
 * Only copies can drift, so linked and registered placements are left alone.
 */
export async function skillUpdate(options: SkillUpdateOptions): Promise<void> {
  const discovery = await discoverProject(process.cwd(), { allowHome: options.allowHome });
  const { copySkillDirToConfig } = await import('./skill-adapters.js');
  const { inspectSkillPlacement } = await import('./skill-placement.js');
  const { listSkills, getSkillDir: getCatalogSkillDir } = await import('./catalog.js');

  const catalogIds = (await listSkills()).map((s) => s.id);
  const candidates = options.skillName ? [options.skillName] : catalogIds;
  const placement = options.placement ?? defaultPlacementMode(discovery.root);

  let updated = 0;

  for (const skillId of candidates) {
    if (!catalogIds.includes(skillId)) {
      console.error(`Not in the catalog: ${skillId}`);
      process.exitCode = 1;
      continue;
    }

    const catalogDir = getCatalogSkillDir(skillId);

    for (const target of options.targets) {
      const state = (await inspectSkillPlacement(discovery.root, target, skillId, catalogDir)).state;
      if (state !== 'copy-stale') continue;

      await copySkillDirToConfig(discovery.root, target, skillId, catalogDir, placement);
      console.log(`Updated ${target}: ${skillId}${placement === 'link' ? ' (now a symlink)' : ''}`);
      updated++;
    }
  }

  if (updated === 0) {
    console.log('Nothing to update: no distributed copy differs from the catalog.');
  } else {
    console.log(`\nUpdated ${updated} placement${updated === 1 ? '' : 's'}.`);
  }
}

// ============================================================================
// Metadata Command
// ============================================================================

export interface SkillMetaOptions {
  skillId: string;
  deprecated?: boolean;
  pinned?: boolean;
  /** Replaces the existing tags. */
  tags?: string[];
  category?: string;
  /** Upstream location this skill came from. */
  source?: string;
  /** Upstream revision this copy corresponds to. */
  ref?: string;
  /** Deliberately diverged from upstream. */
  forked?: boolean;
}

/**
 * Edit a skill's catalog metadata.
 *
 * Without this, marking something deprecated means hand-editing
 * skills-metadata.toml, which is easy to get wrong and easy to forget.
 */
export async function skillMeta(options: SkillMetaOptions): Promise<void> {
  const { loadSkillsMetadata, saveSkillsMetadata } = await import('./skills-metadata.js');
  const { listSkills } = await import('./catalog.js');

  try {
    validateSkillName(options.skillId);
  } catch (error) {
    console.error(`Invalid skill name: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }

  const known = (await listSkills()).some((s) => s.id === options.skillId);
  if (!known) {
    console.error(`Not in the catalog: ${options.skillId}\n`);
    process.exitCode = 1;
    return;
  }

  const changes: string[] = [];
  const data = await loadSkillsMetadata();
  const entry = { ...(data.skills[options.skillId] ?? {}) };

  if (options.deprecated !== undefined) {
    entry.deprecated = options.deprecated;
    changes.push(`deprecated = ${options.deprecated}`);
  }
  if (options.pinned !== undefined) {
    entry.pinned = options.pinned;
    changes.push(`pinned = ${options.pinned}`);
  }
  if (options.tags !== undefined) {
    entry.tags = options.tags;
    changes.push(`tags = [${options.tags.join(', ')}]`);
  }
  if (options.category !== undefined) {
    entry.category = options.category;
    changes.push(`category = ${options.category}`);
  }
  if (options.source !== undefined) {
    const { classifySource } = await import('./skill-provenance.js');
    entry.sourceUrl = options.source;
    entry.sourceKind = classifySource(options.source);
    changes.push(`sourceUrl = ${options.source}`);
  }
  if (options.ref !== undefined) {
    entry.sourceRef = options.ref;
    changes.push(`sourceRef = ${options.ref}`);
  }
  if (options.forked !== undefined) {
    entry.forked = options.forked;
    changes.push(`forked = ${options.forked}`);
  }

  if (changes.length === 0) {
    const current = data.skills[options.skillId];
    if (!current) {
      console.log(`${options.skillId}: no metadata recorded`);
      return;
    }
    console.log(`${options.skillId}:`);
    for (const [key, value] of Object.entries(current)) {
      console.log(`  ${key} = ${Array.isArray(value) ? `[${value.join(', ')}]` : String(value)}`);
    }
    return;
  }

  data.skills[options.skillId] = entry;
  await saveSkillsMetadata(data);

  console.log(`Updated ${options.skillId}: ${changes.join(', ')}`);
}


// ============================================================================
// Provenance
// ============================================================================

/**
 * Store the origin of a freshly installed skill, resolving the branch to the
 * commit it actually points at right now. A branch name alone cannot answer
 * "has upstream changed since?" later.
 */
async function recordProvenance(skillId: string, sourceUrl: string): Promise<void> {
  const { loadSkillsMetadata, saveSkillsMetadata } = await import('./skills-metadata.js');
  const { classifySource, parseGitHubSource, resolveLatestCommit } = await import('./skill-provenance.js');

  const data = await loadSkillsMetadata();
  const entry = { ...(data.skills[skillId] ?? {}) };

  entry.sourceUrl = sourceUrl;
  entry.sourceKind = classifySource(sourceUrl);
  entry.installedAt = new Date().toISOString();

  const source = parseGitHubSource(sourceUrl);
  if (source) {
    try {
      entry.sourceRef = await resolveLatestCommit(source);
      entry.upstreamCheckedAt = entry.installedAt;
      console.log(`  Recorded upstream revision ${entry.sourceRef.slice(0, 8)}`);
    } catch (error) {
      // Not fatal: the URL is still worth keeping even without a revision.
      console.warn(
        `  Could not resolve the upstream revision: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  data.skills[skillId] = entry;
  await saveSkillsMetadata(data);
}

// ============================================================================
// Outdated Command
// ============================================================================

export interface SkillOutdatedOptions {
  /** Limit to one skill. */
  skillName?: string;
  json?: boolean;
  /** Include entries whose origin cannot be checked. */
  all?: boolean;
}

/**
 * Compare catalog entries against their recorded upstream.
 *
 * This is the only skill command that reaches the network, and only for
 * entries that recorded a GitHub source.
 */
export async function skillOutdated(options: SkillOutdatedOptions): Promise<void> {
  const { loadSkillsMetadata, saveSkillsMetadata } = await import('./skills-metadata.js');
  const { listSkills } = await import('./catalog.js');
  const { checkUpstreamAll } = await import('./skill-provenance.js');

  const catalogIds = new Set((await listSkills()).map((s) => s.id));
  const data = await loadSkillsMetadata();

  let entries = Object.entries(data.skills)
    .filter(([id]) => catalogIds.has(id))
    .map(([id, meta]) => ({ id, meta }));

  if (options.skillName) {
    entries = entries.filter((e) => e.id === options.skillName);
    if (entries.length === 0) {
      console.error(`Not in the catalog, or no metadata recorded: ${options.skillName}\n`);
      process.exitCode = 1;
      return;
    }
  } else if (!options.all) {
    // Checking 600 entries with no recorded source would be all noise.
    entries = entries.filter((e) => e.meta.sourceUrl !== undefined);
  }

  if (entries.length === 0) {
    console.log('No skill records an upstream source yet.');
    console.log('Record one with `acm skill meta <id> --source <url>`.');
    return;
  }

  const results = await checkUpstreamAll(entries);
  results.sort((a, b) => a.skillId.localeCompare(b.skillId));

  // Remember when each answer was obtained.
  const now = new Date().toISOString();
  for (const result of results) {
    if (result.state === 'up-to-date' || result.state === 'behind') {
      data.skills[result.skillId] = { ...data.skills[result.skillId], upstreamCheckedAt: now };
    }
  }
  await saveSkillsMetadata(data);

  if (options.json) {
    console.log(JSON.stringify({ checkedAt: now, results }, null, 2));
    return;
  }

  const labels: Record<string, string> = {
    'up-to-date': '✓ up to date',
    behind: '● behind',
    forked: '~ forked',
    unknown: '? unknown',
    unreachable: '! unreachable',
  };

  for (const result of results) {
    const suffix =
      result.state === 'behind'
        ? `  ${result.recordedRef?.slice(0, 8)} -> ${result.latestRef?.slice(0, 8)}`
        : result.detail
          ? `  (${result.detail})`
          : '';
    console.log(`${labels[result.state].padEnd(15)} ${result.skillId}${suffix}`);
  }

  const behind = results.filter((r) => r.state === 'behind');
  console.log();
  if (behind.length === 0) {
    console.log('Nothing is behind its upstream.');
  } else {
    console.log(`${behind.length} skill${behind.length === 1 ? '' : 's'} behind upstream.`);
    console.log('Review the upstream changes, then re-install what you want to take:');
    console.log(`  acm skill install <url> --force`);
  }
}
