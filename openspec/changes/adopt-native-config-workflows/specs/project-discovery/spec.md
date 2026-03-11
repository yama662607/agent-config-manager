## ADDED Requirements

### Requirement: The tool can detect the active project from nested directories
The system SHALL detect the active project root when a user runs a project-scoped command from any directory inside that workspace.

#### Scenario: User runs a command from a nested subdirectory in a Git repository
- **WHEN** a user invokes a project-scoped command from a nested path inside a Git repository
- **THEN** the tool MUST resolve the repository root as the active project

#### Scenario: User runs a command outside a detectable project
- **WHEN** a user invokes a project-scoped command and no supported project root can be detected
- **THEN** the tool MUST fail with a clear error instead of mutating files in the current working directory implicitly

### Requirement: Project discovery resolves supported native config paths
Once a project is detected, the system SHALL resolve the native config file locations for each supported target relative to that project.

#### Scenario: Project supports multiple native targets
- **WHEN** the active project includes supported native config paths for multiple agent targets
- **THEN** the tool MUST resolve each target path independently and expose that information to status, mutation, and diagnostic commands
