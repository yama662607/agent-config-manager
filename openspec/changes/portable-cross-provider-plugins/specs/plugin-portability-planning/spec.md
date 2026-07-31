## ADDED Requirements

### Requirement: Canonical plugin representation
ACM SHALL normalize provider plugins into a canonical representation containing provenance, manifest metadata, complete component inventories, normalized executable configuration, and opaque inventory for unknown content. Plugin-owned skills and MCP servers MUST remain plugin-owned and MUST NOT be registered automatically as standalone Catalog entries.

#### Scenario: Import mixed-component plugin
- **WHEN** a plugin contains skills, commands, agents, MCP definitions, hooks, scripts, assets, and unknown provider files
- **THEN** the canonical representation accounts for every component or file and retains its source provenance

### Requirement: Compatibility classifications
ACM SHALL classify every requested target and component as `exact`, `bridged`, `lossy`, `unsupported`, or `blocking`, with a reason and affected paths or identifiers. `plugin plan` and `plugin install --dry-run` SHALL return equivalent findings in human-readable form and SHALL support stable machine-readable JSON.

#### Scenario: Exact conversion plan
- **WHEN** all source semantics have documented target equivalents
- **THEN** the plan classifies those components as exact and describes the structural transformations

#### Scenario: Lossy non-interactive plan
- **WHEN** installation has lossy or unsupported findings in a non-interactive session
- **THEN** installation proceeds only if the caller supplies normal confirmation intent and `--allow-lossy`

#### Scenario: Blocking finding
- **WHEN** a finding is blocking
- **THEN** ACM performs no provider mutation regardless of lossy acknowledgement flags

### Requirement: Skill, command, agent, and root-reference conversion
ACM SHALL render complete Skill directories, convert commands to Skills where the target lacks an equivalent command type, map only known agent metadata, and report unsupported metadata. ACM SHALL rewrite documented active plugin-root references between Claude `${CLAUDE_PLUGIN_ROOT}` and Codex `${PLUGIN_ROOT}` and SHALL use Antigravity relative references only when their runtime resolution is proven. It MUST NOT perform blind global text replacement.

#### Scenario: Render provider command as Skill
- **WHEN** the source contains a command and the target represents that capability as a Skill
- **THEN** ACM renders a complete target Skill and reports the conversion

#### Scenario: Root token in executable field
- **WHEN** a known source root token appears in an executable command or active instruction reference
- **THEN** ACM renders the documented target token or verified relative reference

#### Scenario: Root token in example prose
- **WHEN** a source document mentions a root token only as example text
- **THEN** ACM preserves that prose unless the structured parser identifies it as an active reference

### Requirement: MCP conversion
ACM SHALL normalize MCP stdio and remote transports, including command, arguments, environment placeholders, working directory, URL, and headers. Claude and Codex builds SHALL render `.mcp.json`; Antigravity builds SHALL render `mcp_config.json` using Antigravity field names. ACM MUST NOT resolve secret values into generated packages.

#### Scenario: Remote MCP to Antigravity
- **WHEN** a source remote MCP server has a URL and headers and is rendered for Antigravity
- **THEN** ACM emits `mcp_config.json` with the documented Antigravity URL field and preserved secret placeholders

#### Scenario: Stdio MCP with plugin root
- **WHEN** a stdio command references the source plugin root
- **THEN** ACM transforms the reference under the target root-reference rules and reports whether the result is exact or lossy

### Requirement: Hook canonicalization and bridging
ACM SHALL model hook source event, matcher, command handler, timeout, input contract, output/decision contract, and original metadata. The initial implementation SHALL support command handlers and SHALL bundle any generated runtime bridge within the target plugin using only Node.js 20 runtime facilities.

#### Scenario: Common tool hook
- **WHEN** a `PreToolUse` or `PostToolUse` command hook has a known target event, matcher, input, and decision mapping
- **THEN** ACM renders the target hook as exact or bridged and preserves its timeout

#### Scenario: Session start to Antigravity
- **WHEN** a Claude or Codex `SessionStart` hook is rendered for Antigravity and `PreInvocation` with `invocationNum == 0` preserves the required behavior
- **THEN** ACM generates the guard bridge and classifies the hook as bridged

#### Scenario: Unknown tool matcher
- **WHEN** a source hook matcher has no explicit target tool-name mapping
- **THEN** ACM does not broaden it to a wildcard and reports a lossy, unsupported, or blocking finding

#### Scenario: Unsupported handler type
- **WHEN** a source hook uses a non-command handler such as Claude `http`, `mcp_tool`, `prompt`, or `agent`
- **THEN** ACM preserves it in provenance and reports it as unsupported or lossy instead of emitting a misleading command hook

#### Scenario: Bridge execution
- **WHEN** a generated hook bridge receives target event JSON
- **THEN** it translates input, invokes the original command without adding shell interpolation, enforces timeout, translates supported output/exit decisions, and does not log the event payload or secrets

### Requirement: Deterministic rendering and native validation
ACM SHALL generate deterministic target packages and content-derived native versions. It SHALL validate each rendered package with internal schema checks and the installed provider's native validator or capability before installation. Missing required CLI capabilities SHALL be blocking and MUST NOT trigger a direct-cache fallback.

#### Scenario: Repeated render
- **WHEN** identical canonical input and adapter version are rendered twice for the same target
- **THEN** ACM produces the same build digest and package contents

#### Scenario: Native validation failure
- **WHEN** a provider validator rejects the generated package
- **THEN** ACM marks the target blocking, retains the diagnostic report, and performs no installation mutation

