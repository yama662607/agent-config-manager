# agent-config-manager

[![npm version](https://img.shields.io/npm/v/@yama662607/agent-config-manager)](https://www.npmjs.com/package/@yama662607/agent-config-manager)
[![npm downloads](https://img.shields.io/npm/dm/@yama662607/agent-config-manager)](https://www.npmjs.com/package/@yama662607/agent-config-manager)
[![license](https://img.shields.io/npm/l/@yama662607/agent-config-manager)](LICENSE)
[![Node.js Version](https://img.shields.io/node/v/@yama662607/agent-config-manager)](https://github.com/yama662607/agent-config-manager)

[日本語版はこちら (Japanese version is here)](README_JA.md)

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
acm mcp list -g
acm skill list -g
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

### Skill placement: symlink vs copy

`acm` places a skill from the catalog into a target either as a **symlink** back to the catalog
or as an independent **copy**.

| Destination | Default | Why |
|-------------|---------|-----|
| Home (`acm skill add … -H`) | symlink | Personal environment. One catalog copy is shared by every provider, so it can never drift. |
| Project | copy | Repositories are shared. An absolute symlink would break for anyone else and in CI. |

Override per command with `--link` or `--copy`:

```bash
# Link into the project as well (personal repo, single machine)
acm skill add my-skill --targets claude --link

# Force a standalone copy in the home directory
acm skill add my-skill --targets claude -H --copy
```

`acm skill` reports how each skill is placed:

| Placement | Meaning |
|-----------|---------|
| `link` | Symlink to the catalog. Always current. |
| `copy` | Copy whose contents match the catalog. |
| `stale` | Copy that no longer matches the catalog — reinstall to refresh. |
| `broken` | Symlink whose catalog target is gone. |
| `unlinked` | Installed, but no catalog entry to compare against. |
| `catalog` | Grok only: read straight from the registered catalog, never copied. |

When targets differ, the column lists them per target (`cl:stale cx:link`).

To move an existing copy onto a symlink, remove and add it again — there is no separate
migration command:

```bash
acm skill remove my-skill --targets claude -H
acm skill add my-skill --targets claude -H
```

### Developing a skill in its own repository

A catalog entry can be a symlink to a directory you develop elsewhere, so an edit in
that repository reaches every provider with no further step:

```bash
# Register ~/src/my-skill in the catalog without copying it
acm skill link ~/src/my-skill

# Give it a different catalog id
acm skill link ~/src/my-skill --as other-name

# Distribute as usual; home targets link by default
acm skill add my-skill --targets claude,codex -H

# Remove the catalog link. The source directory is never touched.
acm skill unlink my-skill
```

The chain is `development repository → catalog → provider`. Copying a linked entry into
a project dereferences it, so the project keeps real content and stays portable.

### Refreshing drifted copies

```bash
# Re-place every copy that no longer matches the catalog
acm skill update --targets claude,codex -H

# Just one skill
acm skill update my-skill --targets claude -H
```

Links and Grok registrations cannot drift, so they are left alone.

### Grok skills are registered, not copied

Grok discovers skills from directories listed under `[skills] paths` in `config.toml`, and it
already scans `~/.claude/skills` by default. Copying catalog skills into `~/.grok/skills` would
duplicate everything ACM installs for Claude, so `acm` registers the catalog directory with Grok
once instead:

```bash
acm skill add my-skill --targets grok -H
# → registers ~/.acm/skills in ~/.grok/config.toml
# → my-skill is read from the catalog, not copied
```

Because the whole directory is registered at once, every catalog skill becomes visible to Grok.
Removing one skill therefore turns it off by name rather than deleting a copy:

```bash
acm skill remove my-skill --targets grok -H
# → adds "my-skill" to [skills] disabled
```

`acm skill` shows these as placement `catalog`.

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

### Working with the catalog

Every command takes `-g` (or `--catalog`) to act on the catalog instead of a project.

```bash
# MCP entries
acm mcp list -g
acm mcp show -g @modelcontextprotocol/server-github
acm mcp add @modelcontextprotocol/server-github -g
acm mcp remove @modelcontextprotocol/server-github -g

# Skill entries
acm skill list -g
acm skill list -g --search typescript
acm skill show -g skill-creator
acm skill import ~/.claude/skills/frontend-design -g
acm skill install https://github.com/anthropics/skills/tree/main/skills/pdf
acm skill remove skill-creator -g
```

The older `acm catalog …` spelling still works but prints a deprecation notice
naming its replacement.

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

## Plugins bundled in desktop applications

The most current agent tooling is often not in a user-facing directory: it is bundled
inside a desktop application and replaced when that application updates.

```bash
acm plugin discover            # search applications for bundled plugins
acm plugin discover --import   # and take the new ones into the catalog
```

Nothing is located by a fixed path. A plugin is anything carrying a manifest
(`.claude-plugin/`, `.codex-plugin/`, or a root `plugin.json`) or a `skills/`
directory, and it is attributed to the application that contains it, with that
application's version.

That version matters for updates. An application replaces its whole bundle — often at a
new path — so `acm doctor` compares the digest recorded at import against the source's
digest now, locating the plugin by name rather than by where it used to be:

```
[Catalog Drift]
  ● visualize: changed in ChatGPT 26.700.00000 -> 26.727.51351
  ● 4 uncommitted changes in the catalog (4 in skills)
```

Two separate questions, because the fixes differ: **the source moved** (refresh from it)
and **the catalog moved** (commit it).

`acm doctor` also compares skills against their recorded upstream, which needs the
network. It runs by default — a diagnosis that quietly skips a class of problem is worse
than a slow one, and it is not slow. `--offline` skips it for CI or a missing
connection.

## Plugins

A plugin bundles skills, commands, agents, hooks and MCP servers. Bring one into the
catalog from any directory, then keep it current:

```bash
acm plugin import ./some-plugin       # read the manifest, copy into the catalog
acm plugin import ./some-plugin --as other-name
acm plugin list
acm plugin update                     # take newer copies where the source changed
acm plugin repair                     # restore files an older import dropped
```

`import` accepts any of the manifest locations — `.claude-plugin/plugin.json`,
`.codex-plugin/plugin.json`, `.grok-plugin/plugin.json`, or a root `plugin.json` — and
also a bare `skills/` directory with no manifest at all, which is how some applications
ship theirs.

### Every plugin on every provider

There is nothing to convert between them. The four providers agree on what a plugin is
and disagree only on where the manifest sits, so one directory carrying all four
locations is read by all of them. Each then applies its own handling — Antigravity turns
`commands/` into skills by itself, Claude ignores fields it does not recognise.

Installing is different: a plugin is enabled state a provider records, so that part goes
through each provider's own CLI. `acm plugin convert` publishes the catalog as a local
marketplace and hands it over:

```bash
acm plugin convert --all -t claude,codex,antigravity,grok
```

```
Assembling 107 plugins into ~/…/agent-catalog/marketplace...
  107 plugins, 553 skill directories pulled from the catalog

Registering the marketplace:
  [claude] ok: claude plugin marketplace add …
  [codex] ok: codex plugin marketplace add …
  [antigravity] installs per plugin — see below
  [grok] already registered: grok plugin marketplace add …

Install a plugin with:
  [claude] claude plugin install build-ios-apps@acm-catalog
  [codex] codex plugin add build-ios-apps@acm-catalog
  [grok] grok plugin install …/marketplace/plugins/build-ios-apps --trust
  [antigravity] agy plugin install …/marketplace/plugins/build-ios-apps

Carried but unused:
  `apps` — ignored by antigravity, grok
```

The last section is the point of the command: a field a provider will not read is
carried across and named, rather than dropped quietly. The generated marketplace is
derived output — rebuild it any time, and keep it out of version control.

See [docs/provider-config-surfaces.md](docs/provider-config-surfaces.md) for the
evidence behind all of this, including the one genuine difference (Antigravity reads a
plugin's MCP servers from `mcp_config.json`, not `.mcp.json`).

## How each provider is written

`acm` edits provider configuration files directly — except where a file also holds the
application's own runtime state.

| Provider | Home scope | Written by |
|----------|-----------|------------|
| Claude Code | `~/.claude.json` → `mcpServers` | `claude mcp add-json -s user` |
| Codex | `~/.codex/config.toml` | direct |
| Antigravity | `~/.gemini/config/mcp_config.json` | direct |
| Grok | `~/.grok/config.toml` | direct |

Claude's user scope lives inside its live state file — caches, OAuth tokens, per-project
history — so editing it behind a running session risks losing that state. `acm` delegates
to the provider's own CLI instead, falling back to a direct edit only when the CLI is
absent, which means Claude Code is not installed and no session can be holding the file.

`~/.mcp.json` is *not* the user scope. It is a project file that happens to sit in the
home directory, read only when the home directory is the project root.

See [docs/provider-config-surfaces.md](docs/provider-config-surfaces.md) for every
location, how each was verified, and how to re-check them when a provider updates.

## Developing an MCP server

A skill can be linked, so an edit reaches every provider at once. An MCP server cannot —
it is a process, and the catalog holds a recipe for starting one. Point that recipe at a
working copy while developing, and switch it to the published package when it ships:

```bash
acm mcp add my-server --local ~/src/my-server -t codex
acm mcp add my-server --from-package @scope/my-server -t codex
```

`--local` reads the project to work out how it starts: a `pyproject.toml` becomes
`uv run --directory <path> <script>`, a `package.json` becomes `node <bin>` — or
`bun run <entry>` when the entry point is TypeScript. Anything else needs `--command`
and `--args`.

`acm doctor` checks that every configured command still resolves, which catches a
recipe left pointing at a moved or uninstalled binary.

## MCP drift

An MCP server is a launch recipe, not a file, so "drift" means a target launches
something different from what the catalog says.

```bash
acm mcp                      # State column per server
acm mcp --verbose            # shows what each target actually launches
acm mcp update [server]      # re-apply the catalog recipe where it differs
```

| State | Meaning |
|-------|---------|
| `synced` | Matches the catalog recipe |
| `differs` | Configured differently from the catalog |
| `inline` | Configured here but absent from the catalog |
| `disabled` | Configured but switched off |

Environment *values* are excluded from the comparison — they routinely hold
machine-specific secrets and paths that legitimately differ. Variable *names* are
compared, because a missing variable is a real difference.

`acm mcp update` only touches servers that exist in the catalog: an inline server
has no catalog recipe to apply, and overwriting it would destroy the only copy.

When the deployed side is the correct one — an application moved, a package gained a
version suffix, someone fixed a broken command in place — adopt it instead:

```bash
acm mcp adopt <server> -t claude    # copy that target's recipe into the catalog
acm mcp adopt -t claude             # everything that differs or is inline
```

Adopting takes exactly one target, since it picks a winner. It warns when the adopted
recipe carries a machine-specific path, but does not refuse: the configuration was
deliberate.

## Where a skill came from

A downloaded skill has an upstream that keeps moving. `acm` records where each one
came from so it can be revisited later.

```bash
# install records the URL and resolves the branch to the commit it points at now
acm skill install https://github.com/owner/repo/tree/main/skills/thing

# record it for something already in the catalog
acm skill meta thing --source https://github.com/owner/repo/tree/main/skills/thing --ref <sha>

# a deliberate divergence stops being reported as behind
acm skill meta thing --forked

# find everything from one upstream
acm skill list -g --source owner/repo

# compare recorded sources against upstream
acm skill outdated
acm skill outdated --json
```

| State | Meaning |
|-------|---------|
| `up to date` | The recorded revision is what upstream is at |
| `behind` | Upstream moved since this copy was taken |
| `forked` | Deliberately modified; not tracking upstream |
| `unknown` | No source recorded, no revision recorded, or an origin that cannot be queried |
| `unreachable` | Network or API failure |

Only GitHub sources can be checked. Plugin bundles, application-bundled skills and
hand-written ones are recorded but reported as `unknown`.

`acm skill outdated` is the only skill command that uses the network, and it reports
rather than applies: review the upstream changes, then re-install what you want.
It uses the `gh` CLI when available (5000 requests/hour, private repositories work)
and falls back to the unauthenticated API (60/hour).

## Scopes

Every command acts on exactly one scope:

| Scope | Flag | Acts on |
|-------|------|---------|
| Project | `--project` (default) | `.mcp.json`, `.claude/skills/` … under the current directory |
| Home | `-H`, `--home` | Each agent's machine-wide config |
| Catalog | `-g`, `--catalog` | The acm catalog itself |

`--global` remains as an alias for `--catalog`.

## Machine-readable output

`acm mcp` and `acm skill` accept `--json` for scripting:

```bash
acm skill -H --json | jq '.skills[] | select(.placement.claude == "copy-stale") | .name'
acm mcp --json | jq '.servers[].name'
```

## What the catalog stores

| Held in | What |
|---------|------|
| `skills/<id>/` | The skills themselves — the directory *is* the index |
| `skills-metadata.toml` | What files cannot say: when it was added, tags, category, upstream, pinned, deprecated |
| `catalog.toml` | MCP recipes, which have no directory to derive them from |

The skill index is rebuilt from the directory on every load: id from the folder name,
display name and description from the frontmatter. It is therefore not written back to
`catalog.toml` — storing it created a second place to disagree with, and on a real
catalog of 623 skills the two had drifted apart by 62 entries.

Dropping a skill directory in works with no further step, and editing frontmatter shows
up immediately.

## Catalog Location

`acm` keeps two directories apart:

| Directory | Contents | Configurable |
|-----------|----------|--------------|
| `~/.acm/` | This tool's own state: `config.toml`, `catalog.lock` | No |
| Catalog | Your skills, MCP recipes and plugins | **Yes** |

By default the catalog *is* `~/.acm/`. Point it elsewhere when you want to keep the
catalog in its own version-controlled repository:

```bash
# Per invocation or per shell
export ACM_CATALOG_DIR=~/src/my-catalog
```

```toml
# ~/.acm/config.toml — persistent
catalog_dir = "~/src/my-catalog"
```

Resolution order: `ACM_CATALOG_DIR`, then `catalog_dir`, then `~/.acm`. `acm doctor`
shows which one is in effect.

**By default there is no separate catalog** — `~/.acm` *is* the catalog, and a linked
skill points straight at it. Only when the catalog is moved elsewhere does `~/.acm`
become an indirection: distribution links keep pointing at `~/.acm/skills/<id>` as
long as it resolves to the same directory, so relocating the catalog does not break
anything already distributed.

`config.toml` also sets the targets used when a command names none:

```toml
default_targets = ["claude", "codex", "antigravity", "grok"]
```

### Skill metadata

```bash
acm skill meta my-skill                       # show what is recorded
acm skill meta my-skill --deprecated          # mark superseded
acm skill meta my-skill --pin --tags a,b,c
```

`acm skill list -g --deprecated` filters by that flag.

## Using one catalog on more than one machine

The catalog is a directory, so a git repository is all the synchronisation it needs. On
the second machine:

```bash
git clone <your catalog repo> ~/Code/Tools/agent-catalog
npm install -g @yama662607/agent-config-manager
acm init --catalog ~/Code/Tools/agent-catalog
```

`git pull` and `git push` keep them in step. Nothing else is required, and there is no
sync daemon or lock file to go wrong.

This is a different thing from publishing. A shared personal catalog stays private and
holds everything; a published bundle is an opt-in subset — see the next section.

### What does not travel

Most of a catalog does. A skill's files travel; a recipe that runs `npx -y <package>`
travels. What does not is a skill symlinked into a development repository, or a recipe
naming a binary, a checkout or a vault by absolute path. Those are deliberate, so `acm`
lists them rather than objecting:

```
[Portability]
  ✓ 14 references to this machine, all present
    They will need attention if you clone this catalog elsewhere.
```

On the machine that wrote them, that count is what you want to know *before* cloning.
On the second machine the same list becomes the work to do:

```
[Portability]
  ✗ zotero: command -> ~/.local/bin/zotero-mcp
  ✗ obsidian-companion-mcp: environment OBSIDIAN_VAULT_PATH -> ~/Library/…/Main
  4 of 14 not found on this machine.
    Re-link the skill, or point the recipe at where it lives here.
```

Re-link a skill by pointing it at the working copy on that machine, and repoint a recipe
with `acm mcp add --command …` or by editing the catalog entry. The check is local — a
stat per path — so it costs nothing to run.

## Publishing a Public Subset

A personal catalog holds far more than should ever be public, so publishing is opt-in.
Only entries named in an allowlist are staged, and the bundle is refused outright if it
contains secrets or personal paths.

```bash
# PUBLIC.txt in the catalog — one <kind>/<name> per line
#   skill/my-public-skill
#   mcp/my-server
#   plugin/my-plugin

acm catalog publish                          # stage into <catalog>/dist-public
acm catalog publish --to ~/Code/public-repo  # sync into a git working tree
acm catalog publish --to ~/Code/public-repo --dry-run
acm catalog publish --to ~/Code/public-repo --commit
```

`--commit` commits in the destination; it never pushes. Files the bundle needs but the
catalog does not hold as entries (README, LICENSE, `.gitignore`, setup docs) go in
`<catalog>/publish/bundle/` and are copied verbatim over the staged root.

Development-only content (`.git`, `node_modules`, `tests`, `evals`, `__pycache__`,
`VERIFICATION.md`, …) is dropped, and symlinked entries are dereferenced so the bundle
stands alone.

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
