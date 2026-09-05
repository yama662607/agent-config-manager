## MODIFIED Requirements

### Requirement: Catalog storage uses a stable file format
The catalog SHALL persist MCP recipes in TOML schema 1.0 and discover skill definitions from their directories. It MUST preserve existing camelCase metadata and unknown metadata fields. Catalog resolution SHALL use `ACM_CATALOG_DIR`, then `catalog_dir` in the ACM state config, then the historical state directory. Legacy JSON and YAML catalogs MUST remain importable with the original preserved during migration.

#### Scenario: User has configured a catalog outside the state directory
- **WHEN** the user installs the Rust version and reads their catalog
- **THEN** the configured catalog MUST be used without requiring the data to move

#### Scenario: Catalog file is corrupted or missing
- **WHEN** a read encounters a missing catalog
- **THEN** it MUST report an empty catalog without writing files
- **AND** a malformed existing catalog MUST produce an error without changing its bytes

### Requirement: Catalog operations are atomic and support concurrent access
Catalog mutations MUST serialize their read-modify-write transactions and atomically replace files, preserving unrelated entries.

#### Scenario: Concurrent catalog modifications
- **WHEN** two processes add different catalog entries simultaneously
- **THEN** both entries MUST be retained or a process MUST fail clearly before overwriting the other update
