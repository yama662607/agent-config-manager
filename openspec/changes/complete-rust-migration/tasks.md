## 1. Compatibility foundation

- [x] 1.1 Record the legacy command and data compatibility inventory; verify against TypeScript help and integration tests.
- [x] 1.2 Restore catalog configuration, default targets, and project discovery; verify subprocess fixtures from nested directories and alternate catalogs.
- [x] 1.3 Add atomic locked persistence, legacy migrations, and metadata preservation; verify malformed, concurrent, and old-format fixtures.

## 2. Resource workflows

- [x] 2.1 Restore MCP catalog/project/home operations, reversible toggles, drift update/adopt, and local recipes; verify lifecycle and provider-delegation tests.
- [x] 2.2 Restore skill import/install/search/metadata/outdated/update and safe placement; verify full payload, provenance, rename, and symlink fixtures.
- [x] 2.3 Restore complete plugin import/discovery/assembly/native lifecycle/update/repair; verify payload preservation, legacy metadata, CLI delegation, and collision tests.
- [x] 2.4 Restore scanning, catalog publication, and comprehensive read-only diagnostics; verify isolated fixtures including rejected publication and invalid native configs.
- [x] 2.5 Complete scope aliases, command routing, JSON output, and shared TUI mutations; verify command inventory and TUI regressions.

## 3. Distribution and cutover

- [x] 3.1 Replace npm runtime with native launcher and align versions; verify packaged launcher and exit-code behavior.
- [x] 3.2 Add native CI/release packaging and Rust quality commands; verify local quality gate and distribution validation.
- [x] 3.3 Update English/Japanese usage, migration instructions, provider docs, and agent instructions; verify documented command examples against native help.
- [x] 3.4 Remove superseded TypeScript sources, tests, dependencies, and obsolete scripts; verify no runtime references remain and Cargo/npm packages contain the intended files.

## 4. Final verification

- [x] 4.1 Run complete native checks, migration/lifecycle regressions, package smoke tests, and OpenSpec validation; record results and remaining platform limitations.
- [x] 4.2 Review the complete diff and commit on the feature branch, preparing a reviewable PR when repository access is available.
