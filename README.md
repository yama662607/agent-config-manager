# agent-config-manager

[![npm version](https://img.shields.io/npm/v/@yama662607/agent-config-manager)](https://www.npmjs.com/package/@yama662607/agent-config-manager)
[![npm downloads](https://img.shields.io/npm/dm/@yama662607/agent-config-manager)](https://www.npmjs.com/package/@yama662607/agent-config-manager)
[![license](https://img.shields.io/npm/l/@yama662607/agent-config-manager)](LICENSE)
[![Node.js Version](https://img.shields.io/node/v/@yama662607/agent-config-manager)](https://github.com/yama662607/agent-config-manager)

`acm` is a cross-agent configuration manager for MCP servers and skills. Unlike manifest-based tools, `acm` directly edits native config files in your project—no intermediate manifest, no "sync" step.

## Design Principles

> **`acm` is a config manager, not a renderer.**

- **Native config files are the source of truth** — `.mcp.json`, `.codex/config.toml`, etc.
- **No project-side `acm` files** — all tool state lives in `~/.acm/`
- **Direct editing** — commands mutate native configs atomically
- **Works from any directory** — project discovery via Git root or native config files

## Quick Start

```bash
# Install
npm install -g @yama662607/agent-config-manager

# Add an MCP server to your project
acm mcp add @modelcontextprotocol/server-github --targets claude

# Add a skill from GitHub
acm skill install https://github.com/anthropics/skills/tree/main/skill-creator

# See what's configured
acm mcp
acm skill

# List catalog entries
acm catalog mcp list
acm catalog skill list
```

## Commands

### `acm mcp`

Manage MCP servers for the current project.

```bash
# Show status (default) - Interactive TUI
acm mcp

# Add a server
acm mcp add @modelcontextprotocol/server-github --targets claude,codex

# Remove a server
acm mcp remove @modelcontextprotocol/server-github

# Enable/disable for specific targets
acm mcp disable github --targets claude
acm mcp enable github --targets codex
```

### `acm skill`

Manage skills for the current project.

```bash
# Show status (default) - Interactive TUI
acm skill

# Add a skill from catalog
acm skill add skill-creator --targets claude,codex

# Install a skill from GitHub
acm skill install https://github.com/anthropics/skills/tree/main/frontend-design

# Remove a skill
acm skill remove frontend-design
```

### `acm catalog mcp`

Manage reusable MCP definitions in your local catalog (`~/.acm/`).

```bash
# List all catalog entries
acm catalog mcp list

# Show details
acm catalog mcp show @modelcontextprotocol/server-github

# Add to catalog
acm catalog mcp add @modelcontextprotocol/server-github

# Remove from catalog
acm catalog mcp remove @modelcontextprotocol/server-github
```

### `acm catalog skill`

Manage reusable skill definitions in your local catalog.

```bash
# List all catalog entries
acm catalog skill list

# Show details
acm catalog skill show skill-creator

# Add to catalog from file
acm catalog skill add my-skill --file ./skills/my-skill/SKILL.md

# Import from local directory
acm catalog skill import ~/.claude/skills/frontend-design

# Install from GitHub
acm skill install https://github.com/anthropics/skills --name frontend-design

# Search skills.directory registry
acm catalog skill search typescript

# Remove from catalog
acm catalog skill remove skill-creator
```

### `acm validate`

Validate project configuration without making changes.

```bash
acm validate          # Warnings allowed
acm validate --strict # Fail on warnings
```

### `acm doctor`

Run diagnostics and health checks.

```bash
acm doctor      # Check only
acm doctor --fix # Attempt auto-fix
```

## Supported Targets

| Target | Config File | MCP | Skills |
|--------|-------------|-----|--------|
| Claude Code | `.mcp.json` | ✓ | ✓ |
| Codex | `.codex/config.toml` | ✓ | ✓ |
| Antigravity CLI | `.gemini/antigravity/mcp_config.json` | ✓ | ✓ |
| Grok CLI | `.grok/config.toml` | ✓ | ✓ |

Target aliases for `--targets`: `claude`/`c`, `codex`/`x`, `antigravity`/`agy`/`a`/`g`, `grok`/`k`.

Grok stores MCP servers in TOML under `[mcp_servers.<name>]`, like Codex, but uses `url` (not
`httpUrl`) for HTTP/SSE transports and supports a native `enabled` flag. Editing a Grok config
rewrites the whole TOML file, so comments in `config.toml` are not preserved (same as Codex).

## Manual Catalog Editing & Advanced Features

The `acm` catalog database (`~/.acm/catalog.toml`) is saved in TOML format, making it incredibly easy for developers to open and edit manually in any text editor, or to import configuration blocks directly.

### 1. Copy-Paste Import of Claude/Codex Configurations (MCP Server Auto-Normalization)
You can copy raw `mcpServers` (or `mcp_servers`) blocks directly from existing Claude Code or Codex configuration files and paste them right into the root level of your `~/.acm/catalog.toml` file:

```toml
# Paste this directly into ~/.acm/catalog.toml!
[mcpServers.sqlite]
command = "uvx"
args = [
  "mcp-server-sqlite",
  "--db-path",
  "/path/to/db.sqlite"
]

[mcpServers.sqlite.env]
SOME_ENV_VAR = "value"
```

**Merging and Normalization Process:**
- The next time any `acm` command runs or the catalog is loaded, it automatically detects this raw block.
- The raw configuration is converted and normalized into standard `acm` catalog entries (`catalog.mcps`) automatically.
- During normalization, **existing metadata (such as `displayName`, `tags`, `description`) will NOT be destructively overwritten.** The tool safely merges the new execution recipe into your existing catalog entry, preserving your user-edited metadata.
- Once migration and normalization complete, the pasted raw `mcpServers` block is automatically cleaned up and removed from `catalog.toml`.

### 2. Drag-and-Drop Skill Auto-Discovery & Symlink Support
You can manage skills effortlessly by dropping folders containing a `SKILL.md` directly into the `~/.acm/skills/` directory.

- **Drag-and-Drop Folders:** Simply copy or move a skill directory (e.g. `frontend-design`) into `~/.acm/skills/`.
- **Symbolic Link Support:** You can also link skills via symlinks (e.g., `ln -s /path/to/my-skill ~/.acm/skills/my-skill`). `acm` automatically resolves symlinks and scans the target directory's `SKILL.md` to register metadata (name, description, license) into the catalog index.
- **Auto-Unregistration:** Deleting or removing a directory or symlink from `~/.acm/skills/` will automatically sync with the catalog index upon the next run, safely unregistering the deleted skill to keep everything tidy and synchronized with the filesystem.
- **Robust Metadata Extraction:** Frontmatter parser utilizes a native YAML parser under the hood, ensuring safe extraction even with multiline descriptions or complex YAML frontmatter structures in `SKILL.md`.

### 3. File Locking & Concurrency Protection
Any writes/mutations to the catalog are guarded using a lightweight file lock mechanism (`~/.acm/catalog.lock`). This ensures that even when multiple agents or parallel processes access or mutate the catalog, write collisions and file corruption are completely prevented.

## Architecture

```
~/.acm/                    # User-level catalog
├── catalog.toml              # Reusable MCP and skill definitions (TOML format)
├── catalog-schema.json       # Schema versioning
└── catalog.lock              # Concurrent access safety (created/deleted automatically)

my-project/                   # Your project
├── .git/
├── .mcp.json                 # Claude Code MCP config (edited directly)
├── .claude/skills/           # Claude Code skills
│   └── <name>/SKILL.md
├── .codex/config.toml        # Codex config (edited directly)
├── .codex/skills/            # Codex skills
│   └── <name>/SKILL.md
├── .gemini/antigravity/mcp_config.json  # Antigravity CLI config (edited directly)
├── .agents/skills/           # Antigravity CLI skills
│   └── <name>/SKILL.md
├── .grok/config.toml         # Grok CLI config (edited directly)
└── .grok/skills/             # Grok CLI skills
    └── <name>/SKILL.md
```

## Benefits

- **No extra files in projects** — git diff shows actual config changes
- **Easy to explain** — "edits `.mcp.json`" vs "generates from manifest"
- **Tool-agnostic** — remove `acm` and your project still works
- **CI-friendly** — `acm validate` for checking, no drift detection needed
- **Cross-agent** — manage MCP and skills across Claude Code, Codex, Antigravity CLI, and Grok CLI

## License

MIT © [Daisuke Yamashiki](https://github.com/yama662607)

## Links

- [npm Package](https://www.npmjs.com/package/@yama662607/agent-config-manager)
- [GitHub Repository](https://github.com/yama662607/agent-config-manager)
- [Issues](https://github.com/yama662607/agent-config-manager/issues)
- [Model Context Protocol](https://modelcontextprotocol.io)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

If you encounter any issues or have questions, please [file an issue](https://github.com/yama662607/agent-config-manager/issues/new) on GitHub.
