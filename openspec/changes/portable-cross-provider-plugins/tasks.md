## 1. Implementation Handoff and Safety Baseline

- [ ] 1.1 Confirm the repository Git workflow with the user, then create the agreed dedicated `feature/portable-plugin-management` branch/worktree without touching the existing untracked `.agents/` content.
- [ ] 1.2 Capture a pre-change `just check` result and add a test helper that creates a temporary HOME, provider config roots, and a separate temporary Git-backed Catalog with symlinked ACM paths.
- [ ] 1.3 Add filesystem guards so plugin tests and fake adapters fail if they attempt to access the real HOME, `~/.acm`, or the linked Catalog repository.
- [ ] 1.4 Record the locally verified provider CLI versions and fixture schemas used by tests; keep version/capability assumptions inside adapters rather than global conditionals.

## 2. Canonical Model and Local State (PR 1)

- [ ] 2.1 Define origin-qualified plugin IDs, source references, target names, scopes, lifecycle states, and exact/bridged/lossy/unsupported/blocking compatibility result types with unit tests.
- [ ] 2.2 Define the canonical manifest and full component inventory for skills, commands, agents, MCP servers, hooks, scripts, assets, and opaque provider content with serialization tests.
- [ ] 2.3 Implement filesystem-safe hashed storage keys, content digests, and deterministic ACM native-version generation with same-version/different-content tests.
- [ ] 2.4 Implement `~/.acm/local/plugins/<key>` immutable source/build/report paths without changing existing `~/.acm/plugins` or metadata paths.
- [ ] 2.5 Implement the versioned `plugin-state.toml` repository with process locking, temporary writes, atomic rename, and interrupted/concurrent writer tests.
- [ ] 2.6 Implement secure source snapshotting that preserves executable modes and internal symlinks, excludes `.git`, blocks escaping symlinks, and inventories sensitive candidates.
- [ ] 2.7 Implement read-only legacy registry reconciliation that labels uncertain/stale state and prove the legacy metadata file remains byte-identical.

## 3. Provider Discovery and Import (PR 1)

- [ ] 3.1 Refactor the existing plugin scanner behind provider source adapters and remove fixed official-marketplace assumptions from generic discovery logic.
- [ ] 3.2 Implement Claude discovery for manifests, marketplaces, installed plugin records, enabled settings, and user/project/local scopes using temporary fixtures.
- [ ] 3.3 Implement Codex discovery for marketplace snapshots, native installed cache/config state, and user scope without treating `.codex/.tmp` as an installed location.
- [ ] 3.4 Implement Antigravity discovery for shared `~/.gemini/config/plugins`, AGY CLI-managed state, `.agents/plugins`, root `plugin.json`, `mcp_config.json`, and `hooks.json`.
- [ ] 3.5 Remove Gemini as an accepted provider and add migration-oriented errors for obsolete Gemini-qualified references.
- [ ] 3.6 Implement local-path and qualified native-reference import plus unique short-name resolution and ambiguity diagnostics.
- [ ] 3.7 Update scan/list/show services to distinguish available, imported, installed, enabled, legacy, target, and scope state; cover mixed-state output in unit tests.

## 4. Canonical Parsing and Compatibility Planning (PR 2)

- [ ] 4.1 Implement Claude, Codex, Antigravity, and generic-local source parsers that account for every eligible source path and retain unknown content provenance.
- [ ] 4.2 Implement complete Skill-directory handling and command-to-Skill conversion with references/scripts/assets fixtures.
- [ ] 4.3 Implement known agent-frontmatter mapping and structured diagnostics for unknown or incompatible fields.
- [ ] 4.4 Implement scoped plugin-root reference transformation for structured executable fields and active instruction references, with tests proving example prose is not blindly rewritten.
- [ ] 4.5 Implement the canonical MCP transport model and render `.mcp.json` for Claude/Codex and `mcp_config.json` for Antigravity, including URL-field and secret-placeholder tests.
- [ ] 4.6 Implement compatibility aggregation and stable human/JSON plans, including explicit reasons and affected component paths.
- [ ] 4.7 Implement `plugin plan` and make `plugin install --dry-run` use the same planning service and result schema.
- [ ] 4.8 Enforce interactive lossy confirmation and non-interactive `--yes --allow-lossy` behavior while making blocking findings non-overridable.

## 5. Hook Conversion and Runtime Bridge (PR 2)

- [ ] 5.1 Define canonical hook events, explicit provider event/tool matcher maps, command handlers, timeout, input, and decision/output semantics with fixture matrices.
- [ ] 5.2 Render exact or bridged `PreToolUse`, `PostToolUse`, and `Stop` hooks for each documented compatible provider pair.
- [ ] 5.3 Implement the guarded Claude/Codex `SessionStart` to Antigravity first-`PreInvocation` bridge and classify it as bridged.
- [ ] 5.4 Report provider-only events, unproven Antigravity invocation mappings, unknown matchers, and non-command Claude handlers without wildcard broadening.
- [ ] 5.5 Generate a bundled Node.js 20 hook bridge that translates JSON stdin/stdout and exit decisions, preserves timeout, avoids added shell interpolation, and never logs event payloads/secrets.
- [ ] 5.6 Add bridge contract tests for every supported direction, timeout/exit behavior, malformed input, unsupported output semantics, and secret-free diagnostics.

