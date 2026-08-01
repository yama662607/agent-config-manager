/**
 * Shared target-name parsing.
 *
 * Centralizes the alias table so CLI entry points do not each keep their own
 * copy and drift apart.
 */

import type { TargetName } from './types.js';

export const VALID_TARGETS: TargetName[] = ['claude', 'codex', 'antigravity', 'grok'];

export const TARGET_ALIASES: Record<string, TargetName> = {
  claude: 'claude',
  c: 'claude',
  codex: 'codex',
  x: 'codex',
  antigravity: 'antigravity',
  agy: 'antigravity',
  a: 'antigravity',
  g: 'antigravity',
  grok: 'grok',
  k: 'grok',
};

/** Human-readable alias list for help text and error messages. */
export const TARGET_HELP = 'claude(c), codex(x), antigravity(agy, a, g), grok(k)';

/**
 * Parse a comma-separated target list. `all` expands to every target.
 * Throws on an unknown name.
 */
export function parseTargetList(input: string): TargetName[] {
  if (input.trim().toLowerCase() === 'all') {
    return [...VALID_TARGETS];
  }

  return input.split(',').map((raw) => {
    const name = raw.trim().toLowerCase();
    const resolved = TARGET_ALIASES[name];
    if (!resolved) {
      throw new Error(`Invalid target: '${name}'. Valid: ${TARGET_HELP}, all`);
    }
    return resolved;
  });
}
