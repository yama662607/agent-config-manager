/**
 * Claude Code user-scope MCP servers.
 *
 * Every other provider keeps its MCP configuration in a file that holds nothing
 * but settings, so `acm` edits those directly. Claude's user scope lives in
 * `~/.claude.json`, which is the application's live state — caches, OAuth
 * tokens, per-project history, startup counters. Writing that file behind a
 * running session risks losing state the session has in memory.
 *
 * So this one scope is delegated to `claude mcp`, the interface the provider
 * supports for exactly this purpose.
 *
 * `~/.mcp.json` is *not* this scope. It is a project file that happens to sit in
 * the home directory, read only when the home directory is the project root.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { McpRecipe } from './types.js';
import { inferPackageIdFromRecipe, sanitizeServerName } from './mcp-names.js';

const run = promisify(execFile);

/**
 * Edit the state file directly.
 *
 * Only used when the `claude` CLI is absent — which means Claude Code is not
 * installed here, so no session can be holding the file. Everything outside
 * `mcpServers` is preserved.
 */
async function editStateFile(
  change: (servers: Record<string, unknown>) => void
): Promise<void> {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');

  const file = path.join(os.homedir(), '.claude.json');

  let document: Record<string, unknown> = {};
  try {
    document = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    // No file yet: a machine being prepared before Claude Code is installed.
  }

  const servers = (document.mcpServers ?? {}) as Record<string, unknown>;
  change(servers);
  document.mcpServers = servers;

  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(document, null, 2), 'utf8');
  await fs.rename(temporary, file);
}

/** Whether the `claude` CLI can be invoked. */
export async function isClaudeCliAvailable(): Promise<boolean> {
  try {
    await run('claude', ['--version'], { timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

/** The server definition `claude mcp add-json` expects. */
function toServerJson(recipe: McpRecipe): Record<string, unknown> {
  if (recipe.url) {
    return {
      type: 'http',
      url: recipe.url,
      ...(recipe.env && Object.keys(recipe.env).length > 0 ? { env: recipe.env } : {}),
    };
  }

  return {
    type: 'stdio',
    command: recipe.command,
    ...(recipe.args && recipe.args.length > 0 ? { args: recipe.args } : {}),
    ...(recipe.env && Object.keys(recipe.env).length > 0 ? { env: recipe.env } : {}),
  };
}

function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const stderr = (error as { stderr?: string }).stderr;
  return (stderr && stderr.trim()) || message;
}

/**
 * Add or replace a server in Claude's user scope.
 * Replacing requires removing first: `add-json` refuses an existing name.
 */
export async function addUserScopeServer(name: string, recipe: McpRecipe): Promise<void> {
  if (!recipe.command && !recipe.url) {
    throw new Error(`No command or url to configure for ${name}`);
  }

  // Claude rejects anything but letters, numbers, hyphens and underscores, so a
  // package id like `@scope/name` is stored under a simple name and recovered
  // from the recipe when read back.
  const stored = sanitizeServerName(name);

  if (!(await isClaudeCliAvailable())) {
    await editStateFile((servers) => {
      servers[stored] = toServerJson(recipe);
    });
    return;
  }

  await removeUserScopeServer(name).catch(() => {
    // Absent is the expected case.
  });

  try {
    await run('claude', ['mcp', 'add-json', stored, JSON.stringify(toServerJson(recipe)), '-s', 'user'], {
      timeout: 30_000,
    });
  } catch (error) {
    throw new Error(`claude mcp add-json failed for ${stored}: ${explain(error)}`);
  }
}

/** Remove a server from Claude's user scope. Returns false when it was not there. */
export async function removeUserScopeServer(name: string): Promise<boolean> {
  const stored = await resolveStoredName(name);

  if (!(await isClaudeCliAvailable())) {
    let removed = false;
    await editStateFile((servers) => {
      removed = stored in servers;
      delete servers[stored];
    });
    return removed;
  }

  try {
    await run('claude', ['mcp', 'remove', stored, '-s', 'user'], { timeout: 30_000 });
    return true;
  } catch (error) {
    const message = explain(error).toLowerCase();
    if (message.includes('not found') || message.includes('no mcp server')) return false;
    throw new Error(`claude mcp remove failed for ${stored}: ${explain(error)}`);
  }
}

/** Read the servers configured in Claude's user scope. */
export async function listUserScopeServers(): Promise<Record<string, McpRecipe>> {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');

  // Reading is safe — only writing risks losing the application's own state.
  let parsed: { mcpServers?: Record<string, any> };
  try {
    const raw = await fs.readFile(path.join(os.homedir(), '.claude.json'), 'utf8');
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }

  const servers: Record<string, McpRecipe> = {};
  for (const [storedName, config] of Object.entries(parsed.mcpServers ?? {})) {
    const recipe: McpRecipe = {};
    if (config.url) {
      recipe.url = config.url;
      recipe.transport = 'http';
    } else if (config.command) {
      recipe.command = config.command;
      recipe.args = config.args ?? [];
      recipe.transport = 'stdio';
    }
    if (config.env) recipe.env = config.env;

    // The name Claude is configured with is the name. Substituting the package
    // id here renamed servers that were never called that — `openalex-mcp`
    // became `@cyanheads/openalex-mcp-server` — and split one server into two
    // rows in status, since the other providers' readers do no such thing.
    // Pairing with the catalog no longer needs this: `matchCatalogEntry` finds
    // the entry by the package the recipe launches.
    servers[storedName] = recipe;
  }

  return servers;
}

/** Find the name a server is actually stored under. */
async function resolveStoredName(name: string): Promise<string> {
  const servers = await listUserScopeServers();
  if (servers[name]) {
    const recipe = servers[name];
    const canonical = inferPackageIdFromRecipe(recipe.command, recipe.args);
    return canonical === name ? sanitizeServerName(name) : name;
  }
  return sanitizeServerName(name);
}
