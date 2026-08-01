## ADDED Requirements

### Requirement: Native lifecycle authority
ACM SHALL use documented provider interfaces for plugin validation, installation, update, enablement, disablement, and removal, and SHALL observe but not directly populate provider caches. All external commands SHALL run through an injectable adapter runner.

#### Scenario: Claude user installation
- **WHEN** a validated Claude build is installed at user scope
- **THEN** ACM registers its managed local marketplace as needed and invokes Claude's native plugin installation with the requested scope

#### Scenario: Codex installation
- **WHEN** a validated Codex build is installed
- **THEN** ACM registers its managed Codex marketplace and invokes native Codex plugin add behavior without writing `~/.codex/plugins/cache` directly

#### Scenario: Antigravity user installation
- **WHEN** a validated Antigravity build is installed at user scope
- **THEN** ACM invokes AGY CLI validation and installation and observes AGY-managed state

### Requirement: Scope semantics
ACM SHALL support `user` and `workspace` as user-facing scopes and SHALL map them only to provider semantics that preserve the requested intent. Claude workspace SHALL use native local project scope. Antigravity workspace SHALL use the project's `.agents/plugins`. Codex workspace SHALL be blocking.

#### Scenario: Codex workspace request
- **WHEN** the user requests a Codex workspace installation
- **THEN** ACM reports a blocking incompatibility and neither installs at user scope nor emulates repository scope

#### Scenario: Antigravity workspace in Git repository
- **WHEN** ACM installs an Antigravity plugin into `.agents/plugins/<name>` in a Git worktree
- **THEN** it adds only the generated path to `.git/info/exclude` with an ACM-owned marker and does not edit a tracked ignore file

#### Scenario: Existing tracked Antigravity path
- **WHEN** the intended Antigravity workspace path is already tracked or otherwise collides and replacement was not explicitly authorized
- **THEN** ACM blocks installation without changing the path or Git exclude data

### Requirement: Staged and shortcut workflows
ACM SHALL support explicit `import`, `plan`, and `install` stages and SHALL allow `install` to accept an imported identity, qualified provider reference, or local path. Installing a non-imported source SHALL perform import and plan before mutation. Source refresh SHALL occur only through explicit `plugin update` or re-import intent.

#### Scenario: Install local path shortcut
- **WHEN** the user installs a local path
- **THEN** ACM imports it, displays or evaluates its plan, obtains any required acknowledgement, and only then starts native installation

#### Scenario: Reinstall without update
- **WHEN** the upstream path changed after import and the user installs the existing imported identity without requesting update
- **THEN** ACM uses the recorded immutable source rather than silently refreshing it

### Requirement: Enable, disable, uninstall, and observation
ACM SHALL expose target- and scope-aware enable, disable, and uninstall operations and SHALL reconcile results with native observed state. Where an installed Codex version lacks native enable/disable commands, ACM MAY surgically edit only the exact plugin entry in `config.toml` while preserving unrelated configuration and journaling the prior value.

#### Scenario: Disable Codex plugin without native command
- **WHEN** the detected Codex CLI has no native disable command and the plugin is installed
- **THEN** ACM updates only that plugin's configuration entry, preserves unrelated TOML content, and records a reversible mutation

#### Scenario: Uninstall leaves imported source
- **WHEN** the user uninstalls a target installation
- **THEN** native installation state is removed but the immutable ACM import and builds remain available for inspection or reinstall

### Requirement: Multi-target preflight and rollback
ACM SHALL complete identity resolution, rendering, compatibility checks, collision checks, CLI capability detection, and native validation for every requested target before mutating any target. It SHALL journal each mutation and on failure attempt compensating actions in reverse order, touching only state changed by the current run.

#### Scenario: Later target fails preflight
- **WHEN** one of several requested targets fails validation or capability checks
- **THEN** no target is mutated

#### Scenario: Later target fails during mutation
- **WHEN** an earlier target was changed and a later target fails during installation
- **THEN** ACM attempts reverse-order rollback of current-run changes and reports both the original failure and any incomplete compensation

#### Scenario: Pre-existing installation during rollback
- **WHEN** rollback follows a failed multi-target operation and another installation existed before the run
- **THEN** ACM does not remove or alter that pre-existing installation unless its exact prior state was captured for an explicitly authorized replacement

### Requirement: CLI compatibility and state presentation
ACM SHALL preserve `plugin scan`, `list`, `show`, `install`, and `uninstall` entry points while adding `import`, `plan`, `update`, `enable`, `disable`, and `catalog add`. `--target` SHALL remain an alias and `--targets`/`-t` SHALL support multiple targets. List and show SHALL display source identity plus available, imported, installed, enabled, target, scope, and legacy status distinctly.

#### Scenario: List mixed state
- **WHEN** available, imported, installed, enabled, and legacy plugins coexist
- **THEN** `plugin list` presents those states without equating discovery with installation

#### Scenario: Singular target compatibility alias
- **WHEN** an existing caller supplies `--target claude`
- **THEN** ACM treats it as a one-element target selection under the new workflow

