# agent-config-manager

[日本語](README_JA.md) · [Migration notes](docs/rust-migration.md) · [Preview, recovery, and verification](docs/native-workflows.md)

`acm` manages MCP servers, skills, and plugins across Claude Code, Codex, Antigravity, and Grok. Its CLI and interactive TUI share one Rust implementation. Provider configuration remains the source of truth; the catalog holds reusable definitions and complete asset directories.

## Install

Build the Rust version from a checkout:

```sh
cargo install --path . --locked
acm --version
```

The native executable needs no Node.js runtime. Node.js 20 or newer is required only for npm's executable launcher and development packaging scripts. An MCP recipe may separately require Node, Python, `uv`, or another command.

Release CI assembles native archives and an npm package for macOS, Linux, and Windows on x64 and arm64. Downloaded archives contain `acm` (Windows: `acm.exe`) and a checksum manifest. The combined npm package exposes both `acm` and `agent-config-manager`:

```sh
npm install -g @yama662607/agent-config-manager
```

The npm registry may still serve an earlier release until the maintainer publishes the Rust package. Use the source installation above to run this checkout. See [release preparation](docs/rust-migration.md#release-preparation).

## Scopes and configuration

| Scope | Selection | Behavior |
| --- | --- | --- |
| Project | default or `--project` | Discover the nearest Git/native config root from the current directory; standalone directories also work |
| Provider home | `--home`, `-H`, `--allow-home` | Operate on the current user's provider settings |
| Catalog | `--catalog`, `-g`, `--global` | Manage reusable definitions without deploying them |

Running from the home directory requires explicit `--home`. Native plugin commands default to home; project plugin installation is supported by Claude only.

Select targets with `--targets claude,codex` or `-t all`. Accepted aliases: `c` (Claude), `x` (Codex), `a`/`g`/`agy` (Antigravity), `k` (Grok). Configure defaults in `~/.acm/config.toml`:

```toml
catalog_dir = "~/Code/my-agent-catalog"
default_targets = ["claude", "codex"]
# Optional: restrict desktop plugin discovery to selected directories.
# discovery_roots = ["~/Applications", "~/Library/Application Support/Claude"]

# Optional explicit native CLI executable, without changing PATH.
# [provider_commands]
# codex = "/path/to/codex"
```

Native provider commands resolve from `ACM_CLAUDE_BIN`, `ACM_CODEX_BIN`, `ACM_ANTIGRAVITY_BIN`, or `ACM_GROK_BIN`, then the corresponding `provider_commands` entry, then the normal command on PATH (`agy` for Antigravity). Overrides affect native plugin operations and Claude home MCP delegation; they do not select the command run by an MCP recipe.

Catalog location precedence is `ACM_CATALOG_DIR`, `catalog_dir`, then `~/.acm`. Without `default_targets`, all four targets are selected. Invalid configuration produces an error. See [state and catalog storage](docs/state-directory-and-catalog.md) and [provider surfaces](docs/provider-config-surfaces.md).

## MCP servers

```sh
acm mcp list
acm mcp add example --command echo --arg hello --targets codex
acm mcp add remote --url https://example.com/mcp --targets claude --home
acm mcp add local --local ./my-mcp --targets codex
acm mcp add tool --from-package @example/mcp-server --targets claude
acm mcp edit example --args '["updated"]' --env MODE=demo --targets codex
acm mcp disable example --targets codex
acm mcp enable example --targets codex
acm mcp show example --targets codex --json
acm mcp remove example --targets codex
```

Add automatically registers a recipe in the catalog; `--no-register` disables registration. `--arg` is repeatable; `--args` accepts a JSON array. `--env KEY=VALUE` is repeatable; a JSON object of string values is also accepted. `--cwd` sets a working directory. Local Node/Bun packages and Python projects are detected from `package.json` or `pyproject.toml`.

Project status groups catalog-backed servers by their catalog ID and reports `synced`, `differs`, `disabled`, `inline`, `plugin`, or `missing` per target. Plugin-owned servers identify their plugin.

```sh
# Deploy the catalog recipe to configured providers.
acm mcp update example --targets codex
# Save one provider's current recipe back into the catalog.
acm mcp adopt example --targets codex
# Manage catalog recipes directly; legacy `catalog mcp` also works.
acm mcp list --catalog --search example
acm catalog mcp show example
```

`--dry-run` previews MCP add/edit/remove/enable/disable/update/adopt without writing files or running provider commands. It shows target paths and redacted before/after definitions. Updates preserve disabled state and reject ambiguous catalog identities.

Writes preserve unrelated native settings. Claude home MCP changes use `claude mcp` commands because `~/.claude.json` also contains runtime state. Disabled Claude/Antigravity definitions are retained in machine-local state and restored on enable. Codex/Grok use their native enabled flag.

## Skills

```sh
acm skill import ./my-skill --catalog
acm skill install https://github.com/example/skills/tree/main/skills/my-skill --catalog
acm skill add my-skill --targets claude,codex
acm skill import ./my-skill --no-catalog --targets codex
acm skill add notes --file ./notes.md --targets claude
acm skill search coding
acm skill list --all --json
```

Directory imports and GitHub installs retain supporting files and executable permissions. Existing imports require `--force` to replace. Downloads use the configured `gh` CLI when available, with public HTTPS as fallback. GitHub sources record their commit for `skill outdated`.

Project placement defaults to copying; home placement defaults to linking. Override with `--copy` or `--link`. Grok registers the catalog's skill directory through `skills.paths`; this makes all skills in that directory discoverable. Use `skill disable <id> -t grok` to exclude one. A `--no-catalog` import/install instead places its own directory in the provider scope.

```sh
acm skill link ./my-skill --as development-skill
acm skill link ./my-skill --distribute --home --targets claude
acm skill unlink development-skill
acm skill update my-skill --targets codex
acm skill rename my-skill renamed-skill --targets claude,codex
acm skill validate ./my-skill
acm skill meta renamed-skill --pin --category coding --tags rust,cli
acm skill list --catalog --pinned --category coding
acm skill outdated renamed-skill
acm skill update renamed-skill --catalog
```

`skill update` compares each copy with the last successful deployment. Local edits and differing legacy copies without a baseline require `--force`; explicit `--copy`/`--link` do not bypass that protection. Replacing an existing copy retains a complete local backup, including permissions and supporting files. An unchanged legacy copy can establish a baseline without replacement. In catalog scope it refreshes recorded local/GitHub sources; forked skills require `--force`. Rename rejects collisions and retains locally edited copies, deployment baselines, and recovery history. `skill remove`/`disable` removes the provider placement; it does not delete a catalog entry unless catalog scope was selected. Inline skills should be imported before removal if they need to be restored later.

```sh
acm skill update my-skill --targets codex --dry-run
acm skill update my-skill --targets codex --force
acm skill backups my-skill --targets codex --json
acm skill restore my-skill BACKUP_ID --targets codex --dry-run
acm skill restore my-skill BACKUP_ID --targets codex
```

Recovery is scoped to the skill, project/home root, and exactly one restore target. A restore refuses newer destination edits unless forced and creates an `undoBackupId` for the displaced copy. It never follows a destination link. Baselines and backups stay under private `~/.acm/skill-state/`, outside published catalog assets; they are not general backups of every removal.

Skill add/import/install/update/enable/disable/remove/link/unlink/rename/restore accept `--dry-run`. Copy previews show added/modified/removed paths and conflicts without printing file contents or changing catalog, placements, or recovery state. GitHub install and catalog-refresh previews can download sources into temporary storage; dry-run is not an offline option. Unsupported combinations fail explicitly. See [workflow details](docs/native-workflows.md).

## Plugins

```sh
acm plugin scan
acm plugin discover --root ./downloaded-plugins
acm plugin import ./my-plugin --as my-plugin
acm plugin add ./plugin-development-repo
acm plugin list --json
acm plugin show my-plugin
acm plugin convert my-plugin --dry-run
acm plugin convert my-plugin --assemble-only
acm plugin install my-plugin --targets claude,codex
acm plugin update my-plugin --dry-run
acm plugin update my-plugin
acm plugin uninstall my-plugin --targets claude,codex --keep-skills
```

Import snapshots the entire plugin. Add links a development source. Assembly retains manifests, skills, commands, hooks, agents, and other files, restores skills extracted by older ACM versions, and writes each provider's manifest and MCP filenames. Provider-specific fields are carried through; each provider decides which fields it supports.

`convert` assembles and registers the local marketplace; `--assemble-only` builds without calling providers. `install` calls each selected provider's native installer. A failing or unavailable provider returns a nonzero exit status. Operations across providers are sequential: a successful earlier installation remains if a later provider fails, and its status is recorded.

```sh
acm plugin snapshot
acm plugin scan --diff
acm plugin discover --import
acm plugin repair                 # report missing payload files
acm plugin repair --apply         # restore only missing files
acm plugin doctor
acm plugin unlink my-plugin       # development links only, after uninstall
```

Updates locate moved application sources when recorded app provenance supports that match, and reject known version downgrades unless `--force` is supplied. A missing ordinary local source is an error; explicitly rebind it with `plugin import /new/path --as my-plugin --force` rather than adopting another same-name source. With no IDs, `plugin update` checks the catalog. Catalog status records successful ACM-managed native installations; providers may require restarting an active session after installation.

```sh
acm plugin verify my-plugin --targets claude,codex --json
acm plugin verify my-plugin --targets claude,codex --reconcile
acm plugin list --verify --targets claude,codex --json
acm status --home --verify --targets claude,codex --json
acm plugin compatibility my-plugin --targets all
```

Verification queries native listings and separates ACM records from observed `installed`, `disabled`, `missing`, or `unknown` state. `--reconcile` adjusts ACM records only where the observation is unambiguous; it does not install or remove anything. Missing CLIs, failures, unsupported output, and ambiguous identities remain unknown and produce a nonzero result. Installation existence and enabled state are separate: `enabled: null` means the CLI did not expose it.

Compatibility reports explain carried capabilities per provider and accompany conversion previews. On 2026-09-05, isolated native lifecycle checks passed for a local skills-only plugin with Claude Code 2.1.261, Codex 0.149.0, Antigravity 1.1.27, and Grok 1.0.5. Claude/Codex exposed identity and enabled state; Grok did not expose enabled state, and Antigravity could not prove source identity from its listing. Hooks, MCP execution, authenticated app integrations, and arbitrary skill execution were not established by that test and remain unknown. See the [actual CLI validation record](openspec/changes/harden-native-workflows/live-provider-verification.md).

## Diagnostics and publication

```sh
acm doctor --offline --targets codex
acm doctor --strict --json
acm doctor --fix
acm scan --dry-run
acm scan
```

Doctor checks catalog/native parsing, broken links, configured commands, working directories, portability, and drift. Diagnostics operate locally; `--offline` remains a compatible explicit option. Errors fail; warnings fail with `--strict`. `--fix` removes dangling links and reports actual repairs. It never replaces malformed configuration with an empty file.

Create `<catalog>/PUBLIC.txt` with one allowlisted resource per line:

```text
skill/my-skill
mcp/example
plugin/my-plugin
```

```sh
acm catalog publish --dry-run
acm catalog publish --to ./public-catalog-checkout --commit
```

Publication stages into `dist-public`, checks for secrets and personal absolute paths, and preserves unrelated destination files. The destination must be a clean Git checkout. `--commit` creates a local commit; it does not push. Optional `<catalog>/publish/bundle` files are included after the same checks.

## Interactive use and development

Run `acm` or `acm init` in a terminal for the Ratatui interface. Resource entry points select their tab. Use Tab/1–4 to change tabs, arrows or Ctrl+N/P to navigate, `/` to search, `H` for home/project scope, and `q` to quit. Automation should use explicit commands with `--json`; `init` rejects nonterminal input. Provider `mcp list` and `skill list` JSON retain the status envelope (`servers`/`skills`, `projectRoot`, `totalCount`, `enabledCount`); catalog lists return arrays.

Argument/runtime errors with `--json` produce one JSON document and a nonzero exit status. Multi-target mutations include per-target `results`, retain completed changes, and identify `retryTargets`; multi-resource operations can also identify `retryResources`. Inspect nested details when part of an operation succeeded. `--verbose` adds version, scope, targets, and catalog context to stderr while keeping stdout parseable. TUI actions report failures and partial success, and external-editor failures are surfaced.

```sh
just check          # formatting, Clippy, Rust tests, package structure
just build          # target/release/acm
just dev --help
just test-smoke     # build, pack, extract, and exercise the npm launcher
```

Tests use isolated homes/catalogs and mock provider executables; they do not change developer provider settings. Rust is the sole application runtime. The small JavaScript files under `bin/` and `scripts/` only launch or package native binaries.

MIT licensed. See [LICENSE](LICENSE).
