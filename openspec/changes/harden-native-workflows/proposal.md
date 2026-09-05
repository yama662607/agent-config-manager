## Why

The Rust migration exposes complete resource workflows, but failed TUI actions can appear successful, updates can overwrite local skill edits, and native installation records can drift from providers. Users and automation need reviewable changes, recoverable updates, and evidence of actual provider compatibility before release.

## What Changes

- Correct TUI failure handling and provider-aware editing; implement meaningful verbose diagnostics.
- Add read-only MCP and skill mutation previews with redacted content differences.
- Record skill deployment baselines, protect local edits, retain update backups, and expose conflict-aware restoration.
- Verify native plugin installation state through provider CLIs and optionally reconcile confirmed discrepancies.
- Report plugin portability per target without claiming unverified provider-specific features work.
- Return structured errors and per-target operation outcomes, including partial success and retry targets.
- Validate actual installed provider CLIs in isolated environments and obtain independent agent reviews.

## Capabilities

### New Capabilities

- `reviewable-resource-changes`: Mutation previews, skill edit protection, backups, and restoration.
- `verified-native-plugins`: Provider state verification, reconciliation, and portability reports.
- `reliable-agent-operations`: Accurate TUI feedback, structured errors, partial outcomes, and verbose diagnostics.

### Modified Capabilities

None. Existing resource commands remain available; the new capabilities add explicit safeguards and inspection surfaces.

## Impact

Rust CLI/TUI, skill placement persistence, MCP planning, plugin integration, isolated tests, and EN/JA documentation. Native provider settings are only changed by explicitly requested operations; automated verification uses isolated state. Registry publication and main-branch merging remain separate release actions.
