## ADDED Requirements

### Requirement: The tool provides read-only validation for native-config workflows
The CLI SHALL provide a read-only validation workflow that checks project discovery, catalog references, native config parseability, target compatibility, and blocking prerequisites without mutating files.

#### Scenario: Validation succeeds
- **WHEN** the active project can be discovered, referenced catalog items exist, native config files are parseable, and requested targets are supported
- **THEN** the validation workflow MUST exit successfully without modifying any files

#### Scenario: Validation finds a blocking problem
- **WHEN** validation detects a missing catalog item, invalid native config file, unsupported target operation, or missing blocking prerequisite
- **THEN** the validation workflow MUST exit with a non-zero status and report the blocking issue

### Requirement: The tool provides diagnostic status beyond structural validation
The CLI SHALL provide a diagnostic workflow for troubleshooting environment, path, and target support issues relevant to native-config management.

#### Scenario: Doctor reports project and target readiness
- **WHEN** a user runs the diagnostic command in or near a project
- **THEN** the tool MUST report project discovery results, resolved target paths, and relevant readiness issues for supported operations
