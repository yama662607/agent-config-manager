## ADDED Requirements

### Requirement: Users can inspect MCP status for the current project by target
The CLI SHALL provide a current-project MCP status view that shows which MCP definitions are present for each supported agent target in the active project.

**Default (compact) output format:**
```
Project: /path/to/project
MCP Servers (3 total, 2 enabled):

┌─────────────────────────┬─────────┬───────────┬─────────┐
│ Name                    │ Enabled │ Targets   │ Source  │
├─────────────────────────┼─────────┼───────────┼─────────┤
│ github                  │ ✓       │ codex     │ catalog │
│ filesystem              │ ✓       │ claude    │ catalog │
│ custom-server           │ ✗       │ (none)    │ project │
└─────────────────────────┴─────────┴───────────┴─────────┘

Run `acm mcp <name>` for details, `acm mcp add` to add new servers.
```

**Verbose output format (`--verbose`):**
```
MCP Server: @modelcontextprotocol/server-github
  Status: ✓ Enabled
  Targets: codex, claude
  Source: catalog
  Recipe:
    Command: npx
    Args: ["-y", "@modelcontextprotocol/server-github"]
    Env: {}
  Added: 2026-03-12T10:00:00Z
```

#### Scenario: User runs the project MCP status command
- **WHEN** a user runs `acm mcp` or the equivalent explicit list command inside a managed project
- **THEN** the tool MUST display the project's MCP state grouped or filterable by supported target
- **AND** the output MUST show: name, enabled status, targets, and source (catalog vs inline)

#### Scenario: User runs status with --verbose flag
- **WHEN** a user runs `acm mcp --verbose`
- **THEN** the tool MUST display full configuration details for each MCP including recipe, args, and environment variables

### Requirement: Users can add MCP definitions to the current project through interactive and explicit commands
The CLI SHALL allow users to add MCP definitions to the current project either by selecting from the local catalog interactively or by passing a package identifier or catalog item explicitly.

#### Scenario: Interactive MCP initialization
- **WHEN** a user runs `acm mcp init` inside a managed project
- **THEN** the tool MUST allow the user to choose from locally available MCP definitions, choose one or more supported targets, and apply the result to native project config files

#### Scenario: Explicit MCP add with a package identifier
- **WHEN** a user runs `acm mcp add @modelcontextprotocol/server-github --targets codex,claude-code`
- **THEN** the tool MUST attach that MCP to the selected supported targets in the current project and MAY create a reusable catalog entry if one does not already exist

### Requirement: MCP mutations preserve unrelated native config content
Project MCP mutations SHALL change only the targeted MCP entries and MUST preserve unrelated user-managed content in each native config file.

#### Scenario: Project config contains unmanaged entries
- **WHEN** a user adds, removes, enables, or disables an MCP through `acm`
- **THEN** the tool MUST preserve unrelated native config keys and unrelated MCP entries in the same file

### Requirement: Users can enable, disable, and remove MCP assignments per target
The CLI SHALL support target-aware mutation of current-project MCP assignments after the initial add.

#### Scenario: User disables an MCP for one target only
- **WHEN** a user disables an MCP for a subset of supported targets
- **THEN** the tool MUST update only those targets and leave the MCP assignment unchanged for the others
