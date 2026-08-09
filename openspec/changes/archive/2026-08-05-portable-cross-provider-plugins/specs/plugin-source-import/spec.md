## ADDED Requirements

### Requirement: Supported plugin sources
ACM SHALL discover plugin sources and native installation state for Claude Code, Codex, and Antigravity, and SHALL import an arbitrary local plugin path. ACM MUST NOT expose Gemini CLI as a supported provider. Discovery MUST distinguish source availability, ACM import state, native installation state, and enabled state.

#### Scenario: Discover supported native sources
- **WHEN** the user runs `acm plugin scan`
- **THEN** ACM reports discoverable Claude Code, Codex, and Antigravity plugins and their separately observed installation/enabled state without assuming a fixed marketplace name

#### Scenario: Reject Gemini provider reference
- **WHEN** the user supplies a Gemini-qualified plugin reference
- **THEN** ACM rejects it as an unsupported provider and identifies Antigravity as the supported replacement target

#### Scenario: Import arbitrary path
- **WHEN** the user imports a readable local plugin directory
- **THEN** ACM snapshots the complete eligible source into its local store and records local provenance

### Requirement: Origin-qualified identity
ACM SHALL assign every imported plugin an identity containing source provider, source identifier, and plugin name. Unqualified names MUST resolve only when exactly one candidate exists. Target naming collisions MUST fail unless the user explicitly supplies `--as` or `--replace`.

#### Scenario: Ambiguous short name
- **WHEN** two discovered plugins share a name and the user references only that name
- **THEN** ACM performs no mutation and lists the qualified candidates

#### Scenario: Target collision
- **WHEN** a target already contains the requested name and neither `--as` nor `--replace` is present
- **THEN** ACM blocks installation without inventing a renamed plugin

### Requirement: Isolated immutable local storage
ACM SHALL store normal plugin imports and generated artifacts below `~/.acm/local`, separate from `~/.acm/plugins` and all linked Catalog metadata. Source snapshots and rendered builds SHALL be immutable and addressed by content digest. State writes SHALL be versioned, locked, and atomic.

#### Scenario: Changed source with unchanged declared version
- **WHEN** an update imports different content carrying the same upstream version
- **THEN** ACM creates a new source digest and distinct generated native version without overwriting the previous snapshot or build

#### Scenario: Concurrent state writer
- **WHEN** another ACM process holds the plugin-state write lock
- **THEN** ACM waits or fails clearly without producing a partially written state file

#### Scenario: Normal import with linked Catalog
- **WHEN** `~/.acm/plugins` and metadata files are symbolic links into another Git repository and a plugin is imported
- **THEN** only `~/.acm/local` changes and the linked files and Catalog Git status remain unchanged

### Requirement: Complete and safe source preservation
ACM SHALL preserve plugin manifests, complete Skill directories, commands, agents, MCP files, hooks, scripts, assets, executable permissions, internal symbolic links, and unknown provider-specific files. ACM MUST NOT follow a symbolic link outside the imported root and SHALL exclude source `.git` metadata. Sensitive-file findings SHALL be included in the import report.

#### Scenario: Skill with supporting material
- **WHEN** an imported plugin Skill contains references, scripts, and assets beside `SKILL.md`
- **THEN** all eligible files remain associated with that plugin-owned Skill in the source snapshot

#### Scenario: Escaping symbolic link
- **WHEN** a source contains a symbolic link resolving outside the plugin root
- **THEN** ACM blocks the import without reading or copying the external target

#### Scenario: Sensitive candidate in non-interactive operation
- **WHEN** a non-interactive import or downstream promotion would retain a flagged credential, environment file, private key, or equivalent sensitive candidate without explicit permission
- **THEN** ACM fails and identifies the required explicit sensitivity acknowledgement

### Requirement: Read-only legacy reconstruction
ACM SHALL treat the existing `plugins-metadata.toml` and legacy plugin directories as read-only inputs. It MAY reconstruct entries in the new local state by reconciling legacy hints with discovered source and native state, but MUST label uncertainty and MUST NOT rewrite, delete, or silently relocate legacy content.

#### Scenario: Legacy registry reconciliation
- **WHEN** scan finds a legacy registry entry and corresponding source or native installation
- **THEN** ACM exposes a `legacy`-labeled reconstructed record in new local state while leaving the legacy registry byte-identical

#### Scenario: Stale legacy entry
- **WHEN** a legacy registry entry has no verifiable source or installation
- **THEN** ACM reports the stale or uncertain state without claiming the plugin is installed

