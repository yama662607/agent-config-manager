## 1. Clean Slate Foundation

- [x] 1.1 Remove manifest-based code: delete `src/manifest.ts`, `src/render.ts`, and associated test files.
- [x] 1.2 Remove old CLI commands: delete `init`, `render`, `sync` from `src/cli.ts`.
- [x] 1.3 Introduce shared data models for project discovery, catalog items, native target adapters, and workspace status.
- [x] 1.4 Add baseline test infrastructure for the new architecture (project discovery, config parsing, catalog storage).

## 2. Project Discovery and Catalog Storage

- [x] 2.1 Implement project root discovery from nested directories using the agreed root-detection order and add tests for Git-root, native-config-root, and failure cases.
- [x] 2.2 Implement user-level catalog storage in OS-appropriate config directories for MCP definitions.
- [x] 2.3 Add catalog CRUD operations and tests for list, show, add, edit, and remove for MCP entries.

## 3. CLI Information Architecture

- [x] 3.1 Replace the current top-level CLI surface with the new scope-based command tree for `catalog`, `mcp`, `validate`, and `doctor`. (Note: `skill` will be added in Phase 2)
- [x] 3.2 Implement help text and command routing so catalog commands and current-project commands have unambiguous semantics.
- [x] 3.3 Add tests that verify top-level help, subcommand help, and non-interactive flag paths for the new command structure.

## 4. Native MCP Management

- [x] 4.1 Implement native config adapters for Claude Code, Codex, and Gemini CLI that can read, mutate, and preserve unrelated config content.
- [x] 4.2 Implement `acm mcp` status output for the current project with target-aware reporting.
- [x] 4.3 Implement `acm mcp init`, `add`, `remove`, `enable`, and `disable`, including package-name normalization and optional auto-registration into the catalog.
- [x] 4.4 Add tests covering direct MCP mutation, target-scoped enable/disable, unmanaged-content preservation, and nested-directory invocation.

## 5. Diagnostics and Safety

- [x] 5.1 Implement read-only validation for project discovery, catalog references, target support, and native config parseability.
- [x] 5.2 Implement `doctor` output for project root resolution, target path detection, and readiness diagnostics.
- [x] 5.3 Add tests for validation success, validation failures, doctor diagnostics, and read-only guarantees.

## 6. Documentation and Release Readiness

- [x] 6.1 Update README and package help examples to teach the new mental model: native project files plus user-level catalog.
- [x] 6.2 Document the complete CLI reference: `catalog`, `mcp`, `validate`, `doctor` commands with examples. (Note: `skill` will be added in Phase 2)
- [x] 6.3 Add end-to-end smoke tests for the primary flows: catalog registration, project MCP add, validation, and diagnostics.
- [x] 6.4 Run `openspec validate adopt-native-config-workflows --strict`, project checks, and smoke tests before implementation sign-off.
