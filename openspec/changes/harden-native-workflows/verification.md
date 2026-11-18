# Verification record

Local validation: macOS arm64, 2026-09-05.

- `just check`: passed, including formatting, all-target Clippy with warnings denied,
  all **87 Rust tests**, and npm package structure validation.
- `just test-smoke`: passed; built the release executable, packed and extracted the
  npm distribution, and invoked the actual native launcher and exit-code scenarios.
- `openspec validate harden-native-workflows --strict`: passed.
- `git diff --check` and `bash scripts/check-public-safe.sh`: passed.
- EN/JA documentation links and eight new command forms were checked against
  native help.
- Three agents implemented separate areas and independently reviewed each other's
  changes. Reproduced issues and regression coverage are recorded in
  [advanced-review.md](advanced-review.md).
- Real Claude, Codex, Antigravity, and Grok CLI install/reinstall/update/remove
  operations passed in a separate temporary HOME and macOS sandbox. See
  [live-provider-verification.md](live-provider-verification.md) for versions,
  isolation, verification observations, and capability limits.

The existing [PR #59 checks](https://github.com/yama662607/agent-config-manager/pull/59/checks)
are the authoritative CI record for the current branch head. Its workflows run
Linux quality checks and build macOS, Linux, and Windows on x64 and arm64, then
assemble and smoke-test the combined native package. The PR remains a reviewable
draft; neither merging nor registry publication is part of this implementation.
