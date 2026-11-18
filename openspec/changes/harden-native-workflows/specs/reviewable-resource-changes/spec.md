## Purpose

Make configuration changes inspectable before execution and preserve user-edited skill copies with scoped recovery after updates.

## ADDED Requirements

### Requirement: Mutations provide read-only previews
MCP and skill mutation previews SHALL identify affected targets, paths and changes without changing persistent state. Sensitive definition values MUST be redacted.

#### Scenario: Preview an MCP edit
- **WHEN** a user edits a definition with dry-run enabled
- **THEN** the output shows redacted before/after fields and target paths while config, catalog and provider processes remain unchanged

#### Scenario: Preview skill deployment
- **WHEN** a user previews a skill update
- **THEN** added, removed and changed files and any local edit conflicts are reported without creating history or baselines

### Requirement: Updates protect local skill edits
Skill copy updates SHALL detect destination edits relative to the last deployment and SHALL require explicit force for conflicting or unknown differing copies.

#### Scenario: Local copy was edited
- **WHEN** a copy has changed since deployment and update is requested without force
- **THEN** the copy remains intact and the operation reports a conflict

### Requirement: Skill updates are recoverable
Updates that replace an existing skill copy SHALL retain a complete local backup. Users SHALL be able to list and restore scoped backups, and restoration MUST refuse changes made since the recorded destination state unless forced.

#### Scenario: Restore a previous copy
- **WHEN** a user selects a backup matching the current skill, project and target
- **THEN** the previous payload is restored, displaced content remains recoverable and unrelated destinations are unchanged
