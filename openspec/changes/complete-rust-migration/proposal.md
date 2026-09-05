## Why

The npm entry point still runs TypeScript while the standard checks exercise Rust. The Rust implementation also omits established catalog configuration, command workflows, and provider-specific lifecycle safeguards, so replacing the installed CLI currently changes behavior silently.

## What Changes

- Make Rust the only implementation of CLI, TUI, catalog, provider integration, and diagnostics.
- Preserve existing scopes, command aliases, catalog/metadata formats, configurable paths, and import/update/publish workflows.
- Restore reversible MCP enable/disable operations and delegate runtime-state changes to provider CLIs.
- Add migration, lifecycle, concurrency, packaging, and command-compatibility tests.
- Replace the npm TypeScript runtime with a dependency-free native-binary launcher, with reproducible release packaging and Cargo installation.
- Remove superseded TypeScript sources, tests, build dependencies, and development scripts once their supported behavior is covered in Rust.
- Update English/Japanese documentation, agent instructions, and quality commands to the completed architecture.

## Capabilities

### New Capabilities

- `rust-distribution`: One native implementation through Cargo and npm, with a consistent version, migration contract, and release verification.

### Modified Capabilities

- `local-catalog`: TOML storage with legacy JSON/YAML migration, configurable catalog paths, non-destructive reads, and locked updates.
- `cli-information-architecture`: Preserve current project/home/catalog scopes and the existing resource workflows through the native CLI.

## Impact

Rust sources and tests, legacy TypeScript implementation, npm packaging, Cargo configuration, CI/release workflows, README files, and project instructions. User catalogs and provider installations are exercised only in isolated fixtures during development; publishing releases is a separate external action.
