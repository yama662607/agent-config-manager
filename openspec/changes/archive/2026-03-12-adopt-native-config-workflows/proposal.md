## Why

`agent-config-manager` is currently built around a project-local manifest that renders generated agent config files. That model conflicts with the intended product direction: users do not want a nonstandard project file, and they want to manage MCPs and skills directly from the CLI while keeping the actual project source of truth in each agent's native config file.

**Key design principle: `acm` is a cross-agent config manager, not a renderer.**

The next change should therefore replace the manifest-first direction with a native-config management model: `acm` owns a reusable local catalog for MCPs and skills, discovers the current project from any subdirectory, and edits supported agent config files directly through a coherent CLI.

**Benefits of this approach:**
- No additional files in projects (git diff shows actual config changes)
- Easy to explain to existing users
- Project remains intact even if `acm` is removed
- Better coexistence with other tools

## What Changes

- **BREAKING** Replace the project-manifest-centered workflow with direct management of native agent config files inside the current project.
- Add a user-level local catalog for reusable MCP and skill definitions managed by `acm` and available from any directory.
- Add project discovery so `acm` can locate the current repository root and supported agent config files from nested working directories.
- Add a coherent CLI structure where `catalog` manages reusable definitions and `mcp` manages the current project's MCP assignments.
- Add direct MCP management for supported agent targets, including status, interactive initialization, add, remove, enable, and disable flows.
- Add validation and diagnostic workflows for native config mutation, catalog references, target support, and missing prerequisites.
- **Note**: Skill management is deferred to Phase 2. This release focuses on MCP as the first capability to stabilize.

## Capabilities

### New Capabilities
- `project-discovery`: Detect the active project root and supported native agent config files from any directory inside a workspace.
- `local-catalog`: Manage reusable MCP definitions in a user-level `acm` catalog without requiring network access.
- `workspace-mcp-management`: Inspect and mutate the current project's MCP assignments across supported agent targets using native config files as the source of truth.
- `native-config-diagnostics`: Validate native config mutations, catalog references, project support, and target prerequisites before or after changes.
- `cli-information-architecture`: Define the top-level command structure and stable command semantics for `catalog`, `mcp`, `validate`, and `doctor`.

### Deferred to Phase 2
- `workspace-skill-management`: Skill management will be added after MCP is stable.

## Impact

- Affected code: CLI command routing, config parsing and writing, project-root detection, catalog persistence, status rendering, diagnostics, and README/help content.
- Affected user workflows: `init`, `render`, and `sync` no longer remain the primary mental model; direct project mutation becomes the primary workflow.
- New user-facing storage: user-level catalog data for MCPs and skills, while project state remains in native config files such as `.mcp.json`, `.codex/config.toml`, and `.gemini/settings.json`.
