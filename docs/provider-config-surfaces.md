# Provider configuration surfaces

Where each agent keeps its MCP servers and skills, which of those places `acm` may
write to, and how it decides. Verified on 2026-08-02 against the CLIs installed on a
macOS machine; every claim below cites how it was checked. Native plugin contracts were revalidated on 2026-09-05; see the [isolated lifecycle record](../openspec/changes/harden-native-workflows/live-provider-verification.md) and [verification commands](native-workflows.md#observe-actual-native-plugin-state).

Providers change. The point of this document is not the paths — those go stale — but
the **rule for deciding how to write**, which does not.

---

## The rule

> **Delegate to the provider's own CLI when the target file also holds runtime state.
> Edit the file directly when it holds only configuration.**

A configuration file that an application merely reads at startup is safe to edit: the
worst case is that a running session uses stale values until restarted. A file the
application *writes back* — caches, tokens, counters, UI state — is not safe to edit,
because the application can overwrite the edit, or the edit can destroy state the
application never expected to lose.

This is the whole decision. Everything below is the evidence for applying it.

---

## MCP servers

| Provider | Scope | Location | Holds runtime state? | How `acm` writes |
|----------|-------|----------|----------------------|------------------|
| Claude Code | user | `~/.claude.json` → `mcpServers` | **Yes** (89 keys: caches, OAuth tokens, counters) | `claude mcp add-json -s user` |
| Claude Code | project | `<project>/.mcp.json` | No | Direct |
| Codex | user | `~/.codex/config.toml` → `[mcp_servers.*]` | No (21 keys, all settings) | Direct |
| Codex | project | `<project>/.codex/config.toml` — **only when the directory is trusted** | No | Direct |
| Antigravity | global | `~/.gemini/config/mcp_config.json` | No (1 key: `mcpServers`) | Direct |
| Antigravity | project | **does not exist** | — | — |
| Grok | user | `~/.grok/config.toml` → `[mcp_servers.*]` | No (4 keys, all settings) | Direct |
| Grok | project | `<project>/.grok/config.toml` | No | Direct |

### Project scope is not universal

Only Claude, Codex and Grok read a project-local MCP configuration, and Codex reads
its own only under a condition.

**Codex requires the directory to be trusted.** A project-local `.codex/config.toml`
is loaded but then disabled unless `~/.codex/config.toml` contains
`[projects."<absolute path>"] trust_level = "trusted"`. Codex's TUI adds that entry
the first time it asks "Do you trust this folder?", so ordinary working repositories
satisfy it and fresh directories do not. Verified against the loader in
`codex-rs/config/src/loader/mod.rs` (the untrusted case reports "To load project-local
config, hooks, and exec policies, add … as a trusted project") and reproduced with an
isolated `CODEX_HOME`: the same `[mcp_servers.scopeprobe]` entry is absent from
`codex mcp list` before the trust entry exists and present after.

`codex mcp add` always writes the user file, so a project entry has to be written
directly.

**Antigravity has no project scope for MCP.** Its own documentation lists only the
global file and plugin files, and a probe placing an `mcp_config.json` at six
plausible project locations launched none of them: no process started, no
`~/.gemini/antigravity-cli/mcp/<name>/` state directory appeared, and deliberately
malformed JSON produced no parse error — the file is never opened. The IDE writes to
the same global file (`~/.gemini/antigravity/mcp_config.json` is a symlink to it), so
there is no separate desktop surface either.

### Claude Code is the exception

`~/.claude.json` is not a configuration file that happens to contain MCP servers. It
is Claude Code's live state: startup counts, cached feature flags, announcement
impressions, OAuth tokens, per-project history. Editing it behind a running session
risks losing any of that.

The provider offers a supported interface, so `acm` uses it:

```bash
claude mcp add-json <name> '<json>' -s user
claude mcp remove <name> -s user
```

`add-json` takes the server definition as JSON, so nothing is lost in translation.

**`~/.mcp.json` is not the user scope.** It is a *project* file that happens to sit in
the home directory, so Claude reads it only when the home directory is the project
root. Verified: `claude mcp list` run from `/tmp` shows none of its servers, while the
same command run from `~` shows all of them, and Claude itself reports a server
defined in both `~/.mcp.json` and `~/.claude.json` as "defined in multiple scopes
(user, project)".

### Field names differ

| Provider | stdio | remote |
|----------|-------|--------|
| Claude | `command`, `args`, `env` | `type: "http"`, `url` |
| Codex | `command`, `args`, `env` | `url` (**not** `httpUrl`) |
| Antigravity | `command`, `args`, `env` | `serverUrl` |
| Grok | `command`, `args`, `env` | `url`, `headers` |

Codex additionally supports `enabled = false`, which is how `acm` disables a server
there; providers without such a field are disabled by removal.

---

## Skills

| Provider | Global location | Project location |
|----------|-----------------|------------------|
| Claude Code | `~/.claude/skills/<name>/` | `<project>/.claude/skills/` |
| Codex | `~/.codex/skills/<name>/` | `<project>/.codex/skills/` |
| Antigravity | `~/.gemini/config/skills/<name>/` | **not read by the CLI** (see below) |
| Grok | registered path, not a copy | `<project>/.grok/skills/` |

Skills are directories, so `acm` links or copies them; no provider CLI is involved and
none holds runtime state. Two provider-specific notes:

**Antigravity's global root is not `~/.agents/`.** Its customization root is `.agents/`
inside a project but `~/.gemini/config/` globally, so skills placed in `~/.agents/skills`
are never read. Verified by asking the CLI directly: `agy --print "list the available
skills"` returned 16 entries before a skill was linked into `~/.gemini/config/skills`
and 24 after, with the newly linked ones present.

**Antigravity's CLI does not read project skills either.** Its documentation states
that a skill lives in a `skills/` folder inside a customization root, giving
`.agents/skills/` as the example, but a real git repository holding eight skills under
`.agents/skills/` produced none of them in `agy --print "list the available skills"`.
Two independent probes agree. Whether the Antigravity IDE behaves differently is
**unverified**; treat project-scope skills for this provider as unsupported until
someone confirms otherwise.

**Grok reads other providers' skill directories.** It scans `~/.claude/skills` and
`~/.cursor/skills` by default, so copying a skill into `~/.grok/skills` would duplicate
whatever is already installed for Claude. Instead `acm` registers the catalog itself
under `[skills] paths` in `~/.grok/config.toml`, and disables individual skills through
`[skills] disabled`. Source: `~/.grok/docs/user-guide/08-skills.md`, bundled with the
CLI.

---

## Plugins

All four providers agree on what a plugin *is* — a directory holding any of
`skills/`, `commands/`, `agents/`, `hooks/hooks.json` and `.mcp.json` — and disagree
only on where its manifest sits.

| Provider | Manifest location | Marketplace index |
|----------|-------------------|-------------------|
| Claude Code | `.claude-plugin/plugin.json` | `.claude-plugin/marketplace.json` |
| Codex | `.codex-plugin/plugin.json` | `.agents/plugins/marketplace.json` |
| Antigravity | `plugin.json` at the root | none — installs from a path |
| Grok | `.grok-plugin/plugin.json`, or any of the above | `.grok-plugin/marketplace.json` |

### There is nothing to convert

Because the disagreement is only about filenames, writing the same manifest to all
four locations produces one directory every provider reads as its own. Verified
against an assembled copy of the `zoom` plugin:

```
claude plugin validate <dir>   → passes (warns that it ignores `apps`, `interface`)
grok plugin validate <dir>     → valid: 1 skill dir, 1 command dir, 1 agent dir
agy plugin validate <dir>      → 27 skills, 3 agents, 26 commands converted to skills
```

Each provider then applies its own handling. **Antigravity converts `commands/` into
skills by itself**, and Claude ignores fields it does not recognise rather than
failing. So `acm` writes every manifest and lets each provider decide, instead of
maintaining a translation per pair.

### One real difference: where a plugin's MCP servers are declared

Claude, Codex and Grok read them from `.mcp.json`. **Antigravity reads
`mcp_config.json`** and ignores the other name. Probed by running
`agy plugin validate` against each candidate:

| Candidate | `agy` reports |
|-----------|---------------|
| `.mcp.json` | `mcpServers: skipped (not found)` |
| `mcpServers` inlined in `plugin.json` | `mcpServers: skipped (not found)` |
| `mcpServers: "./.mcp.json"` in `plugin.json` | `mcpServers: skipped (not found)` |
| `mcp_config.json` | `mcpServers: 1 processed` |

So `acm` writes both names. This is the only content-level adaptation the
assembly performs.

### Installing still goes through the CLI

Placing a valid plugin directory in `~/.grok/plugins/` is not enough: `grok plugin
list` shows nothing until the plugin is installed, because an enabled plugin is state
the provider records. This is the rule at the top of this document, so `acm` publishes
the catalog as a local marketplace and delegates:

```bash
claude plugin marketplace add <dir> && claude plugin install <name>@acm-catalog
codex  plugin marketplace add <dir> && codex  plugin add     <name>@acm-catalog
grok   plugin marketplace add <dir> && grok   plugin install <dir>/plugins/<name> --trust
agy    plugin install <dir>/plugins/<name>
```

Antigravity has no marketplace command, so it is pointed at the same plugin
directories one at a time. Grok records the plugin by *path*, not by copying it, so
the generated marketplace has to live somewhere stable — `acm` puts it in the catalog.

Where a provider unpacks what it installed:

| Provider | Installed to |
|----------|--------------|
| Claude Code | `~/.claude/plugins/` |
| Codex | `~/.codex/plugins/cache/<marketplace>/<name>/<version>/` |
| Antigravity | `~/.gemini/config/plugins/<name>/` (copied) |
| Grok | referenced in place; `~/.grok/plugins/` is auto-trusted |

---

## Re-checking this document

Provider layouts change without notice, and three separate bugs in this project came
from assuming a path stayed correct. The checks below are cheap and worth repeating
whenever a provider updates.

**Does the provider still read where we write?** Ask it, from a directory that is not
the home directory:

```bash
claude mcp list          # from /tmp, so project files do not interfere
codex mcp list
grok mcp list
cd /tmp && agy --print "利用可能なスキルの名前だけを列挙してください。"
```

Run the same commands **from inside a project** to check project scope. A directory
that has never been opened by Codex is untrusted, so an empty temporary directory
tests trust rather than support — use a real repository, or add the trust entry first.

Asking an agent to list what it can see is a weaker probe than watching for the
process: a model may summarise, omit or hallucinate. When the answer matters, point
the server's `command` at a script that writes a marker file and check whether the
file appears.

If something `acm` configured is missing from that output, `acm` is writing to a place
the provider does not read.

**Did a field name change?** Compare what `acm` records with what the provider
launches:

```bash
acm mcp list --home --targets codex --json --verbose
```

`--verbose` emits scope, target, catalog, and version context to stderr. The JSON
contains the definitions ACM reads; compare those with the provider's own listing.
Verbose output does not itself prove that a server launched.

**Did the file gain runtime state?** Count its top-level keys. A configuration file
holds settings; if it starts holding caches, tokens or counters, direct editing is no
longer safe and the provider's CLI should take over.

---

## Why not delegate to every CLI

Delegating everywhere would be simpler to describe, but worse in practice:

- **It adds a dependency on each CLI being installed and on PATH.** `acm` can configure
  a provider that is not currently installed, which is useful when preparing a machine.
- **CLI flags change more often than file formats.** `~/.codex/config.toml` has held the
  same `[mcp_servers.<name>]` shape across versions; command-line options have not been
  as stable.
- **CLIs are slower.** Each call is a process launch; reading and writing a TOML file is
  not.

So delegation is reserved for the case that actually requires it: a file the provider
writes back.
