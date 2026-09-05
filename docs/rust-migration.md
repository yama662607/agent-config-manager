# Rust migration: 1.3.0

The CLI, TUI, catalog operations, provider adapters, network skill imports, plugin lifecycle, diagnostics, scanning, and publication now share one Rust implementation. The former TypeScript application and its dependencies have been removed. npm remains a distribution channel through a small native executable launcher.

## Existing installations and data

Build with `cargo install --path . --locked` from this checkout, or use the native release package after it is published. Check `command -v acm` and `acm --version` if an older global installation takes precedence. The migration does not uninstall global executables or change provider settings merely by building this repository.

No manual catalog conversion is required. `catalog.toml` schema `1.0` is retained; initial Rust `1.0.0` catalogs are accepted. Legacy `catalog.json`, `catalog.yaml`, and `catalog.yml` are read and migrated on a subsequent catalog write, with `.bak` copies retained. Reads do not create or rewrite files. Skill indexes are derived from directories; legacy installation timestamps move into skill metadata.

`ACM_CATALOG_DIR` and `~/.acm/config.toml` retain their meanings. Unknown entry/metadata fields survive normal updates. Files malformed before migration are reported and remain untouched. Native configuration symlinks remain symlinks; unrelated TOML fields and comments are preserved.

Claude and Antigravity lack a general native disabled flag for these MCP configurations. ACM stores removed definitions under `~/.acm/disabled-mcps/`, keyed by canonical configuration path, so enable can restore the complete entry. Codex and Grok use native flags. Definitions lost by an older version can be restored only if a catalog recipe or another copy still exists.

## Commands and deliberate behavior

Scope aliases, `catalog mcp/skill`, local/from-package MCP recipes, metadata filters, full skill imports, provenance/outdated, plugin discovery/repair/snapshots, and allowlisted publication are supported. `--args` accepts JSON; repeated `--arg` is also supported. Provider MCP/skill JSON uses the legacy status envelope; catalog lists return arrays. Mutations produce one JSON object when `--json` is selected.

- `mcp adopt` requires exactly one source target. MCP updates retain disabled state.
- Skill imports reject collisions unless `--force` is supplied. Copy updates protect local edits and unknown differing legacy copies with machine-local deployment baselines; replacements retain scoped recovery copies. `skill backups`/`restore` provide guarded recovery and undo. Rename preserves edited copies, baselines, and history. Link/unlink never deletes the original source directory.
- Plugins are complete native packages. `convert` builds and registers a local marketplace; `--assemble-only` builds offline. `install` invokes native provider CLIs and records successful targets. Native plugin commands default to home. Catalog scope never invokes a native installer; catalog removal refuses plugins with recorded active installations. Claude supports project installation; unsupported native plugin project scopes fail explicitly.
- Plain plugin status records ACM-managed installs, including compatible legacy `installedFor` metadata. `plugin verify`, `plugin list --verify`, and `status --verify` query native state; `--reconcile` updates only ACM records backed by unambiguous observations. Unknown identity/enabled state is explicit. `plugin compatibility` reports evidence per carried capability. A running provider session may need restarting.
- Multiple provider mutations retain completed changes on failure and return target/resource results with retry targets. `--json` failures are one document; `--verbose` context goes to stderr. Repeat only failed targets/resources after addressing their errors.
- Doctor is local and read-only by default. `--offline` remains accepted. Fixes remove broken links; invalid files are never replaced with empty defaults.
- Publication requires an allowlist and rejects possible secrets/personal paths before copying to a destination. A destination Git checkout must be clean. Only previously published ACM assets are removed; unrelated repository files remain.

MCP and skill mutations support explicit read-only previews. Native CLI executable overrides handle installations outside PATH without silently guessing alternate executables. See [preview, recovery, verification, and automation details](native-workflows.md).

## Release preparation

```sh
just check
just test-smoke
cargo package --allow-dirty --no-verify
```

`just build` remaps build paths so published binaries do not embed the build user's home directory. Staging rejects a binary that still contains that path.

`just test-smoke` builds the host release binary, stages it under `native/<platform>/`, verifies its version/checksum, runs `npm pack`, extracts that archive, and invokes its launcher with an isolated home. It also verifies propagation of a failing native exit status. Host-only packages are useful for local verification and should not be published as the full release.

`.github/workflows/release.yml` builds six native platforms on their corresponding [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). Linux uses musl binaries. Each artifact includes a platform/version/target/checksum manifest. The packaging job requires all six, creates native archives plus the combined npm tarball, and writes `SHA256SUMS`.

The workflow only prepares downloadable artifacts. It does not publish to npm/crates.io or create a public GitHub release. After review, a maintainer can publish the combined tarball with `npm publish <tarball>` and upload the native archives. Use `workflow_dispatch` to build artifacts without a tag; version tags must match Cargo/npm versions.

Only macOS arm64 execution is verified locally in this migration. Linux, Windows, and macOS x64 builds and runtime packaging checks are covered by the release matrix when the PR/release workflow runs. Windows link placement requires permission to create directory symlinks; `--copy` avoids that requirement for standalone skill placements.

## Verification

The Rust suite exercises configuration precedence, nested project discovery, legacy formats, unknown fields, concurrent writes, malformed inputs, TOML comments, native config symlinks, reversible MCP state, provider delegation/failure, local recipes, complete skill payloads, metadata, rename collisions, GitHub provenance, Grok registration, native plugin assembly/install/remove/update, moved application sources and downgrade prevention, repair, publication refusal/dry-run, scans, and TUI interaction/rendering.

Subprocess tests use temporary homes and catalogs. Provider commands are replaced by test executables, so native state changes are observable without editing a developer's actual settings. Additional [isolated native validation on 2026-09-05](../openspec/changes/harden-native-workflows/live-provider-verification.md) exercised actual Claude Code 2.1.261, Codex 0.149.0, Antigravity 1.1.27, and Grok 1.0.5 with a local skills-only plugin. Their install/update/remove workflows passed through ACM. Listing limitations remain explicit: Grok omits enabled state and Antigravity cannot prove source ownership. Live registry availability, arbitrary plugin execution, and all provider versions are not established by those checks.
