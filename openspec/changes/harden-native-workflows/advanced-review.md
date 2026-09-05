# Independent agent review

Date: 2026-09-05. Three agents implemented bounded areas, then reviewed code owned
by other agents or the main implementer. Findings were reproduced with isolated
CLI fixtures and checked again after correction. No normal provider settings were
used as test destinations.

| Independent reviewer | Review scope | Findings addressed | Regression evidence |
| --- | --- | --- | --- |
| TUI / reliability agent | Skill recovery and native plugin lifecycle | Forced Markdown replacement, rename history loss, recursive copy/circular link, restore preview type mismatch; untrusted same-name plugin source adoption; catalog remove/unlink racing installation and legacy installation guards | `skill_recovery_test`, `operation_test`, `plugin_source_identity_test`; isolated CLI rechecks |
| Skill recovery agent | MCP identity, previews, error handling | Transport comparison, ambiguous npm identity, sanitized aliases selecting another resource, missing disable preview, invalid batch preflight, successful updates lost after a later error, escaped environment values exposed by provider stderr | `operation_test`; isolation fixtures for mutation and no-write previews |
| Native provider agent | Skill CLI and structured automation | Link/Grok preview disagreement, ignored no-register placement, lost earlier resource/target results; dotted plugin lock names and malformed installation records | `skill_preview_test`, `operation_test`, `plugin_verification_test` |
| TUI / reliability agent and native provider agent | Native provider identity contracts | Marketplace duplicate errors could hide a different registered source; conservative identity handling and explicit conflicts | `plugin_verification_test`; actual native marketplace CLI probes |

The review also inspected provider output bounds and timeouts, descendant process
termination, scope matching, unknown enabled state, activation retries, metadata
preservation, and private backup scope/permissions. Implementation tests include
negative and partial-success cases, not only successful command execution.

The actual four-provider lifecycle and observed limitations are recorded in
[live-provider-verification.md](live-provider-verification.md). Final whole-project
checks and CI are recorded in [verification.md](verification.md).
