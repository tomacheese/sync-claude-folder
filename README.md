# sync-claude-folder

A CLI tool that syncs the `dot_claude` source in a dotfiles repository to `~/.claude`
and `~/.claude-work`, following chezmoi-like naming conversion rules.

## Background

- Materializes `~/repos/dotfiles/home/dot_claude` (chezmoi source) into `~/.claude`.
- Also syncs the same content to `~/.claude-work` (used with a separate account),
  while protecting auth/runtime data.
- Does not use chezmoi itself — this tool performs chezmoi naming conversion
  (`dot_`/`private_`/`executable_`/`readonly_` subset) and JSON transforms
  (`remove`/`set`/`merge`).

## Setup

```bash
cp config.example.json config.json
# Edit config.json to match your environment
pnpm install
```

## Usage

### sync

Calculates a sync plan (create/update/delete/skip) for each stage defined in `config.json`.
Defaults to dry-run (plan display only); files are written only when `--apply` is specified.

```bash
# Show plan for all stages (dry-run)
pnpm sync

# Specific stage only
pnpm sync -- --stage dotfiles-to-claude

# Apply changes
pnpm sync -- --apply

# Use a different config
pnpm sync -- --config ./config.json --apply
```

Before writing or deleting, existing files are backed up to
`~/.sync-claude-backup/<timestamp>/<relPath>` (default; override with `--backup-root`).

## config.json

Copy `config.example.json` to `config.json` and edit to match your environment.
`config.json` is gitignored because it contains machine-specific paths and credentials.

- `stages[].source` / `dest`: source/destination directories (`~` expansion supported)
- `chezmoiNaming`: whether to convert source names from chezmoi naming to real names
- `mirror`: whether to delete real-name files inside `managed` that no longer exist in source
- `managed`: real-name globs to sync and mirror
- `ignore`: globs to ignore on the source side (evaluated against pre-conversion source names)
- `protected`: globs always excluded from create/update/delete on the dest side
- `transforms`: `remove`/`set`/`merge` operations applied to JSON files

See [`config.schema.json`](./config.schema.json) for the full schema.

## Development

```bash
pnpm lint   # prettier + eslint + tsc
pnpm fix    # prettier + eslint --fix
pnpm test   # jest
```
