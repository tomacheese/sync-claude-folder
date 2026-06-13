# Claude Code Guidelines

## Purpose

This document defines the working policy and project-specific rules for Claude Code in this project.

## Decision Logging Rules

All decisions must be recorded in a reviewable form:

1. **Summary of decision**: Clearly describe what was decided
2. **Alternatives considered**: List other options that were evaluated
3. **Rejected options and reasons**: Explain why each alternative was not chosen
4. **Preconditions, assumptions, and uncertainties**: State the assumptions the decision rests on
5. **Reviewability by other agents**: Indicate whether another agent can review the decision

**Important**: Always make preconditions, assumptions, and uncertainties explicit. Do not treat assumptions as facts.

## Project Overview

- **Purpose**: A CLI tool that syncs `home/dot_claude` from a dotfiles repository to
  `~/.claude` / `~/.claude-work` following chezmoi-like naming conversion and transform rules
- **Key features**:
  - chezmoi naming conversion subset (`dot_`/`private_`/`executable_`/`readonly_`/`exact_`/`literal_`/`symlink_` etc.)
  - JSON Pointer-based transforms (`remove`/`set`/`merge`)
  - `config.json`-driven create/update/delete/skip plan calculation and application (dry-run by default)

## Core Rules

- **Conversation language**: Japanese
- **Code comments**: Japanese
- **Error messages**: English
- **Japanese/alphanumeric spacing**: Insert a half-width space between Japanese and alphanumeric characters
- **Commit messages**: Follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
  - Format: `<type>(<scope>): <description>`
  - `<description>` must be in Japanese
  - Example: `feat: chezmoi 命名変換モジュールを追加`

## Environment Rules

- **Branch naming**: Follow [Conventional Branch](https://conventional-branch.github.io)
  - Format: `<type>/<description>`
  - Use short-form `<type>` (feat, fix, etc.)
- **Researching GitHub repositories**: Clone to a temporary directory and search there
- **Renovate PRs**: Do not add commits or updates to existing Renovate-created PRs

## Git Worktree

This project does not use Git Worktree. Use standard Git branch operations.

## Code Modification Rules

- **TypeScript skipLibCheck**: Never enable this to work around type errors
- **Docstrings**: Write and maintain JSDoc in Japanese for all functions, interfaces, and classes
- **Error message emoji**: If existing error messages in a file use emoji prefixes, unify usage across the file

## Development Commands

```bash
# Install dependencies (pnpm required)
pnpm install

# Show sync plan (dry-run)
pnpm sync

# Apply sync
pnpm sync -- --apply

# Lint check (prettier + eslint + tsc)
pnpm lint

# Auto-fix
pnpm fix

# Run tests (with coverage)
pnpm test
```

## Architecture and Key Files

| File | Purpose |
|---|---|
| `src/main.ts` | CLI entry point (`sync` command dispatch) |
| `src/config.ts` | Type definitions, loading, and validation for `config.json` |
| `src/chezmoi-name.ts` | chezmoi naming conversion (source name → real name, type, attributes) |
| `src/fsutil.ts` | Path expansion, glob matching, recursive traversal utilities |
| `src/planner.ts` | Per-stage create/update/delete/skip plan calculation |
| `src/transforms.ts` | JSON Pointer-based transforms (`remove`/`set`/`merge`) |
| `src/apply.ts` | Plan application (backup, write, delete, chmod) |
| `config.json` | Sync stage definitions (source/dest/managed/ignore/protected/transforms) |
| `config.example.json` | Template for `config.json` with placeholder values |
| `config.schema.json` | JSON Schema for `config.json` |

### Implementation Patterns

Recommended:
- Keep each module single-responsibility (naming conversion / transform / plan calculation / application)
- Destructive operations (`apply.ts`) must default to dry-run; only execute with `--apply`
- Always back up files before overwriting or deleting

Not recommended:
- Using `skipLibCheck`

## Testing

- Test framework: Jest + ts-jest
- Test file placement: Adjacent `*.test.ts` files (`testMatch: ["**/*.test.ts"]`)
- Test command: `pnpm test`
- `src/chezmoi-name.ts` / `src/transforms.ts` / `src/planner.ts` are tested using a temp directory (`os.tmpdir()`)

### Additional Test Requirements

- Always add corresponding tests when adding new chezmoi attributes, transform operations, or plan branches
- `protected` / `mirror` boundary conditions (not deleted, not overwritten) must always be covered by tests

## Documentation Update Rules

### Files to Update Together

When updating the following files, update them simultaneously:

- `README.md`: when usage or config.json documentation changes
- `CLAUDE.md` (this file): when development policy or commands change
- `config.schema.json`: when the structure of `config.json` changes

## Work Checklist

### Before New Work

1. Thoroughly explore and understand the project
2. Verify the working branch is appropriate — not a branch with a closed PR
3. Verify it is a new branch based on the latest remote branch
4. Verify that closed/unnecessary branches have been deleted
5. Install dependencies with `pnpm install`

### Before Commit/Push

1. Commit message follows Conventional Commits (`<description>` in Japanese)
2. No sensitive information in the commit
3. `pnpm lint` passes with no errors
4. `pnpm test` passes

### Before Creating a PR

1. PR creation has been explicitly requested by the user
2. No sensitive information in the commit
3. No risk of merge conflicts

## Repository-Specific Notes

- `~/.claude` and `~/.claude-work` are live directories containing auth credentials and session history.
  The `protected` list in `config.json` is always applied with highest priority, protecting them from
  `sync --apply`. Any changes to the protected list must be explained to and approved by the user.
- `hooks/symlink_literal_executable_*.sh` is dead code in the dotfiles that violates the policy
  (no `symlink_executable_` workarounds). This tool ignores it via the `ignore` config.
  Removing it from dotfiles is out of scope for this tool.
