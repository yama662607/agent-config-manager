/**
 * Skill provenance: where a catalog entry came from, and whether upstream moved.
 *
 * Only GitHub is supported for update checks. Other origins (plugin bundles,
 * desktop applications, hand-written skills) are recorded but reported as
 * unknown, because there is no general way to ask them "did you change?".
 *
 * Nothing here runs unless the user invokes a command that needs it. Status
 * output never touches the network.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { EnhancedSkillMetadata } from './types.js';

const run = promisify(execFile);

/** A GitHub URL broken into the pieces needed to query the API. */
export interface GitHubSource {
  owner: string;
  repo: string;
  /** Branch, tag or SHA as written in the URL. */
  ref: string;
  /** Path inside the repository. Empty for a repository root. */
  path: string;
}

/**
 * Parse `https://github.com/<owner>/<repo>/tree|blob/<ref>/<path...>`.
 * Returns null for anything else, including non-GitHub URLs.
 */
export function parseGitHubSource(url: string): GitHubSource | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.hostname !== 'github.com') return null;

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 2) return null;

  const [owner, repo, kind, ref, ...rest] = segments;

  if (kind === undefined) {
    return { owner, repo, ref: 'HEAD', path: '' };
  }
  if (kind !== 'tree' && kind !== 'blob') return null;
  if (!ref) return null;

  // A file URL is tracked by its directory: skills live as directories.
  const path = rest.join('/').replace(/\/SKILL\.md$/, '');
  return { owner, repo, ref, path };
}

/** Classify a recorded source URL. */
export function classifySource(url: string | undefined): EnhancedSkillMetadata['sourceKind'] {
  if (!url) return undefined;
  if (parseGitHubSource(url)) return 'github';
  if (url.startsWith('/') || url.startsWith('file:')) return 'local';
  return 'unknown';
}

/** Result of comparing a catalog entry against its upstream. */
export type UpstreamState =
  /** Recorded revision matches upstream. */
  | 'up-to-date'
  /** Upstream moved since this copy was taken. */
  | 'behind'
  /** Deliberately modified; not tracking upstream. */
  | 'forked'
  /** No usable source recorded, or an origin that cannot be queried. */
  | 'unknown'
  /** Network or API failure. */
  | 'unreachable';

export interface UpstreamStatus {
  skillId: string;
  state: UpstreamState;
  sourceUrl?: string;
  /** Revision recorded at import time. */
  recordedRef?: string;
  /** Revision upstream is at now. */
  latestRef?: string;
  /** Why the state is unknown or unreachable. */
  detail?: string;
}

/**
 * Resolve the latest commit that touched a path.
 *
 * Prefers the `gh` CLI because it uses the user's credentials (5000 requests
 * per hour, and private repositories work). Falls back to the unauthenticated
 * API, which allows 60 per hour.
 */
export async function resolveLatestCommit(source: GitHubSource): Promise<string> {
  const query = new URLSearchParams({ sha: source.ref, per_page: '1' });
  if (source.path) query.set('path', source.path);
  const endpoint = `repos/${source.owner}/${source.repo}/commits?${query}`;

  try {
    const { stdout } = await run('gh', ['api', endpoint, '--jq', '.[0].sha'], {
      timeout: 20_000,
    });
    const sha = stdout.trim();
    if (sha) return sha;
  } catch {
    // gh missing, unauthenticated, or the repository is unreachable for it.
  }

  const response = await fetch(`https://api.github.com/${endpoint}`, {
    headers: { Accept: 'application/vnd.github+json' },
  });

  if (response.status === 403 || response.status === 429) {
    throw new Error('GitHub API rate limit reached (install and authenticate `gh` to raise it)');
  }
  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status}`);
  }

  const commits = (await response.json()) as Array<{ sha?: string }>;
  const sha = commits[0]?.sha;
  if (!sha) throw new Error('No commits found for that path');
  return sha;
}

/**
 * Compare one catalog entry against its upstream.
 * Performs at most one network request, and none when the answer is already known.
 */
export async function checkUpstream(
  skillId: string,
  meta: EnhancedSkillMetadata
): Promise<UpstreamStatus> {
  if (meta.forked) {
    return { skillId, state: 'forked', sourceUrl: meta.sourceUrl, recordedRef: meta.sourceRef };
  }

  if (!meta.sourceUrl) {
    return { skillId, state: 'unknown', detail: 'no source recorded' };
  }

  const source = parseGitHubSource(meta.sourceUrl);
  if (!source) {
    return {
      skillId,
      state: 'unknown',
      sourceUrl: meta.sourceUrl,
      detail: 'only GitHub sources can be checked',
    };
  }

  let latestRef: string;
  try {
    latestRef = await resolveLatestCommit(source);
  } catch (error) {
    return {
      skillId,
      state: 'unreachable',
      sourceUrl: meta.sourceUrl,
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  if (!meta.sourceRef) {
    // Without the revision this copy came from, "behind" cannot be
    // distinguished from "locally edited".
    return {
      skillId,
      state: 'unknown',
      sourceUrl: meta.sourceUrl,
      latestRef,
      detail: 'no revision recorded at import time',
    };
  }

  return {
    skillId,
    state: meta.sourceRef === latestRef ? 'up-to-date' : 'behind',
    sourceUrl: meta.sourceUrl,
    recordedRef: meta.sourceRef,
    latestRef,
  };
}

/** Run checks with bounded concurrency so a large catalog does not flood the API. */
export async function checkUpstreamAll(
  entries: Array<{ id: string; meta: EnhancedSkillMetadata }>,
  concurrency = 4
): Promise<UpstreamStatus[]> {
  const results: UpstreamStatus[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < entries.length) {
      const entry = entries[index++];
      results.push(await checkUpstream(entry.id, entry.meta));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, worker));
  return results;
}
