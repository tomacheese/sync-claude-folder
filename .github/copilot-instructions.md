# Copilot Code Review Instructions

Guidance for GitHub Copilot when reviewing pull requests in this repository.
This file is for code review, not for driving development (see `CLAUDE.md` for that).

## What this project is

A CLI tool that syncs a chezmoi source tree (`dot_claude`) into `~/.claude` and
`~/.claude-work`, applying a subset of chezmoi naming conversion and JSON Pointer
transforms. It operates on live user directories that hold auth credentials and
session history, so file-mutating code is safety-critical.

## Review focus

### Safety of destructive operations (highest priority)

- `src/apply.ts` must never write, delete, or `chmod` when `options.apply` is
  `false`. Flag any create/update/delete path that is not guarded by an
  `if (!options.apply) return` (dry-run is the default).
- Overwrites and deletes must back up the existing dest entry first
  (`backupExisting`) before `fs.rm` / `fs.writeFile`. Flag any mutation that
  skips the backup step.
- `protected` globs must always be excluded from create/update/delete. Flag
  changes to `src/planner.ts` that could let a protected path be mutated.
- `mirror` deletion must stay scoped to `managed` globs. Flag deletions that
  could escape the managed set.

### Error handling

- Throw `Error` / `TypeError` with a clear message on invalid config or missing
  required fields (see `src/config.ts`); do not silently swallow or return
  defaults for malformed input.
- Best-effort operations that are expected to fail on some platforms (e.g.
  `chmod` on Windows in `applyAttrs`) should warn and continue, not throw.
- Distinguish `ENOENT` (expected: file absent) from other filesystem errors;
  do not treat all errors as "missing".

### Conventions enforced in this repo

- Error/warning message text is English. Code comments and JSDoc are Japanese.
  Flag mismatches.
- Every function, interface, and class needs Japanese JSDoc. Flag new exported
  symbols that lack it.
- Do not introduce `skipLibCheck` or other type-error suppression to work around
  `tsc` failures.
- Prefer `node:` prefixed imports for built-in modules, consistent with existing
  code (`node:fs`, `node:path`).

### Tests

- New chezmoi attributes, transform operations, or planner branches must come
  with tests (`*.test.ts` adjacent to the source).
- `protected` / `mirror` boundary behavior (not deleted, not overwritten) must
  remain covered. Flag changes to that logic that lack corresponding tests.

## Do not flag

- Japanese text in comments, JSDoc, or the conversation-facing docs — it is the
  intended language for this repo.
- The dual `~/.claude` and `~/.claude-work` destinations — sinking to two targets
  is by design, not duplication.
- `pnpm`-only enforcement (`preinstall` runs `only-allow pnpm`); suggestions to
  support npm/yarn are out of scope.
