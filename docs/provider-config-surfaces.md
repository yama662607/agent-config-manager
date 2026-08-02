# Provider configuration surfaces

Where each agent keeps its MCP servers and skills, which of those places `acm` may
write to, and how it decides. Verified on 2026-08-02 against the CLIs installed on a
macOS machine; every claim below cites how it was checked.

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
| Codex | project | `<project>/.codex/config.toml` | No | Direct |
| Antigravity | global | `~/.gemini/config/mcp_config.json` | No (1 key: `mcpServers`) | Direct |
| Antigravity | project | `<project>/.agents/mcp_config.json` | No | Direct |
| Grok | user | `~/.grok/config.toml` → `[mcp_servers.*]` | No (4 keys, all settings) | Direct |
| Grok | project | `<project>/.grok/config.toml` | No | Direct |

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
| Antigravity | `~/.gemini/config/skills/<name>/` | `<project>/.agents/skills/` |
| Grok | registered path, not a copy | `<project>/.grok/skills/` |

Skills are directories, so `acm` links or copies them; no provider CLI is involved and
none holds runtime state. Two provider-specific notes:

**Antigravity's global root is not `~/.agents/`.** Its customization root is `.agents/`
inside a project but `~/.gemini/config/` globally, so skills placed in `~/.agents/skills`
are never read. Verified by asking the CLI directly: `agy --print "list the available
skills"` returned 16 entries before a skill was linked into `~/.gemini/config/skills`
and 24 after, with the newly linked ones present.

**Grok reads other providers' skill directories.** It scans `~/.claude/skills` and
`~/.cursor/skills` by default, so copying a skill into `~/.grok/skills` would duplicate
whatever is already installed for Claude. Instead `acm` registers the catalog itself
under `[skills] paths` in `~/.grok/config.toml`, and disables individual skills through
`[skills] disabled`. Source: `~/.grok/docs/user-guide/08-skills.md`, bundled with the
CLI.

---

## Plugins

| Provider | Location |
|----------|----------|
| Claude Code | `~/.claude/plugins/` |
| Codex | `~/.codex/.tmp/plugins/plugins/` |
| Antigravity | `~/.gemini/config/plugins/` (also `agy plugin` CLI) |
| Grok | `~/.grok/plugins/` (auto-trusted; project plugins need trust) |

Plugin support is deliberately shallow: `acm` imports a plugin into the catalog and
copies it into these directories. Providers are diverging here — Antigravity has an
`agy plugin` CLI, Grok has a trust model, Codex uses a marketplace cache — so the same
rule applies as everywhere else: delegate once a provider's own CLI becomes the only
correct way in.

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

If something `acm` configured is missing from that output, `acm` is writing to a place
the provider does not read.

**Did a field name change?** Compare what `acm` records with what the provider
launches:

```bash
acm mcp -H --verbose     # "Launches (<target>)" lines
```

A server showing `(nothing configured)` means the file uses a field `acm` does not
read.

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
