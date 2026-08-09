# Outcome

Archived 2026-08-05 with 62 of 62 tasks unchecked. The goal was met; most of
the work this proposal specified turned out not to be necessary.

## What the proposal assumed

That the four providers package plugins differently enough to need a canonical
intermediate representation, per-provider renderers, a command-to-skill
converter, and a hook bridge.

## What measurement showed

They do not. The providers agree on what a plugin is — a directory holding any
of `skills/`, `commands/`, `agents/`, `hooks/hooks.json` and `.mcp.json` — and
disagree only on where the manifest sits. Writing the same manifest to all four
locations produces one directory each provider reads as its own. Verified with
`claude plugin validate`, `grok plugin validate` and `agy plugin validate`
against an assembled copy of the `zoom` plugin.

Each provider also does its own adaptation already. **Antigravity converts
`commands/` into skills by itself** (26 of them, for `zoom`), and Claude ignores
manifest fields it does not recognise rather than failing. A converter in `acm`
would have duplicated work the providers do better and would have gone stale as
they changed.

The composition of the catalog reinforced this. Of 107 plugins, 78 carry skills
and 20 carry MCP servers, but only 11 carry commands, 6 carry agents, and **1
carries hooks** — so sections 5 (Hook Conversion and Runtime Bridge) and much of
4 (Compatibility Planning) addressed cases that barely exist.

## What was right

Two of the proposal's judgements held, and both are implemented:

- **Installation must go through each provider's own CLI.** A valid plugin
  directory placed in `~/.grok/plugins/` leaves `grok plugin list` empty; an
  enabled plugin is state the provider records. This is the rule in
  `docs/provider-config-surfaces.md`.
- **Discoverable sources and installed state are different things.** The catalog
  holds sources; the providers hold installations; `acm plugin convert`
  publishes the former as a local marketplace and delegates the latter.

## What was built instead

| Proposal | Delivered |
|----------|-----------|
| Canonical model, renderers, hook bridge (§2, §4, §5, §6) | `src/plugin-assemble.ts`, 130 lines — writes every manifest location |
| Native lifecycle, transactions, rollback (§7) | `src/plugin-marketplace.ts` — a local marketplace, registered via each provider's CLI |
| Staged import → plan → install (§8) | `acm plugin convert`, `acm plugin update` |
| Catalog promotion (§9) | already existed as `acm catalog publish` |

One content-level difference did turn up, which the proposal did not anticipate:
Antigravity reads a plugin's MCP servers from `mcp_config.json`, not
`.mcp.json`. Assembly writes both names. That is the only conversion `acm`
performs.

## Result

All 107 catalog plugins resolve on all four providers. `build-ios-apps` and
`build-web-apps` are installed on Claude, Codex, Antigravity and Grok, with
`build-ios-apps` carrying its `xcodebuildmcp` server to each.

Two defects surfaced along the way, both from the same import bug and both
fixed: 522 skills had lost 3,533 supporting files, and 21 plugins had lost
their `.mcp.json`. See `acm plugin repair`.
