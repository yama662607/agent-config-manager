## Context

The current codebase is a small manifest renderer:

- `src/manifest.ts` loads a project-local YAML or JSON manifest
- `src/render.ts` renders Claude and Codex MCP config
- `src/cli.ts` exposes `init`, `render`, and `sync`

That is coherent, but it is the wrong center of gravity for the intended product. The user does not want a nonstandard project file such as `agent-config-sync.yaml` in repositories. They want:

- native agent config files inside the project to remain the project source of truth
- a reusable local library of MCP definitions available from any directory
- intuitive CLI workflows for viewing and mutating the current project's state
- no dependency on online search or registry lookup for normal operation

This change therefore reorients `acsync` from a manifest renderer into a **cross-agent config manager** with a user-level catalog and project-level native config editing.

**Key principle**: `acsync` directly edits native config files. There is no intermediate manifest and no "sync" operation.

## Goals / Non-Goals

**Goals:**

- Use native project config files as the source of truth for project state.
- Keep all `acsync`-specific persistent state outside the project, except generated files that are already native to supported agents.
- Support a reusable local catalog of MCP definitions that works offline. (Skills: Phase 2)
- Provide a coherent CLI where command scope is obvious:
  - `catalog` for reusable library items
  - `mcp` for current-project MCP assignments
  - `validate` and `doctor` for diagnostics
- Support interactive and non-interactive flows using the same mutation engine.
- Preserve unrelated user-managed content in native config files whenever possible.

**Non-Goals:**

- Adding a network-backed registry search flow in this change.
- Designing a full-screen TUI or GUI installer.
- Supporting every agent target on day one.
- Maintaining the current manifest-first workflow as an equal long-term path.
- **Skill management in Phase 1**: Skills will be added in Phase 2 after MCP is stable.
- **`sync` command**: With no manifest, there is nothing to "sync". The tool directly edits native configs.

## Decisions

### 1. Native project config files become the only project-level source of truth

`acsync` will no longer require a project-local manifest. The current project's state is derived directly from agent-native files such as:

- `.mcp.json` for Claude Code
- `.codex/config.toml` for Codex
- `.gemini/settings.json` for Gemini CLI

Why:

- It avoids introducing a project file the user does not want.
- The files users inspect and commit are the same files the agents consume.
- Removing `acsync` later does not leave behind an orphaned project-specific configuration model.

Alternatives considered:

- Keep the project manifest and hide it better: still adds an unnatural file and duplicates state.
- Generate native files from a hidden project file: same duplication problem, less transparency.

### 2. `acsync` keeps a user-level local catalog for reusable definitions

Reusable MCP and skill definitions belong in an `acsync`-managed catalog outside projects. The catalog is stored in the user's home directory:

