# Compatibility inventory

Baseline: TypeScript CLI/help and `test/integration`, alongside the existing Rust additions. Human-readable table decoration is not an API; scopes, accepted inputs, persisted data, JSON content, and exit status are.

Branch audit: fetched all remotes before continuing implementation. `main` and `origin/main` are `ed3e5ca`; the Rust rewrite (`5f86b0d`) and subsequent plugin changes are already merged. There are no commits outside `main` affecting Rust sources or Cargo configuration, and GitHub reports no open pull requests.

| Area | Workflows to retain |
| --- | --- |
| Scopes | project (default/`--project`), home (`-H`/`--home`/`--allow-home`), catalog (`-g`/`--catalog`/`--global`), legacy `catalog mcp/skill` |
| MCP | status/list/show, add/remove/edit, enable/disable, update/adopt; command/args/env/URL/local/from-package recipes; register/no-register; catalog search and metadata filters |
| Skills | status/list/show, add/remove, enable/disable, import/install/search, link/unlink/rename, update, meta/outdated; complete directories, copy/link modes, force, source metadata and filters |
| Plugins | scan/snapshot/diff, discover/import, add/link, list/show, install/uninstall/remove, convert, update, repair, doctor; full payload and native CLI installation |
| Diagnostics | validate/doctor, strict/offline/fix; parse errors, broken links, missing commands, unsupported scopes, catalog drift and portability |
| Catalog sharing | allowlist publication, private-content refusal, staging, destination sync, dry-run and optional local commit |
| Interactive | Ratatui navigation/search/preview/scope/target controls and mutation errors; init/resource entry points |
| Storage | catalog schema 1.0 (also read initial Rust 1.0.0), legacy JSON/YAML, metadata unknown fields, derived skill index, preserved addedAt, configurable catalog/default targets |
| Distribution | Cargo binary, npm executable aliases dispatching the same native binary; one version and Rust quality gate |

TypeScript's current standalone-directory behavior is retained. Native config/Git roots are additionally discovered from nested directories, matching the documented behavior. Home requires explicit selection.
