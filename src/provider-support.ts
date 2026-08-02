/**
 * What each provider actually reads.
 *
 * Writing a file a provider never opens looks like success and is not. Several
 * bugs in this project were exactly that, so the known gaps are recorded here
 * and surfaced at the moment a command would write into one.
 *
 * Verified 2026-08-02; see docs/provider-config-surfaces.md for the evidence and
 * for how to re-check when a provider updates.
 */

import type { TargetName } from './types.js';

export type ConfigKind = 'mcp' | 'skill';

/** A scope a provider does not read, and what to do instead. */
interface UnsupportedScope {
  note: string;
  alternative: string;
}

/**
 * Project-scope gaps. Home scope works for every provider.
 *
 * Antigravity is the only provider with gaps: its CLI reads neither a
 * project-local `mcp_config.json` nor project skills. Whether the IDE differs is
 * unverified, so the write still happens — it simply says so.
 */
const UNSUPPORTED_PROJECT_SCOPE: Partial<Record<TargetName, Partial<Record<ConfigKind, UnsupportedScope>>>> = {
  antigravity: {
    mcp: {
      note: 'the Antigravity CLI has no project-scope MCP configuration',
      alternative: 'configure it for the home scope with -H, or ship it inside a plugin',
    },
    skill: {
      note: 'the Antigravity CLI does not read project skills',
      alternative: 'distribute to the home scope with -H',
    },
  },
};

/**
 * A warning to print before writing, or null when the provider reads the scope.
 * `isHome` short-circuits: home scope is supported everywhere.
 */
export function unsupportedScopeWarning(
  target: TargetName,
  kind: ConfigKind,
  isHome: boolean
): string | null {
  if (isHome) return null;

  const gap = UNSUPPORTED_PROJECT_SCOPE[target]?.[kind];
  if (!gap) return null;

  return (
    `Warning: ${gap.note}.\n` +
    `         The file will still be written, in case the IDE reads it, but the CLI will ignore it.\n` +
    `         To take effect: ${gap.alternative}.`
  );
}