- **All platforms**: `~/.acsync/`
  - macOS: `/Users/username/.acsync/`
  - Linux: `/home/username/.acsync/`
  - Windows: `C:\Users\username\.acsync\`

Why:

- Short, memorable, and follows the same pattern as other CLI tools (`.npm`, `.yarn`, `.docker`, `.cargo`)
- Keeps project repositories free of `acsync`-specific files
- The catalog remains available from any working directory
- Makes it clear that this directory is owned by `acsync`

Alternatives considered:

- `~/Library/Application Support/agent-config-sync/`: macOS-native but longer and less CLI-conventional
- `~/.config/agent-config-sync/`: Linux XDG standard, but adds an extra directory level
- Project-local catalog: violates the user's preference against nonstandard project files.

### 3. Catalog and workspace are separate scopes with different command surfaces

The CLI will treat these as distinct scopes:

- `catalog <kind> ...` manages reusable items
- `<kind> ...` manages the current project's use of those items

Where `<kind>` is initially `mcp` or `skill`.

Why:

- The same verbs otherwise become ambiguous.
- Users explicitly want `acsync mcp` to mean "show this project's MCP state", not "show my global library".
- Scope-first naming keeps daily commands short while preserving precise catalog operations.

Alternatives considered:

- One flat action-first CLI like `acsync add mcp`: ambiguous between catalog and project.
- Put catalog under `mcp catalog ...`: workable, but less consistent once multiple resource types exist.

### 4. Project discovery is root-based and works from nested directories

`acsync` should discover the active workspace from any nested directory using this priority:

1. nearest ancestor that is a Git repository root
2. if no Git root is present, nearest ancestor containing any supported native agent config path
3. otherwise fail with a clear "not inside a managed project" error

Why:

- The user explicitly wants commands such as `acsync mcp init` to work from any subdirectory.
- Git roots are the most common and predictable workspace boundary.

Alternatives considered:

- Current directory only: too brittle.
- Search only for native config files: misses empty or partially initialized repositories.

### 5. MCP package names are the primary add path

The normal MCP add flow will accept package identifiers such as `@modelcontextprotocol/server-github` and normalize them into a stdio recipe, typically `npx -y <package>`.

Why:

- It removes unnecessary verbosity without requiring `acsync` to maintain a fragile short-name alias registry.
- It is close to how existing install tools already work.

Alternatives considered:

- Require explicit `--command --arg` every time: too verbose for the common case.
- Support bare semantic names like `github`: attractive, but requires an alias registry and ongoing curation.

### 6. `mcp add` is allowed to auto-register into the local catalog

For convenience, `acsync mcp add <package>` may create a catalog entry if the package is not already present, then attach it to the current project.

Why:

- It preserves the clean mental model while reducing friction.
- Most users think in terms of "I want this in my current project" rather than "first update my library".

Alternatives considered:

- Require `catalog mcp add` first every time: cleaner in theory, too much ceremony in practice.

### 7. (Phase 2) Skills are managed as generated native files with embedded provenance metadata

Unlike MCP entries, skills are file assets. To avoid project-side sidecar state, `acsync` will manage generated skill files directly in native target directories and embed lightweight provenance metadata inside the generated file content, such as an HTML comment header in `SKILL.md`.

**This decision is deferred to Phase 2.** Skills will be implemented after MCP is stable.

Why (for Phase 2):

- It avoids adding a separate project metadata file.
- It gives `acsync` enough information to identify managed skill files, update them, and show status.

Alternatives considered:

- Project-local state file to track installed skills: violates the user's preference.
- Pure directory scanning without metadata: too fragile once names or copied content diverge.

### 8. Interactive and non-interactive commands share one mutation engine

Commands like `acsync mcp init` will use prompts, but they must call the same core mutation logic as `add`, `remove`, `enable`, and `disable` with explicit flags.

Why:

- It keeps automation and interactive flows consistent.
- It reduces bugs caused by separate code paths.

Alternatives considered:

- Prompt-only flows: easy for demos, poor for scripting.
- Flag-only flows: scriptable, but unnecessarily difficult for discovery and daily use.

### 9. Diagnostics become native-config-aware instead of manifest-aware

`validate` and `doctor` will be read-only commands that understand project discovery, catalog references, native config parsing, supported targets, and missing prerequisites.

Why:

- With no project manifest, diagnostics need to focus on parseability, resolvability, and supported operations.
- Users still need a safe way to check the workspace before mutating it.

## Risks / Trade-offs

- [Direct editing may rewrite user-managed formatting] → Use tolerant parsers and preserve unrelated keys; scope mutations narrowly to managed sections or named entries.
- [Skill provenance metadata may feel intrusive] → Keep metadata minimal, machine-readable, and placed in a non-disruptive comment header.
- [Catalog and project state can drift conceptually] → Treat the catalog as reusable definitions only; never assume project state can be reconstructed solely from the catalog.
- [Target capabilities differ, especially for skills] → Explicitly model unsupported targets and fail clearly instead of silently ignoring requests.
- [Concurrent edits may corrupt native config files] → Use file locks and atomic write patterns (write to temp file, then rename) for all mutations.
- [Performance degradation with large projects] → Cache parsed configs, lazy-load catalog entries, and minimize file I/O operations.

## Non-Functional Requirements

### Performance
- Config file parsing and mutation should complete within 100ms for typical projects (< 20 MCP/skill entries)
- Catalog operations should complete within 50ms for < 100 entries
- Project discovery should complete within 200ms even from deeply nested directories

### Reliability
- All file mutations must be atomic: write to a temporary file, then rename over the target
- Concurrent mutations to the same file must be detected and fail gracefully with clear error messages
- Corrupted catalog entries must not crash the CLI; skip invalid entries with warnings

### Compatibility
- Preserve all user-managed content in native config files (comments, formatting, unrelated keys)
- Support partial failures: if one target mutation fails, report all failures before exiting
- Maintain backward compatibility with catalog schema using versioned storage

### Usability
- All commands must work from any subdirectory of a detected project
- Error messages must suggest remediation (e.g., "Run `acsync mcp init` first")
- Interactive prompts should support `--help` flag to show current options

## Open Questions — Resolved

### Q1: Should `acsync mcp` default to a compact table view, a verbose grouped view, or support both with flags?

**Answer:** Compact table view by default, with `--verbose` flag for detailed output.

Default (compact):
```
MCP Servers:
┌─────────────────────────┬─────────┬────────┐
│ Name                    │ Enabled │ Target │
├─────────────────────────┼─────────┼────────┤
│ @modelcontext/.../github│ ✓       │ codex  │
│ @modelcontext/.../filesystem│ ✗   │ claude │
└─────────────────────────┴─────────┴────────┘
```

With `--verbose`: Full configuration details including command, args, and environment.

### Q2: For `mcp add`, should auto-registration into the catalog happen by default or require an explicit `--register` flag?

**Answer:** Auto-register by default (more user-friendly). Use `--no-register` to skip catalog registration and add directly to project only.

### Q3: Should `doctor` include environment checks for optional external executables such as `npx`, or stay limited to config and path diagnostics?

**Answer:** Include environment checks for:
- `npx` / `npm` (required for stdio MCP servers)
- `node` (required for npx execution)

Doctor should report warnings (not errors) for missing optional tools, with installation hints.

## Migration Plan

Since there are no existing users of the manifest-based workflow:

1. **Remove manifest-based code** (clean slate):
   - Delete `src/manifest.ts`, `src/render.ts`
   - Remove `init`, `render`, `sync` commands from CLI

2. **Implement new architecture directly**:
   - Catalog storage (user-level config directory)
   - Project discovery (Git root → native config paths)
   - Native config adapters (read/mutate `.mcp.json`, `.codex/config.toml`, etc.)
   - New CLI surface (`catalog`, `mcp`, `validate`, `doctor`)
   - Note: `skill` commands will be added in Phase 2

3. **Test thoroughly**:
   - Unit tests for each adapter
   - Integration tests for project discovery
   - E2E tests for common workflows

No backward compatibility needed. This is a v1.0 release with the correct architecture from day one.
