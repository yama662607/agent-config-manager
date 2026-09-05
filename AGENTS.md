# Agent Configuration Guide

`agent-config-manager` manages native MCP configurations, skills, and plugins across Claude Code, Codex, Antigravity, and Grok.

## Implementation and layout

- Rust is the only application runtime. CLI: Clap; TUI: Ratatui/Crossterm.
- `src/cli/`: argument parsing and scope routing.
- `src/core/`: resource operations, discovery, publication, diagnostics.
- `src/adapters/`: provider configuration boundaries.
- `src/catalog/`, `src/storage.rs`, `src/paths.rs`: locked persistence and resolution.
- `tests/`: Rust regressions; subprocess fixtures isolate HOME and the catalog.
- `bin/acm.cjs`: dependency-free npm launcher. JavaScript under `scripts/` is packaging only.
- `openspec/`: behavior specifications and change records.

Use existing mise-managed runtimes and the project task runner. Keep secrets out of project files. Never read private SSH keys or `~/.config/mise/config.local.toml` without an explicit current-session request.

## Git workflow

Do not commit or push directly to `main`. Use a `feature/`, `fix/`, `docs/`, or `chore/` branch and a pull request. Before deleting an existing worktree, inspect its status and obtain approval if it has uncommitted work.

## Quality gate

Run `just check` after code changes and before committing. It checks Rust formatting, Clippy with warnings denied, all Rust tests, and package structure. Use `just fix` for formatting. Targeted commands include `just test`, `just test-unit`, and `just test-integration`; they accept Cargo test arguments.

Use `just build` for the release binary, `just dev --help` for the CLI, and `just test-smoke` after distribution changes. The smoke test packs, extracts, and executes the npm package without installing it globally. `npm run check` and `npm test` remain aliases for Rust checks.

Never test mutations against developer provider settings. Use fixture HOME/USERPROFILE and ACM_CATALOG_DIR values on child commands. Fake provider executables exercise CLI delegation; Python is used only by these test fixtures.

## Behavioral boundaries

- Keep catalog definitions separate from provider runtime state.
- Preserve unknown metadata, unrelated config keys, comments, and symlinks.
- Use locked read-modify-write and prepare directory replacements before mutation.
- Reads must not initialize catalogs or silently repair malformed data.
- Claude user MCP changes must go through the Claude CLI. Native plugins must use provider installers; file placement alone is not activation.
- Report provider failures and unsupported scopes. Do not claim success after a failed subprocess.
- Keep complete skill/plugin payloads and source provenance.
- Registry publication and merging require explicit authorization; preparing packages and a draft PR are normal implementation work.
