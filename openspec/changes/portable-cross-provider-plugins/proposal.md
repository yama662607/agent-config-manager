## Why

ACM's current plugin implementation copies partially adapted directories into hard-coded provider paths, conflating discoverable sources with installed and enabled state. It therefore cannot safely fulfill ACM's intended role: importing a plugin authored for one provider, reporting compatibility, converting all supported components—including hooks—and installing the result through each provider's native lifecycle.

Gemini CLI support is intentionally excluded. The supported initial targets are Claude Code, Codex, and Antigravity, with Antigravity replacing the former Gemini-facing behavior.

## What Changes

- Introduce an origin-qualified plugin identity and an ACM-managed local import/build store separate from the Git-linked shared Catalog.
- Discover plugins and native installation state dynamically from Claude Code, Codex, and Antigravity, plus arbitrary local paths, without assuming a fixed marketplace name.
- Normalize plugin manifests and components into a canonical intermediate representation that retains skills and their supporting files, commands, agents, MCP servers, hooks, scripts, assets, and unknown provider-specific content.
- Render provider-native plugin packages and compatibility reports. Convert commands to skills where needed, normalize MCP configuration, rewrite known plugin-root references, sanitize agent metadata, and bridge compatible hook event/input/output contracts.
- Add a staged `import -> plan -> install` workflow, with a shortcut that imports and plans a path or native reference during install. Lossy conversions require an explicit decision; blocking incompatibilities cannot be bypassed.
- Use provider-native validation and lifecycle operations rather than directly writing native cache/registry state. Support user and workspace scope where the provider supports it; Codex workspace installation is a blocking incompatibility.
- Add explicit update, enable, disable, uninstall, dry-run, collision handling, and best-effort rollback behavior across multiple targets.
- Preserve existing standalone Skill and MCP Catalog behavior. Plugin-owned skills and MCP definitions remain inside the plugin unless a future explicit extraction feature is designed.
- Add an explicit, safety-checked Catalog promotion operation. Normal plugin operations never mutate `~/.acm/plugins` or linked metadata, and ACM never commits, pushes, or changes the Catalog publication allowlist.
- Treat the existing linked `plugins-metadata.toml` registry as read-only legacy input and reconstruct new local state without rewriting it.
- **BREAKING**: remove Gemini as a plugin provider and reinterpret Antigravity behavior around its documented `plugin.json`, `mcp_config.json`, `hooks.json`, AGY CLI, and workspace plugin locations.

## Capabilities

### New Capabilities

- `plugin-source-import`: Provider discovery, qualified identity, secure source import, immutable local storage, and legacy-state reconstruction.
- `plugin-portability-planning`: Canonical component model, provider rendering, hook bridging, validation, and exact/bridged/lossy/unsupported/blocking compatibility plans.
- `native-plugin-lifecycle`: Native install/update/enable/disable/uninstall operations, scope and collision rules, multi-target preflight, and rollback.
- `plugin-catalog-promotion`: Explicit promotion of a local plugin to the symlinked Git-backed Catalog with safety scanning and diff confirmation.

### Modified Capabilities

None. Existing standalone Skill, MCP, discovery, diagnostics, and Catalog requirements remain unchanged; the new plugin capabilities integrate with them without changing their contracts.

## Impact

- Replaces the assumptions in `src/plugin-scanner.ts` and `src/cli-plugin.ts`; plugin CLI parsing, help text, and list/show output will expand.
- Adds provider source/render/lifecycle adapters, canonical plugin types, compatibility planning, generated hook bridges, local state locking, transactional journals, and source-safety checks.
- Adds state below `~/.acm/local/` while preserving the existing symlinked `~/.acm/plugins`, `plugins-metadata.toml`, and other Catalog files.
- Adds provider fixtures, fake CLI adapters, temporary-HOME integration tests, Catalog isolation tests, and legacy migration tests.
- Updates English and Japanese documentation. Implementation is expected to span several reviewable pull requests under this single OpenSpec change.
