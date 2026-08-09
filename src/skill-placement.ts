/**
 * Skill placement inspection.
 *
 * A skill installed into a target is either a symlink back to the catalog
 * (which can never drift) or an independent copy (which can). This module
 * reports which one a destination is, and for copies whether the content still
 * matches the catalog.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { SkillPlacementState, TargetName } from './types.js';
import { getSkillDir } from './skill-adapters.js';

export type { SkillPlacementState };

export interface SkillPlacement {
  state: SkillPlacementState;
  /** Absolute path of the installed skill directory. */
  path: string;
  /** Symlink target, when the destination is a symlink. */
  linkTarget?: string;
  /** Content digest of the destination (copies only). */
  digest?: string;
  /** Content digest of the catalog source, when one exists. */
  sourceDigest?: string;
}

/**
 * Rewrite a file's bytes before they are hashed.
 *
 * For dropping content that changes without the directory meaningfully
 * changing — see `digestPluginSource` in desktop-scanner.ts.
 */
export type DigestNormaliser = (relativePath: string, contents: Buffer) => Buffer;

/**
 * Compute a digest over a skill directory's contents.
 *
 * Covers every regular file's relative path and bytes, so both edits and
 * added/removed files change the result. Symlinks inside the directory are
 * hashed by their target string rather than followed.
 */
export async function digestSkillDir(
  dir: string,
  normalise?: DigestNormaliser
): Promise<string | null> {
  const files: string[] = [];
  const visited = new Set<string>();

  async function walk(current: string): Promise<void> {
    // Resolve so a directory reached twice through different links is walked once.
    let real: string;
    try {
      real = await fs.realpath(current);
    } catch {
      return; // Dangling link
    }
    if (visited.has(real)) return;
    visited.add(real);

    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);

      // Follow links: a skill linked into the catalog from a development
      // repository must hash to the same value as a copy of its contents,
      // otherwise identical content is reported as drifted.
      let stat;
      try {
        stat = await fs.stat(full);
      } catch {
        continue; // Dangling link
      }

      if (stat.isDirectory()) {
        await walk(full);
      } else {
        files.push(full);
      }
    }
  }

  try {
    const rootStat = await fs.stat(dir);
    if (!rootStat.isDirectory()) return null;
    await walk(dir);
  } catch {
    return null;
  }

  files.sort();

  const hash = crypto.createHash('sha256');
  for (const file of files) {
    const relative = path.relative(dir, file);
    const contents = await fs.readFile(file);
    hash.update(relative);
    hash.update('\0');
    hash.update(normalise ? normalise(relative, contents) : contents);
    hash.update('\0');
  }

  return hash.digest('hex');
}

/**
 * Inspect how a skill is placed in a target.
 *
 * `catalogDir` is the skill's directory in the catalog, or undefined when the
 * catalog has no such skill.
 */
export async function inspectSkillPlacement(
  projectRoot: string,
  target: TargetName,
  skillId: string,
  catalogDir?: string
): Promise<SkillPlacement> {
  const skillDir = getSkillDir(projectRoot, target, skillId);

  let stat;
  try {
    stat = await fs.lstat(skillDir);
  } catch {
    return { state: 'missing', path: skillDir };
  }

  if (stat.isSymbolicLink()) {
    const linkTarget = await fs.readlink(skillDir);
    try {
      await fs.stat(skillDir);
    } catch {
      return { state: 'broken-link', path: skillDir, linkTarget };
    }
    return { state: 'linked', path: skillDir, linkTarget };
  }

  const digest = await digestSkillDir(skillDir);

  if (!catalogDir) {
    return { state: 'unlinked', path: skillDir, digest: digest ?? undefined };
  }

  const sourceDigest = await digestSkillDir(catalogDir);
  if (!sourceDigest) {
    return { state: 'unlinked', path: skillDir, digest: digest ?? undefined };
  }

  return {
    state: digest === sourceDigest ? 'copy-current' : 'copy-stale',
    path: skillDir,
    digest: digest ?? undefined,
    sourceDigest,
  };
}