## 6. Target Renderers and Validation (PR 2)

- [ ] 6.1 Implement deterministic Claude package and ACM-local marketplace rendering with complete manifest/component paths and generated versions.
- [ ] 6.2 Implement deterministic Codex `.codex-plugin/plugin.json` package and `.agents/plugins/marketplace.json` rendering without copying foreign manifests wholesale.
- [ ] 6.3 Implement deterministic Antigravity root `plugin.json`, `mcp_config.json`, and `hooks.json` rendering for AGY/workspace contracts.
- [ ] 6.4 Add internal schema validation for all rendered packages and fixture snapshots that fail on omitted source components.
- [ ] 6.5 Add adapter capability/version detection and native-validation execution; treat missing commands/capabilities or rejected builds as blocking with no cache-writing fallback.

## 7. Native Lifecycle and Transactions (PR 3)

- [ ] 7.1 Introduce an injectable command/config runner and fake provider CLIs that record arguments, stdout/stderr, exit status, and controlled failure points.
- [ ] 7.2 Implement Claude marketplace registration, validation, install, enable, disable, update, and uninstall with user and workspace-to-local scope mapping.
- [ ] 7.3 Implement Codex marketplace registration, validation/add/remove, and surgical per-plugin enable/disable TOML edits with unrelated-content preservation and backup tests.
- [ ] 7.4 Make Codex workspace scope a preflight-blocking incompatibility and test that no user-scope fallback or provider mutation occurs.
- [ ] 7.5 Implement AGY CLI user-scope validation/install/list/enable/disable/uninstall without directly writing its managed cache.
- [ ] 7.6 Implement Antigravity workspace installation at `.agents/plugins/<name>` plus ACM-marked `.git/info/exclude` entries, tracked-path blocking, and precise cleanup tests.
- [ ] 7.7 Implement explicit target collision behavior for default failure, `--as`, and restorable `--replace`; block replacement when prior state cannot be captured safely.
- [ ] 7.8 Implement all-target preflight followed by a persistent run journal and reverse-order best-effort compensation that never alters pre-existing unjournaled state.
- [ ] 7.9 Add multi-target integration tests for preflight failure, mid-install failure, incomplete rollback, and successful installation using only temporary HOME and fake CLIs.

## 8. CLI Integration and Update Semantics (PR 3)

- [ ] 8.1 Add `plugin import`, `plan`, `update`, `enable`, and `disable`; route existing install/uninstall/list/show through the new services.
- [ ] 8.2 Support install inputs as imported ID, qualified provider reference, or path, with the path/reference shortcut executing import and plan before mutation.
- [ ] 8.3 Add `--targets`/`-t` while preserving singular `--target`, plus `--scope`, `--as`, `--replace`, `--yes`, `--allow-lossy`, and `--allow-sensitive` validation.
- [ ] 8.4 Ensure install never refreshes an imported source implicitly and implement explicit update as re-import, rebuild, revalidate, and target-aware native update.
- [ ] 8.5 Update CLI help and error messages for qualified identities, state distinctions, blocking scopes, acknowledgements, and rollback results.

## 9. Catalog Promotion and Isolation (PR 4)

- [ ] 9.1 Implement `plugin catalog add` as the only plugin path that can write to the shared Catalog, reusing secure inventory and sensitivity findings.
- [ ] 9.2 Implement exact planned-diff presentation, interactive/non-interactive confirmation, and blocking checks for escaping links, sensitive files, absolute user paths, generated/dependency directories, and license uncertainty.
- [ ] 9.3 Detect a symlinked Catalog's Git repository and block overlapping dirty paths while preserving unrelated dirty files.
- [ ] 9.4 Write only the complete eligible plugin source and minimum required plugin metadata; assert no standalone Skill/MCP registration, `PUBLIC.txt` edit, Git staging, commit, push, branch, or remote mutation.
- [ ] 9.5 Add integration tests proving every normal plugin command leaves the temporary Catalog byte-identical/Git-clean relative to its baseline and promotion changes only expected working-tree paths.

## 10. Migration, Documentation, and Final Verification (PR 4)

- [ ] 10.1 Replace or retire tests that assert obsolete hard-coded install paths, and add regression tests for the original manifest-loss, whole-Skill-copy, Antigravity MCP filename, unused extra-path, and missing-hook defects.
- [ ] 10.2 Document the architecture, canonical identity, local store, lifecycle states, supported provider surfaces/scopes, compatibility classes, hook security model, and rollback limitations in English and Japanese README content.
- [ ] 10.3 Document legacy read-only reconstruction, Gemini removal, Antigravity migration, Catalog symlink safety, and explicit Catalog promotion operations.
- [ ] 10.4 Run targeted unit/integration suites after each implementation slice, then run `just check` from a temporary-HOME-safe environment and resolve all failures.
- [ ] 10.5 Perform read-only/dry-run smoke checks against locally available real CLIs without installing plugins or mutating the real HOME; record unavailable CLIs as skipped capability evidence.
- [ ] 10.6 Review the final diff against all four capability specs, verify no the real linked Catalog or existing `.agents/` content changed, and leave an implementation handoff noting completed tasks and deferred non-goals.
