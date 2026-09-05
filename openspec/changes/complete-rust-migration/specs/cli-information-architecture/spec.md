## MODIFIED Requirements

### Requirement: The CLI uses stable scope-based top-level commands
The native CLI SHALL expose `mcp`, `skill`, `plugin`, `scan`, `init`, `doctor`, and `validate`. Resource operations SHALL distinguish project scope, home scope (`-H`), and catalog scope (`-g`, `--catalog`, `--global`). Existing `catalog mcp`, `catalog skill`, and `catalog publish` forms MUST remain supported. Help MUST describe scopes and non-interactive equivalents, and conflicting scopes MUST fail before changing files.

#### Scenario: User inspects the top-level help output
- **WHEN** a user views CLI help
- **THEN** it MUST distinguish catalog operations from project and home assignments

#### Scenario: User runs an existing catalog command
- **WHEN** a user runs `acm skill list -g` or `acm catalog skill list`
- **THEN** both MUST read the same reusable catalog
