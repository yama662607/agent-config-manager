## Context

ACM already manages native configuration for three provider names (`claude`, `codex`, and `antigravity`), but the plugin path is materially less reliable than its Skill and MCP paths. The current scanner uses hard-coded marketplaces and legacy Antigravity paths. The installer copies directories directly to locations that are either source snapshots or unmanaged directories, emits incomplete manifests, scans Antigravity's `.mcp.json` while writing `mcp_config.json`, drops supporting Skill files on Catalog import, and does not model hooks. Existing tests assert those paths, so a green test suite does not establish native correctness.

The product intent is broader than wrapping native CLIs: a plugin authored for one provider must be importable, inspectable, converted for another provider where semantics permit, and installed without corrupting provider state. Native providers remain the authority for final validation and lifecycle state.

The supported initial providers are Claude Code, Codex, and Antigravity. Gemini CLI is deprecated for this project and is not a compatibility target. “Antigravity” has multiple surfaces; this design targets AGY CLI for user scope and `.agents/plugins` for workspace scope. The shared IDE/2.0 location at `~/.gemini/config/plugins` is a discovery source, not an install target in this change.

The current shared Catalog is especially sensitive. `~/.acm/plugins`, `plugins-metadata.toml`, and related paths can be symbolic links into the separate `~/.kanade/catalogs` Git repository. That repository can already contain unrelated changes, and its `PUBLIC.txt` controls separate publication behavior. Normal plugin workflows must not mutate it.

## Goals / Non-Goals

**Goals:**

- Preserve a plugin's complete source and provenance, then generate deterministic provider-specific builds.
- Make compatibility visible before mutation, distinguishing exact, bridged, lossy, unsupported, and blocking behavior.
- Convert skills, commands, agents, MCP servers, and command-based hooks, including hook input/output bridging where semantics can be preserved.
- Delegate provider installation state to native interfaces and keep ACM's state recoverable from source and native inspection.
- Support user and workspace intent without pretending unsupported Codex workspace semantics exist.
- Isolate local work from the Git-backed shared Catalog and provide a separately confirmed promotion path.
- Provide enough state, tests, and operational documentation for safe updates and rollback.

**Non-Goals:**

- Gemini CLI support or migration compatibility for Gemini-specific plugin state.
- Automatic extraction of plugin-owned skills or MCP servers into standalone ACM Catalog entries. A future explicit `plugin extract` design can add this.
- Silent semantic approximation, automatic collision renaming, or automatic source refresh.
- Direct writes to Claude, Codex, or AGY native cache/registry internals when a native interface exists.
- Automatic Git staging, commits, pushes, or modification of the Catalog's `PUBLIC.txt`.
- Universal conversion of provider-only hook handlers such as Claude `http`, `mcp_tool`, `prompt`, or `agent` handlers in the initial release.

## Decisions

### 1. Use source, canonical, build, and installation layers

The implementation will separate four concepts:

1. A **source adapter** discovers and imports a provider-native or local package.
2. A **canonical plugin model** records provenance, metadata, component inventories, normalized executable configuration, and opaque unknown content.
3. A **renderer** produces an immutable build for one target and a compatibility report.
4. A **lifecycle adapter** validates and installs that build using native provider behavior.

This avoids the current ambiguity in which one copied directory represents availability, installation, and enabled state at once. Direct pairwise converters were rejected because three providers already require six directional paths and would duplicate compatibility rules.

The canonical inventory includes manifest metadata; skills with their entire directories; commands; agents; MCP definitions; hooks; scripts; assets; and unrecognized provider-specific files. Unknown content is retained in the source and reported, never silently discarded.

### 2. Use origin-qualified identity and explicit target naming

Canonical identity is `source-provider/source-id/plugin-name`; a local import uses a stable local source identity derived from its canonical source path and content provenance. Human CLI references use provider-qualified syntax such as `claude:plugin@marketplace`, `codex:plugin@marketplace`, `antigravity:name`, or a path. An unqualified name resolves only when unique and otherwise produces candidates.

