## Context

See proposal.md for the reported gaps. CLI commands and TUI share Rust resource functions. Catalog definitions are portable, whereas provider state and recovery data belong to the local machine. Existing tests use temporary homes and fake CLIs.

## Goals / Non-Goals

Goals: predictable MCP/skill updates, recoverable skill copies, truthful operation outcomes, explicit native verification and portable plugin reports. Preserve existing read output formats unless a new option is requested.

Non-goals: background synchronization, universal emulation of provider features, registry publishing, or altering normal user provider settings during tests.

## Decisions

1. Preview operations are read-only and never run a provider installer or initialize the catalog. MCP previews contain target/config location, action and redacted before/after definitions. Skill previews contain paths, file additions/removals/modifications and conflict reasons; upstream install/catalog-update previews may fetch into a temporary directory, which is explicitly documented and does not mutate the catalog. The CLI exposes `--dry-run` for supported mutations and rejects unsupported combinations explicitly.
2. Copy placements record a per-destination digest in machine state, alongside a copy of the last deployed content when needed for comparison. Updates compare catalog, current destination and baseline. User edits and unknown differing legacy copies are conflicts unless `--force`; no-conflict legacy copies can establish a baseline. Forced overwrites and ordinary updates retain complete pre-update copies in machine-local history. Restoration refuses newer destination edits unless forced and retains the displaced content. Links and Grok registrations have separate semantics and must not be dereferenced for destructive restoration.
3. `skill backups` and `skill restore` expose recovery scoped by project, target and skill. History cannot name arbitrary restore destinations. Concurrency locks cover inspection, backup, replacement and baseline update. Private history is excluded from public catalog distribution.
4. Plugin verification is opt-in (`plugin verify`, plus verified list/status option where appropriate). Provider output adapters report confirmed installed, disabled, missing or unknown. Command failures, ambiguous identities and unsupported output never become confirmed missing. `--reconcile` adjusts only ACM records supported by unambiguous observations. It neither installs nor uninstalls providers.
5. Plugin compatibility inspection reports each carried capability per target as supported, unsupported or unknown with reasons. CLI shape and preserved manifests do not prove runtime support. Conversion previews include the report; unsupported or unknown optional components remain visible without silently dropping payloads.
6. A shared operation report records resource, target, status, details, successes and retry targets. Mutations preserve completed targets on later failures and provide one JSON report with nonzero status. All CLI failures, including argument errors, use a structured envelope when `--json` is requested; diagnostics do not emit a second JSON document. Verbose context goes to stderr and never prints credentials.
7. TUI actions display failure and partial outcomes; editing selects an applicable configured target and avoids bypassing Claude home MCP delegation. External editor status is checked. Advanced reviews independently inspect data loss, concurrency, identity matching, credential exposure and false-success paths after implementation.

## Risks / Trade-offs

- Provider versions and output vary → bounded CLI calls, explicit unknown state, isolated live validation and version evidence.
- Historic copies lack a baseline → conservative conflict detection, explicit force and backups.
- Recovery files can contain private content → machine-local storage with restrictive permissions and validated destinations.
- Multiple native providers cannot be rolled back atomically → accurate partial results and retry only failed targets.

## Migration Plan

Existing catalogs remain readable. Baselines are created by successful placements; history is local-only. Document conservative updates for pre-existing differing copies. Validate the native build, packed launcher, isolated live provider lifecycle and all Rust tests before updating the existing migration PR.
