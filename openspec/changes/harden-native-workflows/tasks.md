## 1. Reliable interfaces

- [x] 1.1 Fix TUI deletion/update/repair/editor failures and provider-aware editing; verify regression tests exercise failing operations and target selection.
- [x] 1.2 Implement safe verbose diagnostics and structured JSON argument/runtime failures; verify one-document stdout and redacted stderr.
- [x] 1.3 Add per-target outcomes and retry targets for resource mutations; verify partial-success fixtures retain earlier successful changes.

## 2. Review and recovery

- [x] 2.1 Add MCP mutation dry-run with redacted changes; verify no config/catalog/provider mutation and accurate plans.
- [x] 2.2 Add skill deployment/update previews and baseline-based local edit protection; verify conflict, legacy-copy, forced-update and no-write preview scenarios.
- [x] 2.3 Add scoped update backups and guarded restoration; verify complete payload, permissions, scope validation and concurrent replacement behavior.

## 3. Native plugin evidence

- [x] 3.1 Implement bounded provider installation verification and conservative record reconciliation; verify missing/disabled/unknown/ambiguous output fixtures.
- [x] 3.2 Add per-target plugin compatibility reports to inspection/conversion; verify preserved unsupported/unknown capability reporting.
- [x] 3.3 Exercise installed provider CLI contracts and harmless isolated lifecycle operations; record versions, results and any externally imposed limits.

## 4. Release readiness

- [x] 4.1 Update EN/JA help and usage documentation with new commands and recovery semantics; verify examples against native help.
- [x] 4.2 Obtain independent advanced agent reviews for data integrity and provider/automation behavior, and fix all actionable findings with regressions.
- [x] 4.3 Run just check, packaged smoke tests, strict OpenSpec validation and CI; record evidence and update the reviewable PR without publishing or merging.
