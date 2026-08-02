/**
 * MCP servers under development.
 *
 * A skill can be linked: the catalog points at the working copy and every
 * provider sees edits immediately. An MCP server cannot — it is a process, and
 * what the catalog holds is a recipe for starting one. Pointing that recipe at a
 * working copy is the equivalent, and switching it to the published package is
 * how the work ships.
 *
 * This module only builds the recipe. Nothing here runs the server.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { McpRecipe } from './types.js';

/** How a project declares itself, and how its entry point is launched. */
interface ProjectKind {
  marker: string;
  /** Build a recipe for a project rooted at `dir`, or null when unrecognisable. */
  recipe(dir: string): Promise<McpRecipe | null>;
}

async function readJson(file: string): Promise<any | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Python projects are launched through `uv run --directory`, which resolves the
 * project's own environment without activating anything.
 */
async function pythonRecipe(dir: string): Promise<McpRecipe | null> {
  const pyproject = await fs.readFile(path.join(dir, 'pyproject.toml'), 'utf8').catch(() => null);
  if (!pyproject) return null;

  // `[project.scripts]` names the console entry point to run.
  const scripts = pyproject.match(/\[project\.scripts\]\s*\n([\s\S]*?)(\n\[|$)/);
  const entry = scripts?.[1].match(/^\s*([A-Za-z0-9_-]+)\s*=/m)?.[1];

  const name = entry ?? pyproject.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
  if (!name) return null;

  return { transport: 'stdio', command: 'uv', args: ['run', '--directory', dir, name] };
}

/**
 * Node projects run their `bin` entry. Bun is used when the project declares it,
 * because a TypeScript entry point cannot be run by node directly.
 */
async function nodeRecipe(dir: string): Promise<McpRecipe | null> {
  const manifest = await readJson(path.join(dir, 'package.json'));
  if (!manifest) return null;

  const bin =
    typeof manifest.bin === 'string'
      ? manifest.bin
      : typeof manifest.bin === 'object'
        ? Object.values(manifest.bin)[0]
        : undefined;

  const entry = (bin as string | undefined) ?? manifest.main ?? 'index.js';
  const entryPath = path.join(dir, entry);

  const usesBun =
    (await exists(path.join(dir, 'bun.lock'))) ||
    (await exists(path.join(dir, 'bun.lockb'))) ||
    entry.endsWith('.ts');

  return {
    transport: 'stdio',
    command: usesBun ? 'bun' : 'node',
    args: usesBun ? ['run', entryPath] : [entryPath],
  };
}

const PROJECT_KINDS: ProjectKind[] = [
  { marker: 'pyproject.toml', recipe: pythonRecipe },
  { marker: 'package.json', recipe: nodeRecipe },
];

/**
 * Build a recipe that launches a server from a working copy.
 * Throws when the directory does not look like a project this can start.
 */
export async function localRecipe(sourcePath: string): Promise<McpRecipe> {
  const dir = path.resolve(sourcePath);

  const stat = await fs.stat(dir).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`Not a directory: ${dir}`);
  }

  for (const kind of PROJECT_KINDS) {
    if (!(await exists(path.join(dir, kind.marker)))) continue;

    const recipe = await kind.recipe(dir);
    if (recipe) return recipe;

    throw new Error(`Found ${kind.marker} in ${dir} but could not work out how to start it`);
  }

  throw new Error(
    `No pyproject.toml or package.json in ${dir}. ` +
      'Pass --command and --args to describe how the server starts.'
  );
}

/** Build a recipe that launches a published npm package. */
export function packageRecipe(packageName: string): McpRecipe {
  return { transport: 'stdio', command: 'npx', args: ['-y', packageName] };
}

/** Whether a recipe points at a working copy rather than a published artifact. */
export function isLocalRecipe(recipe: McpRecipe): boolean {
  return (recipe.args ?? []).some((arg) => arg.startsWith('/') || arg.startsWith('~'));
}