The target plugin name remains the source name unless `--as` is supplied. A same-name target collision fails by default. `--replace` explicitly authorizes replacement; ACM never invents suffixes. This keeps identity auditable and prevents accidental parallel copies.

### 3. Keep imports and builds in a new local store

Normal imports live outside the Catalog:

```text
~/.acm/local/
├── plugin-state.toml
└── plugins/<storage-key>/
    ├── source/<source-digest>/...
    ├── builds/<target>/<build-digest>/...
    └── reports/<build-digest>.json
```

`storage-key` is a filesystem-safe stable hash; the readable canonical identity remains in state. Source snapshots and generated builds are immutable by digest. Regeneration or update creates new digests instead of rewriting an installed build. A generated native version uses the sanitized source version plus an ACM content suffix; when no valid version exists it uses `0.0.0-acm.<short-hash>`. This ensures changed content never aliases an old native cache version.

`plugin-state.toml` uses a versioned schema and records origin, source reference, imported digest/version, generated build digests, compatibility results, installation target/scope/native identity/status, and timestamps. Writes use a process lock, temporary file, fsync where supported, and atomic rename. State never stores resolved secret values.

The existing linked `plugins-metadata.toml` remains read-only. Discovery can reconstruct legacy entries into new state and label them `legacy`; it does not rewrite, relocate, or delete unknown legacy files.

### 4. Copy sources defensively

Import preserves files, executable permissions, and internal symbolic links. It excludes `.git` metadata and does not follow links that escape the source root. Escaping links are a blocking import finding unless an explicit future policy handles them. Sensitive candidates—environment files, credentials, private keys, absolute user paths, caches, `node_modules`, build output, and unclear redistribution/license material—appear in the report. Non-interactive operations require `--allow-sensitive` where the operation would retain or publish a flagged file.

Tests always use a temporary HOME and temporary Catalog links. They must never scan or mutate the developer's actual `~/.acm` or `~/.kanade` trees.

### 5. Make compatibility a first-class plan

Every component result has one of:

- `exact`: equivalent target behavior with structural conversion only.
- `bridged`: ACM-generated runtime code preserves semantics across different contracts.
- `lossy`: installation can proceed only after an explicit acknowledgement because some behavior is dropped or narrowed.
- `unsupported`: an individual component cannot be converted but may be omitted under an explicit lossy decision.
- `blocking`: the requested installation cannot safely proceed, such as Codex workspace scope, missing native capability, ambiguous identity, or unsafe matcher broadening.

`plugin plan` and `plugin install --dry-run` provide equivalent human and JSON results. Interactive install asks for confirmation after showing lossy/unsupported findings. Non-interactive install requires both normal confirmation intent (`--yes`) and the specific `--allow-lossy` flag. Blocking findings cannot be overridden.

### 6. Apply explicit component conversion rules

**Skills and commands.** A Skill is copied as its complete directory, including references, scripts, and assets. Provider command files are represented separately in the canonical model and rendered as Skills on targets without the same command concept. Names and descriptions are retained when valid; unsupported metadata is reported.

**Agents.** Known frontmatter fields are mapped and sanitized per target. Unknown or semantically incompatible fields remain in provenance and are reported rather than passed through blindly.

**Plugin-root variables.** Known executable references translate between Claude `${CLAUDE_PLUGIN_ROOT}` and Codex `${PLUGIN_ROOT}`. For Antigravity, relative references are emitted only where the target contract makes them provably valid. Transformations are limited to structured executable fields and active instruction references; example prose is not globally replaced.

**MCP.** The canonical form models stdio command/arguments/environment/cwd and remote URL/headers. Claude and Codex render `.mcp.json`; Antigravity renders `mcp_config.json`, including its expected `serverUrl` naming. Root references are transformed under the preceding rule. Secret placeholders are retained; ACM does not resolve secrets into the generated package.

**Hooks.** The canonical form records source provider/event, matcher, command, timeout, input schema, output/decision semantics, and original handler metadata. The initial bridge supports command handlers. `PreToolUse`, `PostToolUse`, and `Stop` are exact or bridged where tool-name and decision mappings are known. Claude/Codex `SessionStart` may render to Antigravity `PreInvocation` guarded by `invocationNum == 0`, marked `bridged`. Provider-only events, Antigravity invocation events without a proven semantic peer, and non-command Claude handlers are unsupported or lossy rather than broadened.

