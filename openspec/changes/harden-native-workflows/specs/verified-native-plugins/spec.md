## Purpose

Expose native plugin installation evidence and provider portability boundaries so recorded state cannot be mistaken for confirmed runtime support.

## ADDED Requirements

### Requirement: Native plugin state can be verified and reconciled
Verification SHALL query selected providers and distinguish installed, disabled, missing and unknown states. Reconciliation SHALL change only ACM records supported by unambiguous evidence.

#### Scenario: Provider query fails
- **WHEN** the provider command fails or returns an unsupported representation
- **THEN** verification reports unknown, retains existing records and returns an actionable result

#### Scenario: External uninstall is confirmed
- **WHEN** a successful complete provider listing proves a recorded installation is missing and reconciliation is requested
- **THEN** only the matching ACM installation record is removed

### Requirement: Conversion reports capability compatibility
Plugin inspection and conversion previews SHALL identify carried capabilities and target-specific supported, unsupported or unknown compatibility with explanations.

#### Scenario: Plugin contains provider-specific app integration
- **WHEN** the target compatibility is not established
- **THEN** the report marks that capability unknown or unsupported and does not claim native activation succeeds
