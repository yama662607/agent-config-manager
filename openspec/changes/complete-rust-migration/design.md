## Context

The Rust implementation supplies a Ratatui interface and basic resource operations. The TypeScript implementation also supplies configurable catalog paths, migration, provenance, scanners, marketplace assembly, publishing, and richer diagnostics. These are compatibility obligations, not optional new features.

## Goals / Non-Goals

Goals: retain on-disk data and documented automation entry points; make all state mutations observable and reversible where advertised; test the code actually distributed.

Non-goals: changing users' real catalogs during development, inventing provider protocols, publishing registry releases without a separate release action.

## Decisions

1. Keep one Rust core shared by CLI and TUI. Port the TypeScript behavioral contract before deleting it. Retain a tiny JavaScript executable only to dispatch the packaged native binary for npm users.
2. Preserve TOML catalog schema 1.0 and camelCase metadata, including unknown fields. Resolve catalog paths from the environment, then the state config, then the historical default. Resolve project roots upward from native configs or Git markers.
3. Use locked read-modify-write transactions and atomic same-directory replacement for persistent state. Missing data is empty on read; malformed data fails without replacement. Legacy migration preserves backups.
4. Keep full native MCP objects when toggling and preserve unrelated fields on updates. Providers without a native disable bit use ACM-owned saved definitions so enable restores the exact target recipe. Claude user mutations use its CLI, with explicit errors if unavailable.
5. Assemble complete native plugins and delegate installation to provider CLIs. Preserve payload files and report unsupported components. Read existing TypeScript plugin metadata and extracted skill locations; track ACM-owned installations for updates/removal.
6. Use subprocess fixtures for configuration, provider CLI, and failure tests; never depend on the developer's actual home/catalog. Keep structural and behavioral checks for package entry points and release archives.

## Risks / Trade-offs

- Provider behavior changes → record supported surfaces and test delegation with fixtures; real installed-provider checks remain explicit integration checks.
- Legacy CLI breadth → maintain a command parity checklist and port the tested resource workflows before removing TypeScript.
- Native distribution differs across operating systems → build release artifacts in a platform matrix, exercise launcher selection locally, and make missing binaries fail with installation guidance.
- TUI and CLI can drift → route mutations through the same core and validate displayed state after operations.

## Migration Plan

Implement data/config safety, port resource workflows, restore command aliases, add regression fixtures, switch distribution and documentation, remove the old implementation, then run the complete quality gate and package smoke tests. Existing catalogs remain usable; legacy format conversion keeps an original backup. Rollback of application code uses the preceding release without deleting user data.
