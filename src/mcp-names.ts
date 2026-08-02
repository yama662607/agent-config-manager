/**
 * MCP server naming.
 *
 * A catalog entry is keyed by its package id (`@scope/name`), but several
 * providers only accept simple identifiers: Codex requires a bare TOML table
 * key, and Claude rejects anything outside letters, numbers, hyphens and
 * underscores. The stored name is therefore sanitized, and the original id is
 * recovered from the recipe when reading back.
 */

/** Names a provider will accept as-is. */
export const SIMPLE_SERVER_NAME = /^[a-zA-Z0-9_-]+$/;

/** Package-id shaped names, including npm scopes. */
export const SERVER_NAME_PATTERN = /^(@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+$/;

export function sanitizeServerName(serverName: string): string {
  if (SIMPLE_SERVER_NAME.test(serverName)) {
    return serverName;
  }

  const packageName = serverName.split('/').pop() ?? serverName;
  const normalized = packageName
    .replace(/^server-/, '')
    .replace(/-mcp$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/-+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || 'server';
}

export function inferPackageIdFromRecipe(command?: string, args?: string[]): string | null {
  if (!command || !args || args.length === 0) {
    return null;
  }

  if (!['npx', 'npm', 'pnpm', 'yarn', 'bunx'].includes(command)) {
    return null;
  }

  for (const arg of args) {
    if (arg.startsWith('-')) continue;
    if (arg === 'exec' || arg === 'dlx') continue;
    if (SERVER_NAME_PATTERN.test(arg)) {
      return arg;
    }
  }

  return null;
}
