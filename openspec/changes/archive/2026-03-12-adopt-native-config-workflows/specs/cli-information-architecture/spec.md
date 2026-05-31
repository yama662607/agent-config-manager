## ADDED Requirements

### Requirement: The CLI uses stable scope-based top-level commands
The CLI SHALL expose stable top-level commands whose scope is unambiguous: `catalog` for reusable local definitions, `mcp` and `skill` for current-project operations, and `validate` and `doctor` for read-only diagnostics.

**Complete CLI command tree:**
```
acm
├── catalog           # Manage reusable definitions (user-level)
│   ├── mcp
│   │   ├── list      # List all MCP entries in catalog
│   │   ├── show      # Show details of a specific MCP entry
│   │   ├── add       # Add a new MCP entry to catalog
│   │   ├── edit      # Edit an existing catalog entry
│   │   └── remove    # Remove an MCP entry from catalog
│   └── skill
│       ├── list      # List all skill entries in catalog
│       ├── show      # Show details of a specific skill entry
│       ├── add       # Add a new skill entry to catalog
│       ├── edit      # Edit an existing catalog entry
│       └── remove    # Remove a skill entry from catalog
├── mcp               # Manage MCPs for the current project
│   ├── status        # Show MCP status for current project (default command)
│   ├── init          # Interactive: select and add MCPs from catalog
│   ├── add           # Add an MCP to current project
│   │   └── --targets <list>   # Specify targets (e.g., codex,claude)
│   │   └── --[no-]register     # Auto-register to catalog (default: yes)
│   ├── remove        # Remove an MCP from current project
│   │   └── --targets <list>   # Specify targets (default: all)
│   ├── enable        # Enable a disabled MCP
│   │   └── --targets <list>   # Specify targets (default: all)
│   └── disable       # Disable an MCP (keep in config but disabled)
│       └── --targets <list>   # Specify targets (default: all)
├── skill             # Manage skills for the current project
│   ├── status        # Show skill status for current project (default command)
│   ├── init          # Interactive: select and add skills from catalog
│   ├── add           # Add a skill to current project
│   │   └── --targets <list>   # Specify targets
│   ├── remove        # Remove a skill from current project
│   │   └── --targets <list>   # Specify targets (default: all)
│   ├── enable        # Enable a disabled skill
│   │   └── --targets <list>   # Specify targets (default: all)
│   └── disable       # Disable a skill
│       └── --targets <list>   # Specify targets (default: all)
├── validate          # Validate current project configuration
│   └── --strict      # Fail on warnings as well as errors
├── doctor            # Run diagnostics and health checks
│   └── --fix         # Attempt to auto-fix issues
└── --version         # Show version information
```

**Top-level help output:**
```
acm - Agent configuration sync tool

USAGE:
  acm [COMMAND]

COMMANDS:
  catalog     Manage reusable MCP and skill definitions
  mcp         Manage MCP servers for the current project
  skill       Manage skills for the current project
  validate    Validate current project configuration
  doctor      Run diagnostics and health checks

OPTIONS:
  -h, --help    Show this help message
  -V, --version Show version information

EXAMPLES:
  acm mcp status              Show MCP status for current project
  acm mcp add github --targets codex   Add GitHub MCP to Codex
  acm catalog mcp list        List all MCPs in local catalog
```

#### Scenario: User inspects the top-level help output
- **WHEN** a user views CLI help
- **THEN** the command structure MUST make it clear which commands operate on the local catalog and which commands operate on the current project

### Requirement: Resource command verbs remain semantically consistent
Commands with the same verb SHALL keep the same meaning within their scope, so that catalog mutations do not have the same semantics as current-project mutations.

#### Scenario: Catalog and project add commands are both present
- **WHEN** a user compares `acm catalog mcp add` with `acm mcp add`
- **THEN** the help and behavior MUST distinguish reusable-definition registration from current-project assignment

### Requirement: Interactive mutations have explicit non-interactive equivalents
Every interactive mutation flow SHALL have an equivalent non-interactive command form suitable for scripting.

#### Scenario: User wants to automate an interactive flow
- **WHEN** a command such as `acm mcp init` or `acm skill init` offers an interactive selection flow
- **THEN** the CLI MUST also provide explicit arguments or subcommands that perform the same mutation without prompts