Tool matcher conversion uses an explicit mapping table. An unknown matcher never becomes `*`; it is a blocking or lossy finding according to whether omission is allowed. The generated bridge is bundled JavaScript requiring only Node.js 20, placed inside the rendered plugin. It translates target JSON stdin to the source event, launches the original command without adding shell interpolation, enforces the declared timeout, and translates exit/stdout decisions to the target contract. It does not log payloads or secrets. Unsupported output semantics are surfaced in the plan.

Renderer capability is version-aware. If an installed CLI lacks a needed plugin or hook contract, the result is blocking. There is no fallback that manually writes native caches.

### 7. Use native provider lifecycle adapters

Provider behavior is isolated behind an injectable command runner so tests can assert commands without invoking real CLIs.

**Claude Code:** generate an ACM-owned local marketplace, register it using `claude plugin marketplace add`, validate with `claude plugin validate`, and use native install, enable, disable, uninstall, and update behavior with `user`, `project`, or `local` scope. ACM's `workspace` maps to Claude's local project scope because the selected product intent is machine-local workspace state.

**Codex:** generate an ACM-owned marketplace with `.agents/plugins/marketplace.json` and `.codex-plugin/plugin.json`, register/add/remove through `codex plugin marketplace` and `codex plugin` commands, and use `~/.codex/plugins/cache` only as observed state—not a write target. Enable/disable uses a surgical TOML update to `[plugins."<plugin>@<marketplace>"]` only when the installed CLI exposes no native equivalent, preserving unrelated formatting and values as far as the TOML editing strategy permits. Codex supports user scope only. A requested workspace scope is blocking and is not emulated.

**Antigravity:** use the AGY CLI (`agy plugin install/list/enable/disable/uninstall/validate`) for user scope and its managed `~/.gemini/antigravity-cli/plugins` state only as observed state. Workspace scope renders to `.agents/plugins/<name>` in the selected project. For a Git worktree, ACM adds only that exact generated path to `.git/info/exclude`, tagged with an ACM marker, so it remains local. Rollback removes only lines ACM added. Existing tracked paths block installation unless explicitly replaced. The shared `~/.gemini/config/plugins` surface is discovered but not mutated.

Native validators run against every generated package before installation. Missing CLIs, commands, validators, or required capabilities are blocking findings.

### 8. Stage the CLI workflow and preserve familiar entry points

The primary commands are:

```text
acm plugin scan
acm plugin import <provider-ref|path>
acm plugin plan <id> --targets <...> --scope <user|workspace> [--json]
acm plugin install <id|provider-ref|path> --targets <...> --scope <...>
acm plugin update <id>
acm plugin enable|disable <id> --target <...> --scope <...>
acm plugin uninstall <id> --target <...> --scope <...>
acm plugin catalog add <id>
acm plugin list
acm plugin show <id>
```

Existing singular `--target` remains a compatibility alias while `--targets`/`-t` is the standard multi-target form. Installing a path or provider reference performs import and plan as a shortcut. Update is always explicit and re-imports the source; install never refreshes it unexpectedly. List/show distinguish available, imported, installed, and enabled state and include origin, target, and scope.

### 9. Preflight all targets and journal mutations

A multi-target install first resolves identity, imports/renders, checks collisions, detects CLI capabilities, and validates every requested target. Only then does mutation begin. Each mutation records a compensating action in a run journal. On failure ACM executes compensations in reverse order and reports both the original error and any incomplete rollback.

Rollback only touches state changed in the current run. It never removes a pre-existing installation or restores it from guesses. For `--replace`, the adapter must be able to capture and restore sufficient prior native identity/state before replacement; otherwise replacement is blocking. The local immutable source/build can remain after a failed installation and is marked uninstalled.

### 10. Make Catalog promotion a separate trust boundary

