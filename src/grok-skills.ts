/**
 * Grok skill registration.
 *
 * Grok discovers skills from directories listed under `[skills] paths` in
 * `config.toml`, and it already scans `~/.claude/skills` by default. Copying
 * catalog skills into `~/.grok/skills` would therefore duplicate everything
 * ACM installs for Claude.
 *
 * Instead, ACM registers the catalog's skills directory with Grok once, and
 * uses `[skills] disabled` to turn individual skills off. The catalog stays the
 * single source of truth and nothing is duplicated.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as TOML from 'smol-toml';
import type { GrokConfig } from './types.js';

/** Expand a leading `~` the way Grok does when reading config paths. */
export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

async function readConfig(configPath: string): Promise<GrokConfig> {
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    return TOML.parse(raw) as GrokConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    // A config we cannot parse is not one we may rewrite.
    throw error;
  }
}

async function writeConfig(configPath: string, config: GrokConfig): Promise<void> {
  const tempPath = `${configPath}.tmp`;
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(tempPath, TOML.stringify(config as any), 'utf8');
  await fs.rename(tempPath, configPath);
}

/**
 * Register a skills directory with Grok.
 * Returns true when the config changed, false when it was already registered.
 */
export async function registerSkillPath(configPath: string, skillsDir: string): Promise<boolean> {
  const config = await readConfig(configPath);
  const resolved = path.resolve(skillsDir);

  const paths = config.skills?.paths ?? [];
  if (paths.some((p) => path.resolve(expandHome(p)) === resolved)) {
    return false;
  }

  config.skills = { ...config.skills, paths: [...paths, skillsDir] };
  await writeConfig(configPath, config);
  return true;
}

/** Remove a skills directory registration. Returns true when the config changed. */
export async function unregisterSkillPath(configPath: string, skillsDir: string): Promise<boolean> {
  const config = await readConfig(configPath);
  const resolved = path.resolve(skillsDir);

  const paths = config.skills?.paths ?? [];
  const remaining = paths.filter((p) => path.resolve(expandHome(p)) !== resolved);
  if (remaining.length === paths.length) return false;

  config.skills = { ...config.skills, paths: remaining };
  await writeConfig(configPath, config);
  return true;
}

/** Whether a skills directory is registered with Grok. */
export async function isSkillPathRegistered(configPath: string, skillsDir: string): Promise<boolean> {
  const config = await readConfig(configPath);
  const resolved = path.resolve(skillsDir);
  return (config.skills?.paths ?? []).some((p) => path.resolve(expandHome(p)) === resolved);
}

/**
 * Enable or disable a single skill by name via `[skills] disabled`.
 * Returns true when the config changed.
 */
export async function setSkillDisabled(
  configPath: string,
  skillName: string,
  disabled: boolean
): Promise<boolean> {
  const config = await readConfig(configPath);
  const current = config.skills?.disabled ?? [];
  const has = current.includes(skillName);

  if (disabled === has) return false;

  const next = disabled ? [...current, skillName] : current.filter((n) => n !== skillName);
  config.skills = { ...config.skills, disabled: next };
  await writeConfig(configPath, config);
  return true;
}

/** Skill names Grok has been told to keep inactive. */
export async function getDisabledSkills(configPath: string): Promise<string[]> {
  const config = await readConfig(configPath);
  return config.skills?.disabled ?? [];
}

/** Registered skill directories, with `~` expanded. */
export async function getRegisteredSkillPaths(configPath: string): Promise<string[]> {
  const config = await readConfig(configPath);
  return (config.skills?.paths ?? []).map(expandHome);
}
