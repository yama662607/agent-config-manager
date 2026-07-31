## ADDED Requirements

### Requirement: Explicit Catalog promotion boundary
ACM SHALL write a local plugin into the shared plugin Catalog only through `acm plugin catalog add`. Import, plan, install, update, enable, disable, uninstall, scan, list, and show MUST NOT modify `~/.acm/plugins`, linked Catalog metadata, the Catalog Git index, `PUBLIC.txt`, commits, branches, or remotes.

#### Scenario: Normal lifecycle with symlinked Catalog
- **WHEN** all normal plugin lifecycle commands run while Catalog paths point to a separate Git repository
- **THEN** the Catalog files, Git status, index, `PUBLIC.txt`, and remotes remain unchanged

#### Scenario: Promotion invocation
- **WHEN** the user explicitly runs `acm plugin catalog add <id>`
- **THEN** ACM treats Catalog mutation as a separate confirmed operation and limits changes to the intended plugin and minimum required Catalog metadata paths

### Requirement: Promotion safety review
Before promotion, ACM SHALL scan for sensitive files, credentials, environment files, private keys, absolute user paths, escaping symbolic links, dependency/cache/build directories, and license or redistribution uncertainty. It SHALL show the exact planned file diff and require confirmation. An escaping symbolic link SHALL block promotion. Non-interactive promotion of sensitive findings SHALL require explicit sensitivity acknowledgement.

#### Scenario: Clean promotion
- **WHEN** a source passes safety checks and the user confirms the displayed diff
- **THEN** ACM copies the complete eligible plugin source and writes only its required Catalog metadata

#### Scenario: Sensitive promotion without acknowledgement
- **WHEN** a promoted plugin contains a sensitive candidate and a non-interactive caller has not supplied explicit sensitivity acknowledgement
- **THEN** ACM performs no Catalog writes and identifies the finding

#### Scenario: External symbolic link
- **WHEN** the source contains a symbolic link escaping the plugin root
- **THEN** promotion is blocked even if general lossy conversion was allowed

### Requirement: Preserve external Git ownership
ACM SHALL inspect overlap with existing Catalog worktree changes but MUST NOT stage, commit, push, switch branches, edit `PUBLIC.txt`, or clean unrelated changes. Existing unrelated dirty changes SHALL be preserved. Overlapping uncommitted changes SHALL block promotion.

#### Scenario: Unrelated dirty Catalog
- **WHEN** the Catalog repository contains uncommitted changes outside the promoted paths
- **THEN** ACM preserves them and may proceed after showing a diff limited to the promoted paths

#### Scenario: Overlapping dirty Catalog
- **WHEN** an intended promotion path already has uncommitted changes
- **THEN** ACM blocks promotion and reports the overlapping paths without modifying them

#### Scenario: Successful promotion
- **WHEN** promotion completes successfully
- **THEN** the intended working-tree files are present but ACM has not staged, committed, pushed, or changed publication allowlists

### Requirement: Catalog isolation tests
The implementation test suite SHALL model Catalog paths as symbolic links to a separate temporary Git repository and SHALL assert byte-level and Git-status isolation. Tests MUST use a temporary HOME and MUST NOT access the user's real ACM or the external tool Catalog state.

#### Scenario: Lifecycle isolation integration test
- **WHEN** the integration suite runs import, plan, install, update, and uninstall against fake provider CLIs
- **THEN** the temporary linked Catalog remains byte-identical and its Git status is unchanged

#### Scenario: Promotion integration test
- **WHEN** the integration suite confirms a promotion into the temporary Catalog
- **THEN** only the expected plugin paths differ and the index, history, remotes, and `PUBLIC.txt` remain unchanged
