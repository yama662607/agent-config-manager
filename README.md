# agent-config-sync

`acsync` is a cross-agent configuration manager for MCP servers and other agent assets. Unlike manifest-based tools, `acsync` directly edits native config files in your project—no intermediate manifest, no "sync" step.

## Design Principles

> **`acsync` is a config manager, not a renderer.**

- **Native config files are the source of truth** — `.mcp.json`, `.codex/config.toml`, etc.
- **No project-side `acsync` files** — all tool state lives in `~/.acsync/`
- **Direct editing** — commands mutate native configs atomically
- **Works from any directory** — project discovery via Git root or native config files

## Quick Start

```bash
# Install
npm install -g agent-config-sync

# Add an MCP server to your project
acsync mcp add @modelcontextprotocol/server-github --targets claude

# See what's configured
acsync mcp

# List catalog entries
acsync catalog mcp list

# Diagnose issues
acsync doctor
```

## Commands

### `acsync mcp`

Manage MCP servers for the current project.

```bash
# Show status (default)
acsync mcp

# Add a server
acsync mcp add @modelcontextprotocol/server-github --targets claude,codex

# Remove a server
acsync mcp remove @modelcontextprotocol/server-github

# Enable/disable for specific targets
acsync mcp disable github --targets claude
acsync mcp enable github --targets codex
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

| Target | Config File | Status |
|--------|-------------|--------|
| Claude Code | `.mcp.json` | ✓ Supported |
| Codex | `.codex/config.toml` | ✓ Supported |
| Gemini CLI | `.gemini/settings.json` | ✓ Supported |

## Architecture

```
~/.acsync/                    # User-level catalog
├── catalog.json              # Reusable MCP definitions
├── catalog-schema.json       # Schema versioning
└── catalog.lock              # Concurrent access safety

my-project/                   # Your project
├── .git/
├── .mcp.json                 # Claude Code MCP config (edited directly)
├── .codex/config.toml        # Codex config (edited directly)
└── .gemini/settings.json     # Gemini CLI config (edited directly)
```

## Migration from Manifest-Based Workflow

If you were using the old manifest-based `acsync`:

1. **No automatic migration** — the old workflow is completely different
2. **Native configs are now the source of truth** — edit them directly or via `acsync mcp`
3. **No manifest file** — `acsync` reads/writes native configs directly

## Benefits

- **No extra files in projects** — git diff shows actual config changes
- **Easy to explain** — "edits `.mcp.json`" vs "generates from manifest"
- **Tool-agnostic** — remove `acsync` and your project still works
- **CI-friendly** — `acsync validate` for checking, no drift detection needed

## Phase 2 (Future)

- Skill management
- Additional targets
- Import from external registries

## License

MIT
