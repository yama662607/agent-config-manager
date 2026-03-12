# local-catalog Specification

## Purpose
TBD - created by archiving change adopt-native-config-workflows. Update Purpose after archive.
## Requirements
### Requirement: The tool stores reusable MCP definitions in a user-level local catalog
The system SHALL maintain reusable MCP definitions in a user-level `acsync` catalog stored outside project repositories.

**Note**: Skills will be added in Phase 2. The catalog schema is designed to be extensible for future asset types.

#### Scenario: User lists catalog items from an arbitrary directory
- **WHEN** a user runs a catalog listing command from any directory
- **THEN** the tool MUST display reusable MCP definitions from the same user-level catalog

### Requirement: Catalog storage uses a stable file format
The catalog SHALL be stored as JSON files in the user's home directory with clear schema versioning.

**Catalog structure:**
```
~/.acsync/
├── catalog.json           # Main catalog index
├── catalog-schema.json    # Schema version and validation rules
└── catalog.lock           # File lock for concurrent access
```

**Path resolution:**
- macOS: `/Users/username/.acsync/`
- Linux: `/home/username/.acsync/`
- Windows: `C:\Users\username\.acsync\`

**catalog.json schema (Phase 1 - MCP only):**
```json
{
  "$schema": "./catalog-schema.json",
  "version": "1.0",
  "mcps": {
    "@modelcontextprotocol/server-github": {
      "id": "@modelcontextprotocol/server-github",
      "displayName": "GitHub",
      "description": "GitHub MCP server",
      "recipe": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": {}
      },
      "addedAt": "2026-03-12T10:00:00Z",
      "tags": ["git", "github"]
    }
  }
}
```

**Phase 2 extension**: The schema will be extended to include `skills` section for skill definitions.

#### Scenario: Catalog file is corrupted or missing
- **WHEN** the catalog file is corrupted or does not exist
- **THEN** the tool MUST initialize an empty catalog automatically instead of failing

### Requirement: Catalog items can be added, inspected, updated, and removed offline
The catalog management workflow SHALL support create, show, edit, and remove operations without requiring network access.

#### Scenario: User removes a catalog item
- **WHEN** a user removes a catalog item
- **THEN** the tool MUST delete the reusable definition from the local catalog without silently mutating any project state

### Requirement: MCP package identifiers can be normalized into reusable recipes
When a user registers an MCP package identifier, the system SHALL normalize it into a reusable MCP definition suitable for later project assignment.

#### Scenario: User adds an MCP package to the catalog
- **WHEN** a user runs a catalog MCP add command with a package identifier such as `@modelcontextprotocol/server-github`
- **THEN** the tool MUST record a normalized reusable definition that can later be attached to one or more projects

### Requirement: Catalog operations are atomic and support concurrent access
All catalog write operations MUST use file locking and atomic write patterns to prevent corruption.

#### Scenario: Concurrent catalog modifications
- **WHEN** two processes attempt to modify the catalog simultaneously
- **THEN** one MUST succeed and the other MUST fail gracefully with a clear error message

