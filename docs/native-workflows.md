# Preview, recovery, and native verification

These commands use the Rust implementation in this checkout. Read-only list output
formats remain compatible; previews and verification add explicit inspection surfaces.

## Review a change

```sh
acm mcp edit example --args '["updated"]' --targets codex --dry-run --json
acm skill update my-skill --targets codex --dry-run --json
acm plugin convert my-plugin --targets all --dry-run
```

| Resource | Mutations accepting `--dry-run` |
| --- | --- |
| MCP | `add`, `edit`, `remove`, `enable`, `disable`, `update`, `adopt` |
| Skill | `add`, `import`, `install`, `update`, `enable`, `disable`, `remove`, `link`, `unlink`, `rename`, `restore` |
| Plugin | `convert`, `update` |
| Other | `scan`, `catalog publish` |

Unsupported command/scope combinations fail explicitly. A preview does not invoke
native installers or change catalog, provider, baseline, or backup files. Skill
installation and catalog-refresh previews can fetch GitHub content into temporary
directories to calculate a diff; they are not offline commands. Plugin update
previews inspect available source state without pulling a repository.

MCP changes identify target/config paths, changed fields, and redacted before/after
definitions. Skill-copy changes list added, modified, and removed relative paths,
including permission changes, without printing file content. A blocked conflict
must be resolved before execution; `--force` does not permit unsafe nested source
paths or restoration through links. State can change after a preview, so execution
rechecks relevant preconditions under locks.

## Protect and restore skill copies

Every successful copy placement records its deployed tree in machine-local state.
Updates compare the catalog source, current destination, and that baseline:

| Current copy | Normal update |
| --- | --- |
| Matches the baseline, catalog changed | Back up the current copy, then update |
| Matches the catalog | Leave files unchanged and establish/refresh the baseline |
| Edited since deployment | Report a conflict; require `--force` to replace |
| No baseline and differs from the catalog | Treat as an unknown legacy copy; require `--force` |

The same protection applies when `--copy` or `--link` is explicitly selected. Normal
links and Grok's catalog-directory registrations share their source rather than
maintaining independent copies. Direct `--no-catalog` copies still have baselines.

```sh
acm skill update my-skill --targets codex --force
acm skill backups my-skill --targets codex --json
acm skill restore my-skill BACKUP_ID --targets codex --dry-run
acm skill restore my-skill BACKUP_ID --targets codex
```

Use a real ID from `backups` in place of `BACKUP_ID`. Restore requires exactly one
target and the original project/home scope and skill name. It verifies the saved
payload and refuses newer destination changes unless forced. The displaced state
is itself saved, and the result includes `undoBackupId`; pass that ID to the same
restore command to undo the restoration. Restoring edited content does not falsely
mark those edits as an upstream deployment.

History retains complete copies, hidden files, empty directories, symlinks, and
permissions. Restore never follows a linked destination, and placement/restore
refuse linked provider-directory ancestors. Rename moves the selected deployments'
baseline/history to the new skill scope. An unrelated existing recovery scope is
treated as a collision. Removal is not a general automatic backup operation.

The hashed scope directories in `~/.acm/skill-state/` remain on this machine even
when `ACM_CATALOG_DIR` points elsewhere. On Unix their enclosing directories use
mode `0700`; baseline/manifests use private files while saved payload permissions
remain intact. They are outside allowlisted catalog publication. See
[state storage](state-directory-and-catalog.md).

## Observe actual native plugin state

```sh
acm plugin verify my-plugin --targets claude,codex --json
acm plugin verify my-plugin --targets claude,codex --reconcile --json
acm plugin list --verify --targets claude,codex --json
acm status --home --verify --targets claude,codex --json
acm plugin compatibility my-plugin --targets all
```

Omit plugin IDs to verify the catalog's plugins. Plain list/status uses ACM's
recorded installations; verification queries native CLIs. Observations distinguish
`installed`, `disabled`, `missing`, and `unknown`, separately exposing installation
and enabled state. `enabled: null` is not proof that a plugin is enabled.

`--reconcile` changes only ACM records backed by unambiguous observations. It never
installs, enables, disables, or uninstalls a provider plugin. A successful complete
list can confirm missing state; command failure, unsupported output, another
project's installation, or an ambiguous source cannot. Unknown results retain
records and return a nonzero status with the observations still available in JSON.

Native plugins default to home scope. Claude also supports project installations;
other project scopes are unsupported. A running provider session can require a
restart independently of successful installation. Automatic source relocation uses
recorded app provenance. A missing ordinary local source is not replaced by an
unrelated same-name plugin; bind its new location explicitly with
`plugin import /new/path --as my-plugin --force`.

The [2026-09-05 isolated CLI validation](../openspec/changes/harden-native-workflows/live-provider-verification.md)
exercised a local skills-only plugin on Claude Code 2.1.261, Codex 0.149.0,
Antigravity 1.1.27, and Grok 1.0.5. All four passed installation, listing, update,
and removal through ACM without touching normal provider settings. Claude/Codex
exposed identity and enabled state. Grok confirmed the matching local installation
but omitted enabled state. Antigravity's nonempty listing could not prove source
identity, so verification conservatively returned unknown.

Compatibility reports state the evidence per carried capability and are included
in conversion previews. The tested skills-only lifecycle is supported for those
versions; hooks, agents, commands, MCP execution, apps, and other unexercised
capabilities remain unknown. Preserving a component is not proof that it executes
correctly, and the report does not claim runtime compatibility with every version.

## Select provider executables

Executable resolution uses the matching environment override, then machine config,
then the ordinary PATH command:

| Target | Environment override | PATH command |
| --- | --- | --- |
| Claude | `ACM_CLAUDE_BIN` | `claude` |
| Codex | `ACM_CODEX_BIN` | `codex` |
| Antigravity | `ACM_ANTIGRAVITY_BIN` | `agy` |
| Grok | `ACM_GROK_BIN` | `grok` |

```toml
# ~/.acm/config.toml
[provider_commands]
codex = "/path/to/codex"
```

Use an executable path, not a shell command with embedded arguments. This affects
native plugin operations and Claude home MCP delegation. It does not rewrite PATH
or the executable inside an MCP recipe. Provider calls are noninteractive with
bounded output and duration. The default is 10 seconds for native plugin listing
and 120 seconds for other calls; `ACM_PROVIDER_TIMEOUT_MS` can select 10–120000 ms.

## Automation results

`--json` keeps stdout to one document, including argument errors and runtime
failures. Argument errors exit with status 2; operation failures exit with status
1. `--verbose` writes version/scope/target/catalog context to stderr. Known
credential-bearing definition fields and provider error values are redacted in
previews/errors; explicit normal resource inspection still returns its data.

Multi-target mutations report per-target `results`, retain completed changes, and
identify `retryTargets`. Multi-resource operations can include `retryResources` and
nested results. Inspect `detail` and any `completedOperations` when an operation
partially succeeds; a nonzero exit does not imply that no files changed. Retry only
the failed targets/resources after resolving the cause. These operations do not
provide a transaction spanning all provider CLIs.

The TUI uses the same resource functions. It reports failed and partially completed
actions, retains errors on refresh, chooses an applicable provider configuration
for editing, and checks external editor exit status. MCP editing uses a temporary recipe document and sends Claude home changes through
the native Claude CLI, preserving disabled state and checking for concurrent edits.
