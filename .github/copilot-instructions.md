# Copilot Code Review Instructions

Guidance for GitHub Copilot when reviewing pull requests in this repository. Project overview, commands, safety rules and conventions are in [`AGENTS.md`](../AGENTS.md); this file lists only what to check during review. All review comments and suggested text should be in English.

## Review focus

### Destructive operations (highest priority)

- `src/apply.ts` must never write, delete, or `chmod` when `options.apply` is `false`. Flag any create/update/delete path not guarded by `if (!options.apply) return`.
- Overwrites and deletes must call `backupExisting` before `fs.rm` / `fs.writeFile`. Flag any mutation that skips the backup.
- `protected` globs must stay excluded from create/update/delete. Flag `src/planner.ts` changes that could let a protected path be mutated, and any change to the protected list or its handling (`config.example.json`, `config.schema.json`, `src/planner.ts`) that is not explained as maintainer-approved in the PR.
- `mirror` deletion must stay scoped to `managed` globs.

### Error handling

- Invalid config or missing required fields must throw `Error` / `TypeError` with a clear message (see `src/config.ts`); do not return defaults for malformed input.
- Best-effort steps that may fail on some platforms (e.g. `chmod` in `applyAttrs`) warn and continue.
- Distinguish `ENOENT` from other filesystem errors.

### Conventions

- Error/warning messages, code comments and JSDoc are English. Flag Japanese text introduced into them.
- New functions, interfaces and classes need JSDoc; flag restate-the-code comments.
- No `skipLibCheck` or other type-error suppression.
- Use `node:`-prefixed imports for built-in modules.

### Tests

- New chezmoi attributes, transform operations or planner branches need tests.
- `protected` / `mirror` boundary behavior must remain covered.

## Do not flag

- The dual `~/.claude` and `~/.claude-work` destinations; they are by design.
- pnpm-only enforcement (`only-allow pnpm`); suggestions to support npm/yarn are out of scope.
