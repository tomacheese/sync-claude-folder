# AGENTS.md

Guidance for AI coding agents working in this repository. See `README.md` for user-facing usage and configuration.

## Language

- All deliverables are written in English: commit messages, PR/Issue titles and bodies, review comments, code comments, JSDoc, and documentation.
- Exceptions: localized UI strings, quotations, technical identifiers, generated files, and external source text.
- Error and warning messages are English.
- Conversation with the maintainer may be in Japanese; that does not change the deliverable language.
- Do not rewrite Git history to change the language of existing commits.

## Overview

A CLI tool that syncs a chezmoi source tree (`home/dot_claude` in a dotfiles repository) into `~/.claude` and `~/.claude-work`. It does not use chezmoi itself: it implements a subset of chezmoi naming conversion (`dot_`, `private_`, `readonly_`, `executable_`, `exact_`, `literal_`, `symlink_`) and JSON Pointer transforms (`remove` / `set` / `merge`), driven by `config.json`.

The destination directories are live and hold auth credentials and session history, so file-mutating code is safety-critical.

## Safety rules

- Dry-run is the default; files are written only when `--apply` is given. Nothing in `src/apply.ts` may write, delete, or `chmod` when `options.apply` is `false`.
- Before overwriting or deleting a dest entry, back it up first (`backupExisting`). An existing backup is never overwritten.
- `protected` globs are always excluded from create/update/delete, with the highest priority. Any change to the protected list or its handling (`protected` entries in `config.example.json`, `config.schema.json`, the protected checks in `src/planner.ts`) must be explained to and approved by the maintainer before it is made.
- `mirror` deletion stays scoped to the `managed` globs.
- Throw `Error` / `TypeError` with a clear message on invalid config; only best-effort steps (e.g. `chmod` on Windows) may warn and continue.
- Distinguish `ENOENT` from other filesystem errors.
- Never enable `skipLibCheck` or otherwise suppress type errors to work around `tsc` failures.

## Commands

pnpm is required (`preinstall` runs `only-allow pnpm`). The Node.js version is in `.node-version`.

```bash
pnpm install        # install dependencies
pnpm sync           # show the sync plan (dry-run)
pnpm sync -- --apply  # apply the plan
pnpm lint           # prettier --check + eslint + tsc
pnpm fix            # prettier --write + eslint --fix
pnpm test           # jest with coverage
```

There is no build script; the tool runs through `tsx`. CI is the shared `book000/templates` Node.js pnpm workflow (`.github/workflows/nodejs-ci-pnpm.yml`).

## Code layout

| File | Purpose |
|---|---|
| `src/main.ts` | CLI entry point (`sync` command, argument parsing) |
| `src/config.ts` | Types, loading and validation of `config.json` |
| `src/chezmoi-name.ts` | chezmoi source name to real name, type and attributes |
| `src/fsutil.ts` | `~` expansion, glob matching, recursive traversal |
| `src/planner.ts` | Per-stage create/update/delete/skip plan |
| `src/transforms.ts` | JSON Pointer transforms |
| `src/apply.ts` | Plan application (backup, write, delete, chmod) |
| `config.example.json` / `config.schema.json` | Config template (copy to the gitignored `config.json`) and its JSON Schema |

## Conventions

- TypeScript with prettier and eslint (`@book000/eslint-config`); prefer `node:`-prefixed built-in imports.
- `pnpm lint` and `pnpm test` must pass before committing; never commit secrets or sensitive information.
- If a file's error messages use emoji prefixes, keep that usage consistent across the file.
- Every function, interface and class has a JSDoc comment; keep comments to intent and constraints, not restatements of the code.
- Tests are adjacent `*.test.ts` files (Jest + ts-jest) using temp directories under `os.tmpdir()`. Adding a chezmoi attribute, transform op or planner branch requires a test, and `protected` / `mirror` boundaries (not deleted, not overwritten) must stay covered.
- Update `README.md` and `config.schema.json` together with any change to usage or the `config.json` structure.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/); branches follow [Conventional Branch](https://conventional-branch.github.io) short form (`feat/...`, `fix/...`).
- Do not add commits to Renovate-created PRs.
- Research other GitHub repositories by cloning them into a temporary directory.

## Repository notes

`hooks/symlink_literal_executable_*.sh` in the dotfiles source is a leftover that this tool deliberately skips via the `ignore` config; removing it from the dotfiles is out of scope here.
