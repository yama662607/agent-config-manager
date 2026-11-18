# Isolated native provider validation

Validated on macOS arm64, 2026-09-05, against the installed native executables.
The fixture contained one local plugin with a manifest and a single `SKILL.md`;
it had no hooks, executables, credentials, remote sources, or app integrations.

## Isolation

Each subprocess received an explicit temporary `HOME`, `USERPROFILE`,
`XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `XDG_DATA_HOME`, `TMPDIR`,
`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, and `GROK_HOME`. The environment contained no
inherited provider credentials. The working directory was a temporary project.
macOS `sandbox-exec` additionally denied all networking and all filesystem writes
outside the fixture, plus reads of normal provider configuration, Keychain, SSH,
and private mise settings. Only the installed executable directories were allowed
within the normal provider directories. No real provider configuration was changed.

## Results

| Provider | Version | Local install/list/remove | Additional evidence |
| --- | --- | --- | --- |
| Claude Code | 2.1.261 | Passed | User/project/local scopes; disable reflected in JSON |
| Codex | 0.149.0 | Passed | Local marketplace add, plugin add/remove with JSON |
| Antigravity CLI (`agy`) | 1.1.27 | Passed | Local-path install; disable accepted; enabled state absent from listing |
| Grok | 1.0.5 (5115b46bc909) | Passed | Local-path install with `--trust`; disable accepted; enabled state absent from listing |

Claude/Codex used a local marketplace and a qualified `name@marketplace` selector.
Grok used `plugin install <local-path> --trust` and `plugin uninstall <name> --confirm`.
Antigravity used `plugin install <local-path>` and `plugin uninstall <name>`.
All final listings were empty. This establishes actual native installation and
listing contracts for the fixture, not execution of arbitrary plugin components
or compatibility with every future provider version.

## Observed output contracts

Claude `plugin list --json` returns an array. Entries include `id`, `version`,
`scope`, `enabled`, `installPath`, timestamps, and (for project/local scopes)
`projectPath`. The list includes installations from other projects; those can have
`enabled: false`. Verification must match both scope and canonical project path,
not interpret another project's entry as disabled in the current project. A single
plugin ID can appear in multiple scopes.

Codex `plugin list --json` returns `{ "installed": [], "available": [] }`.
Installed entries include `pluginId`, `name`, `marketplaceName`, `installed`,
`enabled`, `source` (`source`/`path`), `marketplaceSource` (`sourceType`/`source`),
`version`, and policies. `plugin add/remove --json` are supported.

Grok `plugin list --json` returns an array with `status: "installed"`, `name`,
`repo_key`, `version`, `path`, `source`, and `marketplace`. Local-path installs have
`marketplace: null`. Output was identical before and after disabling the fixture.
Installation existence and enabled state must therefore be represented separately.
An unrelated same-name installation must not be adopted by name alone.

For both Grok and Antigravity, reinstalling after disable/uninstall retained the
disabled setting. An explicit `plugin enable <name>` cleared it. ACM therefore
performs native activation after installation, records pending activation if it
fails, and does not report a fully deployed digest until activation succeeds.
Claude's installer itself re-enables a disabled installation. Calling `enable`
again on an enabled Claude plugin returns exit 1 (`already enabled`), so ACM does
not redundantly enable Claude installations. This was verified by disabling and
reinstalling the fixture, then observing `enabled: true` in the native JSON list.

Antigravity `plugin list` (with or without `--json`) returns the exact text
`No imported plugins.` when empty, otherwise `{ "imports": [...] }`. Entries
contain `name`, `source: "antigravity"`, `importedAt`, and `components` such as
`["skills"]`. Output does not establish source-path ownership or enabled state.
Existing same-name entries are ambiguous unless independently tied to ACM's
managed deployment evidence; absence in a valid complete list is observable.

## Environment finding

The shell resolves `codex` to an inactive mise shim before the installed standalone
CLI. The prescribed environment doctor completed successfully for configured
runtimes. Validation invoked the observed standalone executable explicitly, without
changing user PATH or settings. ACM supports explicit per-provider executable
overrides so this can be selected deliberately; it does not guess alternate paths.

## ACM end-to-end validation

The newly built `target/debug/acm` (1.3.0) was also executed inside the same sandbox,
using a separate fixture catalog and the explicit `ACM_CLAUDE_BIN`,
`ACM_CODEX_BIN`, `ACM_ANTIGRAVITY_BIN`, and `ACM_GROK_BIN` executable overrides.

| ACM operation | Result |
| --- | --- |
| Import local fixture under an alias | Passed; complete local skill payload retained |
| Install into all four native providers | Passed |
| Install again into all four providers | Passed; native Grok update selected only after exact source ownership verification |
| Verify all four providers | Correct nonzero `verification_unknown`: Claude/Codex installed and enabled; Grok installed with enabled unknown; Antigravity name present but source identity unknown |
| Verify and reconcile Claude/Codex/Grok | Passed; current observation and historical recorded enabled state remain separate |
| Change an upstream fixture asset, then update all four | Passed; all four deployment digests updated |
| Remove from all four providers | Passed |
| Verify after removal | Passed; all four report confirmed missing |

The native Grok installer rejects an already installed local source. Its `plugin
update <name>` accepts the local symlink and confirms it is live. ACM now handles
the already-installed case by first querying native state and matching the exact
ACM source path; a same-name plugin from another source is never taken over.

The Antigravity unknown result is intentional: its successful native installation
is independently proven by the lifecycle commands, but its list output cannot
prove that a subsequently observed same-name plugin is still the same source.
ACM does not convert insufficient evidence into success or delete its record.

Regression validation passed for the six existing plugin tests and twelve added
verification tests, including timeout descendant termination, bounded output,
credential redaction, conflicting identities, partial deployment retries,
activation failure, read-only previews, and conservative reconciliation.

An additional isolated marketplace relocation test found that Codex rejects the
same marketplace name from a different local directory while retaining the old
source. Claude replaces the source; Grok indexes local marketplaces by directory
name. ACM accepts a duplicate-registration error only after `marketplace list
--json` proves the requested source is already registered. A different or ambiguous
source now stops installation instead of installing from the old marketplace and
recording the new payload's digest. This behavior has a dedicated regression.

## Limits

No model inference, remote MCP connections, authenticated app integrations,
interactive desktop refresh, registry publication, or remote repository operations
were performed. Skills-only native installation is verified for the listed versions.
Unexercised components remain unknown in compatibility reports.
