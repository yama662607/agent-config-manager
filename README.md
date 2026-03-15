# agent-config-sync

[![npm version](https://img.shields.io/npm/v/@yama662607/agent-config-sync)](https://www.npmjs.com/package/@yama662607/agent-config-sync)
[![npm downloads](https://img.shields.io/npm/dm/@yama662607/agent-config-sync)](https://www.npmjs.com/package/@yama662607/agent-config-sync)
[![license](https://img.shields.io/npm/l/@yama662607/agent-config-sync)](LICENSE)
[![Node.js Version](https://img.shields.io/node/v/@yama662607/agent-config-sync)](https://github.com/yama662607/agent-config-sync)

`acsync` is a cross-agent configuration manager for MCP servers and skills. Unlike manifest-based tools, `acsync` directly edits native config files in your project—no intermediate manifest, no "sync" step.

## Design Principles

> **`acsync` is a config manager, not a renderer.**

- **Native config files are the source of truth** — `.mcp.json`, `.codex/config.toml`, etc.
- **No project-side `acsync` files** — all tool state lives in `~/.acsync/`
- **Direct editing** — commands mutate native configs atomically
- **Works from any directory** — project discovery via Git root or native config files

## Quick Start

```bash
# Install
npm install -g @yama662607/agent-config-sync

# Add an MCP server to your project
acsync mcp add @modelcontextprotocol/server-github --targets claude

# Add a skill from GitHub
acsync skill install https://github.com/anthropics/skills/tree/main/skill-creator

# See what's configured
acsync mcp
acsync skill

# List catalog entries
acsync catalog mcp list
acsync catalog skill list
```

## Commands

### `acsync mcp`

Manage MCP servers for the current project.

```bash
# Show status (default) - Interactive TUI
acsync mcp

# Add a server
acsync mcp add @modelcontextprotocol/server-github --targets claude,codex

# Remove a server
acsync mcp remove @modelcontextprotocol/server-github

# Enable/disable for specific targets
acsync mcp disable github --targets claude
acsync mcp enable github --targets codex
```

### `acsync skill`

Manage skills for the current project.

```bash
# Show status (default) - Interactive TUI
acsync skill

# Add a skill from catalog
acsync skill add skill-creator --targets claude,codex

# Install a skill from GitHub
acsync skill install https://github.com/anthropics/skills/tree/main/frontend-design

# Remove a skill
acsync skill remove frontend-design
```

### `acsync catalog mcp`

Manage reusable MCP definitions in your local catalog (`~/.acsync/`).

```bash
# List all catalog entries
acsync catalog mcp list

# Show details
acsync catalog mcp show @modelcontextprotocol/server-github

# Add to catalog
acsync catalog mcp add @modelcontextprotocol/server-github

# Remove from catalog
acsync catalog mcp remove @modelcontextprotocol/server-github
```

### `acsync catalog skill`

Manage reusable skill definitions in your local catalog.

```bash
# List all catalog entries
acsync catalog skill list

# Show details
acsync catalog skill show skill-creator

# Add to catalog from file
acsync catalog skill add my-skill --file ./skills/my-skill/SKILL.md

# Import from local directory
acsync catalog skill import ~/.claude/skills/frontend-design

# Install from GitHub
acsync skill install https://github.com/anthropics/skills --name frontend-design

# Search skills.directory registry
acsync catalog skill search typescript

# Remove from catalog
acsync catalog skill remove skill-creator
```

### `acsync validate`

Validate project configuration without making changes.

```bash
acsync validate          # Warnings allowed
acsync validate --strict # Fail on warnings
```

### `acsync doctor`

Run diagnostics and health checks.

```bash
acsync doctor      # Check only
acsync doctor --fix # Attempt auto-fix
```

## Supported Targets

| Target | Config File | MCP | Skills |
|--------|-------------|-----|--------|
| Claude Code | `.mcp.json` | ✓ | ✓ |
| Codex | `.codex/config.toml` | ✓ | ✓ |
| Gemini CLI | `.gemini/settings.json` | ✓ | ✓ |

## Architecture

```
~/.acsync/                    # User-level catalog
├── catalog.json              # Reusable MCP and skill definitions
├── catalog-schema.json       # Schema versioning
└── catalog.lock              # Concurrent access safety

my-project/                   # Your project
├── .git/
├── .mcp.json                 # Claude Code MCP config (edited directly)
├── .claude/skills/           # Claude Code skills
│   └── <name>/SKILL.md
├── .codex/config.toml        # Codex config (edited directly)
├── .codex/skills/            # Codex skills
│   └── <name>/SKILL.md
└── .gemini/settings.json     # Gemini CLI config (edited directly)
```

## Benefits

- **No extra files in projects** — git diff shows actual config changes
- **Easy to explain** — "edits `.mcp.json`" vs "generates from manifest"
- **Tool-agnostic** — remove `acsync` and your project still works
- **CI-friendly** — `acsync validate` for checking, no drift detection needed
- **Cross-agent** — manage MCP and skills across Claude Code, Codex, and Gemini CLI

## License

MIT © [Daisuke Yamashiki](https://github.com/yama662607)

## Links

- [npm Package](https://www.npmjs.com/package/@yama662607/agent-config-sync)
- [GitHub Repository](https://github.com/yama662607/agent-config-sync)
- [Issues](https://github.com/yama662607/agent-config-sync/issues)
- [Model Context Protocol](https://modelcontextprotocol.io)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

If you encounter any issues or have questions, please [file an issue](https://github.com/yama662607/agent-config-sync/issues/new) on GitHub.
