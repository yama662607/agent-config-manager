## Purpose

Provide the same native agent configuration manager through every supported installation path while preserving existing user data and automation workflows.

## ADDED Requirements

### Requirement: All distribution paths run the native implementation
Cargo and npm installations SHALL execute the Rust CLI with the same version and command behavior. npm SHALL contain no alternate configuration-management implementation.

#### Scenario: User invokes the npm entry point
- **WHEN** a supported native binary is packaged and the user runs either npm executable name
- **THEN** the launcher MUST forward arguments, terminal input/output, and the native exit status without invoking TypeScript

### Requirement: Migration preserves existing workflows
The native CLI SHALL preserve supported project, home, catalog, import, update, diagnostics, and publication workflows. Mutations MUST report failure when requested state was not applied.

#### Scenario: User disables and re-enables a Claude MCP server
- **WHEN** a configured server is disabled and then enabled for Claude
- **THEN** its target-specific definition MUST be restored and a success exit MUST correspond to the restored state

### Requirement: Native quality checks cover distributed behavior
The standard quality gate SHALL build and test the Rust implementation and validate distribution metadata and launchers.

#### Scenario: Development quality gate succeeds
- **WHEN** the standard check command succeeds
- **THEN** native lifecycle, migration, and packaging regressions MUST have been checked
