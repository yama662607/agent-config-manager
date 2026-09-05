# The state directory and the catalog

`acm` uses two directories. They are not two copies of the same thing, and the
difference is easy to forget, so it is written down here.

| | Holds | Machine-specific | Shared between machines |
|---|---|---|---|
| `~/.acm` | `config.toml`, and the entrance below | Yes | No |
| Catalog | Skills, MCP recipes, plugins, their metadata | No | Yes, as a git repository |

`~/.acm` is a pointer. The catalog is the payload.

## Why they are separate

`config.toml` names the catalog's location, along with the default targets for
this machine. Those values differ per machine, and the catalog is a repository
cloned onto every machine. Keeping the two apart is what stops machine-specific
values from landing in a shared file — the same reason recorded paths are stored
`~`-relative rather than as `/Users/<someone>/…`.

Neither side can absorb the other:

- **The state directory cannot go away.** Something has to say where the catalog
  is before anything can be read. `ACM_CATALOG_DIR` alone does not do it: an
  agent launched from a GUI never sees the shell's environment.
- **The catalog should not move into `~/.acm`.** It would put a versioned
  repository inside the directory that holds this machine's own settings, and
  bury a directory meant to be browsed, committed and shared inside a dotfile.

By default there is only one directory: `~/.acm` *is* the catalog, and no
indirection exists. The split appears only once the catalog is moved out.

## The entrance

`~/.acm/skills` is a symlink to the catalog's `skills/`. It exists so that
distributed links can hold a fixed address:

```
~/.claude/skills/<id>  ->  ~/.acm/skills/<id>  ->  <catalog>/skills/<id>
```

Relocating the catalog then means repointing one symlink instead of every
distribution. `stable_link_target` in `src/core/placement.rs` writes that address
only after `realpath` confirms both names lead to the same directory, and falls
back to the catalog's own path otherwise.

`~/.acm/config.toml` selects machine defaults, and `disabled-mcps/` stores reversible MCP disable state. Metadata (`skills-metadata.toml`,
`mcps-metadata.toml`, `plugins-metadata.toml`, `plugin-snapshot.toml`),
`PUBLIC.txt` and `plugins/` are all resolved through `get_catalog_dir()`.

## How this came about

Worth recording, because the decision left almost no trace and had to be
reconstructed from timestamps.

| When | What |
|---|---|
| 2026-06-19 | The catalog repository is created, separate from `~/.acm` |
| 2026-08-02 00:31 | `catalog_dir` is added, so the catalog can live outside `~/.acm` |
| 2026-08-02 00:43 | The last reader moves onto `get_catalog_dir()` |
| 2026-08-02 01:18 | A machine is migrated: `~/.acm`'s contents are replaced by *seven* symlinks into the catalog |
| 2026-08-02 01:22 | `stable_link_target` adopts one of them, `skills`, as the fixed address |

The seven symlinks were made by hand and never committed, which caused two
problems that went unnoticed for weeks:

1. **Six of them were dead on arrival.** Every reader had already moved to
   `get_catalog_dir()` by 00:43, so only `skills` was ever followed — and only by
   links already on disk, not by any code. They made `~/.acm` look like a second
   copy of the catalog, which misled both a reader and a later audit.
2. **Nothing created the seventh.** A second machine got no entrance, so
   `stable_link_target` silently fell back to the catalog's path and the
   relocatability above quietly stopped being true. The Rust implementation follows the entrance when it already resolves to the selected catalog; it otherwise links directly to the configured catalog without creating or repointing unrelated user links.
