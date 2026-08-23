# `.hexscope/` Storage Layout

Since v2.20, Hex Scope keeps all of its persisted state **on disk under `.hexscope/`**
in the workspace instead of VS Code's `globalState`/`workspaceState`. That means
struct definitions, segment labels, and integrity profiles can be committed to git
and shared across a team — the same way `.hexscope/scripts/` already worked.

## Layout

```
your-workspace/
├── firmware/
│   └── boot.hex
└── .hexscope/
    ├── structs.json          # StructDef[] — shared, git-tracked
    ├── integrity.json        # IntegrityProfile[] — shared, git-tracked
    ├── data/                 # shared, git-tracked
    │   └── firmware/
    │       └── boot.hex.json # { labels, segmentNames } for that file
    ├── local/                # per-user, gitignored
    │   └── firmware/
    │       └── boot.hex.json # { pins, activeChecks, endian } for that file
    ├── .gitignore            # contains "local/"
    └── scripts/              # unchanged, see SCRIPTING.md
    │   └── verify-crc.ts
```

### File identity

Per-file data is keyed by the hex/srec file's path **relative to the workspace
root**, mirrored under `data/` or `local/`, with `.json` appended to the full
original filename. `firmware/boot.hex` → `data/firmware/boot.hex.json` (never
`boot.json`) so `.hex` and `.srec` siblings can't collide.

### Content shapes (all JSON)

- `structs.json` — the whole `StructDef[]` array.
- `integrity.json` — the whole `IntegrityProfile[]` array.
- `data/<file>.json` — `{ "labels": [SegmentLabel[]], "segmentNames": {...} }`.
- `local/<file>.json` — `{ "pins": [StructPin[]], "activeChecks": {...}, "endian": "le" | "be" }`.

Missing files are normal (nothing saved yet); reads return empty defaults.
`endian` defaults to `le`.

## Behaviour

- **Write cadence**: writes are **debounced** (~400 ms) and flushed immediately
  when a panel closes. Files are rewritten with 2-space JSON.
- **Self-heal**: on load, values are normalized (struct dedup, integrity-profile
  validation). If normalization changes the content, the file is rewritten.
  Corrupt/unparseable JSON is treated as empty with a one-time warning and is
  **never overwritten**.
- **External changes**: `.hexscope/` is file-watched. When a team member's
  `git pull` changes `structs.json` or `integrity.json`, open panels reload —
  prompting before replacing structs while you're mid-edit. Per-file
  `data/`/`local/` changes apply automatically.
- **Git ignoring**: the first write to `.hexscope/` seeds a `.hexscope/.gitignore`
  containing `local/` so per-user pins/endian/checks are never committed.
  If you deliberately remove that file or line, it is not re-added until the next
  session.
- **No workspace folder**: a lone hex file opened directly gets `.hexscope/`
  created next to it.

## Migration

Existing Memento-backed data (`globalState`/`workspaceState`) migrates
automatically and silently on the first panel open after upgrading: it is
normalized, written to the new files, and the old keys are deleted. If the files
already exist (e.g. a teammate already committed them), migration never clobbers
them — it only deletes leftover old keys.

## Not covered here

- Webview `localStorage` (sidebar width, pane sash sizes) stays per-machine.
- `editor.tokenColorCustomizations` defaults in `package.json` are untouched.