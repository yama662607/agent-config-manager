/**
 * Agent-native global paths.
 *
 * Every target has two scopes: project (a config root inside a repository) and
 * global (a machine-wide config root). For most targets the global path is just
 * the project-relative path under the home directory, but Antigravity uses a
 * different root for each: `.agents/` inside a project, `~/.gemini/config/`
 * globally. Resolving global paths by treating the home directory as a project
 * root therefore writes Antigravity config where the CLI never looks.
 *
 * Source: the "Antigravity Customization System" docs bundled with
 * antigravity-cli (`~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/`).
 * `json_configs.md` names `~/.gemini/config/` as the global customization root,
 * `skills.md` places skills at `<root>/skills/<name>/SKILL.md`, and
 * `mcp_servers.md` names `~/.gemini/config/mcp_config.json` as the global MCP
 * configuration.
 *
 * See project-discovery.ts for the project-scoped equivalents.
 */

import os from 'node:os';
import path from 'node:path';
import type { TargetName } from './types.js';

const home = os.homedir();

/** Machine-wide skill directories, where an agent finds skills for every project. */
export const AGENT_GLOBAL_SKILLS_DIR: Record<TargetName, string> = {
  claude: path.join(home, '.claude', 'skills'),
  codex: path.join(home, '.codex', 'skills'),
  antigravity: path.join(home, '.gemini', 'config', 'skills'),
  grok: path.join(home, '.grok', 'skills'),
};

/** Machine-wide MCP configuration files. */
export const AGENT_GLOBAL_MCP_CONFIG: Record<TargetName, string> = {
  // Claude's user scope lives inside its live state file. `~/.mcp.json` is a
  // project file that happens to sit in the home directory, so Claude reads it
  // only when the home directory is the project root.
  claude: path.join(home, '.claude.json'),
  codex: path.join(home, '.codex', 'config.toml'),
  antigravity: path.join(home, '.gemini', 'config', 'mcp_config.json'),
  grok: path.join(home, '.grok', 'config.toml'),
};

/** Machine-wide plugin directories, where an agent discovers plugins. */
export const AGENT_PLUGIN_DIR: Record<TargetName, string> = {
  claude: path.join(home, '.claude', 'plugins'),
  codex: path.join(home, '.codex', '.tmp', 'plugins', 'plugins'),
  antigravity: path.join(home, '.gemini', 'config', 'plugins'),
  grok: path.join(home, '.grok', 'plugins'),
};

/** Whether a path is the home directory, i.e. whether global paths apply. */
export function isHomeScope(projectRoot: string): boolean {
  return path.resolve(projectRoot) === home;
}

/**
 * Whether a config path is Claude's user-scope state file.
 *
 * That file holds the application's own runtime state, so it is written through
 * `claude mcp` rather than edited. See claude-user-mcp.ts.
 */
export function isClaudeUserScope(configPath: string): boolean {
  return path.resolve(configPath) === path.join(home, '.claude.json');
}
