## Purpose

Make CLI and TUI results reliable for users and automation by preserving operation failures, partial completion and explicit diagnostic context.

## ADDED Requirements

### Requirement: TUI feedback reflects operation results
TUI mutations and external editing SHALL report failures and MUST NOT display successful completion after a failed operation. Editing SHALL respect selected targets and provider configuration boundaries.

#### Scenario: Provider uninstall fails
- **WHEN** a TUI delete invokes a failing provider command
- **THEN** the failure is visible and the UI does not claim the plugin was removed

### Requirement: JSON failures and partial outcomes are structured
JSON mode SHALL return one machine-readable result for success or failure, including argument failures. Multi-target mutations SHALL expose completed and failed targets and a retry target list, returning nonzero on any failure.

#### Scenario: Second provider fails
- **WHEN** a first provider succeeds and a second fails
- **THEN** the output records both outcomes and identifies the failed target for retry without erasing the first success

### Requirement: Verbose mode provides safe diagnostic context
Verbose mode SHALL show operation scope, target and configuration context separately from machine-readable stdout without exposing sensitive values.

#### Scenario: JSON and verbose used together
- **WHEN** a command uses both flags
- **THEN** stdout remains a single JSON document and verbose context is written to stderr