`acm plugin catalog add <id>` is the only new operation allowed to write through `~/.acm/plugins` into the linked Catalog. It performs the sensitive-file and escaping-symlink checks, identifies license/redistribution uncertainty, shows the exact file diff, and asks for confirmation. Non-interactive use requires explicit confirmation and sensitivity flags.

The operation copies a complete source snapshot and writes only the minimum plugin metadata required by the existing Catalog convention. It does not alter standalone Skill/MCP entries, `PUBLIC.txt`, Git index, commits, remotes, or branches. A dirty Catalog is allowed only if the intended paths do not overlap; overlapping changes block promotion. Normal import, plan, install, update, enable, disable, uninstall, list, and scan must leave the Catalog byte-for-byte and Git-status unchanged.

### 11. Deliver in reviewable slices under one change

Implementation should begin in a dedicated `feature/portable-plugin-management` worktree because the change is large and crosses state, conversion, provider mutation, and tests. Before implementation, the next agent must confirm that branch/worktree workflow with the user if repository policy still requires an explicit choice. The recommended pull-request sequence is:

1. Canonical types, secure import/store, discovery, and legacy read-only reconstruction.
2. Compatibility planner, renderers, component conversions, and hook bridge.
3. Native lifecycle adapters, scopes, collision behavior, transaction journal, and CLI integration.
4. Catalog promotion, end-to-end isolation tests, migration documentation, and help/README updates.

Each slice stays part of this OpenSpec change and keeps incomplete commands hidden or explicitly experimental until their end-to-end contract is ready.

## Risks / Trade-offs

- [Provider schemas and commands evolve] → Detect CLI versions/capabilities, keep adapters isolated, validate generated packages natively, and fixture known versions.
- [Hook events look similar but differ semantically] → Use a small explicit mapping table, mark bridges, and refuse unknown matcher/output broadening.
- [Generated bridge executes untrusted plugin commands] → Preserve the source command boundary, avoid extra shell interpolation and payload logging, and document that installing a plugin grants its hooks execution authority.
- [Codex lacks workspace-scoped plugins and native enable/disable commands] → Report workspace as blocking and confine any config edit to the exact plugin table with backup/journal coverage.
- [Antigravity has overlapping IDE and CLI plugin surfaces] → Name the selected surface in reports and do not mutate the shared IDE location in this release.
- [Native CLI operations are not fully transactional] → Preflight first, journal every completed mutation, compensate in reverse order, and make incomplete rollback explicit.
- [Catalog is a symlink into a dirty external Git repository] → Never touch it during normal operations; promotion checks overlap and never performs Git operations.
- [Local store growth] → Content-address builds and deduplicate identical digests; garbage collection is intentionally deferred until retention semantics are designed.
- [Legacy metadata may be incomplete or inaccurate] → Treat it as a read-only hint, reconcile with discovered sources/native state, and label uncertainty rather than fabricating state.

## Migration Plan

1. Add the local state/store and discovery model without changing provider state; verify current sources can be represented and the legacy files remain byte-identical.
2. Add renderers and plans behind non-mutating commands; compare fixtures and native validation output.
3. Introduce native lifecycle operations target by target, with fake-CLI integration tests and rollback tests before enabling real mutation.
4. Route existing `plugin install/uninstall/list/show` entry points through the new service while retaining CLI aliases and explicit legacy labels.
5. Add Catalog promotion only after isolation tests prove every other command leaves the linked Catalog unchanged.
6. Remove Gemini-specific provider branches and update documentation once Antigravity tests cover both user and workspace behavior.

Rollback of a release disables the new command routing while retaining `~/.acm/local` as recoverable data. Provider installations are not automatically removed during software rollback; their native state remains authoritative and can be reconciled on the next scan.

## Open Questions

No product decision is intentionally left open for initial implementation. The following are deferred scope rather than blockers:

- Explicit extraction of plugin-owned skills or MCP servers into standalone Catalog entries.
- Garbage collection and retention policy for old source/build digests.
- Antigravity shared IDE/2.0 installation as a target distinct from AGY CLI.
- Additional hook event/handler bridges after verified provider contracts and version tests exist.
