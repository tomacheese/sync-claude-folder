/**
 * Computes the create/update/delete/skip plan for each sync stage.
 */

import * as fs from 'node:fs/promises'
import path from 'node:path'
import { ChezmoiAttributes, resolveChezmoiPath } from './chezmoi-name'
import { StageConfig } from './config'
import { expandHome, matchAnyGlob, walkFiles } from './fsutil'
import { applyJsonTransform } from './transforms'

/** Action kind in a plan. */
export type PlanAction = 'create' | 'update' | 'delete' | 'skip'

/** One plan item. */
export interface PlanItem {
  /** Path relative to dest (real name, POSIX separators). */
  relPath: string
  /** Action to perform. */
  action: PlanAction
  /** Entry type (for delete, always 'file' regardless of what is actually in dest). */
  type: 'file' | 'symlink'
  /** Absolute source path (create/update only). */
  sourcePath?: string
  /** Absolute destination path. */
  destPath: string
  /** Content to write (after transforms; only for create/update with type 'file'). */
  content?: Buffer
  /** Symlink target (only for create/update with type 'symlink'). */
  symlinkTarget?: string
  /** chezmoi attributes (create/update only). */
  attrs?: ChezmoiAttributes
  /** Why the action was chosen (for log output). */
  reason: string
}

/** Plan of one stage. */
export interface StagePlan {
  stage: StageConfig
  items: PlanItem[]
}

/** Expected entry, computed from the source side. */
interface ExpectedEntry {
  content?: Buffer
  symlinkTarget?: string
  type: 'file' | 'symlink'
  attrs: ChezmoiAttributes
  sourcePath: string
}

/**
 * Walks the source directory and computes the set of expected real-name entries,
 * applying the stage's managed/ignore/transforms.
 * @param stage Stage config
 * @param sourceDir Absolute path of the already-expanded source directory
 * @returns Map from real-name relative path (POSIX) to expected entry
 */
async function buildExpectedEntries(
  stage: StageConfig,
  sourceDir: string
): Promise<Map<string, ExpectedEntry>> {
  const expected = new Map<string, ExpectedEntry>()
  const sourceFiles = await walkFiles(sourceDir)

  for (const relPath of sourceFiles) {
    // ignore is matched against the source name (before chezmoi naming conversion)
    if (matchAnyGlob(stage.ignore, relPath)) {
      continue
    }

    let targetRel = relPath
    let type: 'file' | 'symlink' = 'file'
    let attrs: ChezmoiAttributes = {
      private: false,
      readonly: false,
      executable: false,
      exact: false,
    }

    if (stage.chezmoiNaming) {
      const resolved = resolveChezmoiPath(relPath)
      if (resolved.ignore) {
        continue
      }
      targetRel = resolved.targetPath
      type = resolved.type === 'symlink' ? 'symlink' : 'file'
      attrs = resolved.attrs
    } else {
      // Detect symlinks via lstat even when chezmoiNaming is false
      const absSrc = path.join(sourceDir, ...relPath.split('/'))
      const srcStat = await fs.lstat(absSrc)
      if (srcStat.isSymbolicLink()) {
        type = 'symlink'
      }
    }

    // managed is matched against the converted real name
    if (!matchAnyGlob(stage.managed, targetRel)) {
      continue
    }

    const absSource = path.join(sourceDir, ...relPath.split('/'))

    if (type === 'symlink') {
      const symlinkTarget = await fs.readlink(absSource)
      expected.set(targetRel, {
        type,
        symlinkTarget,
        attrs,
        sourcePath: absSource,
      })
      continue
    }

    let content = await fs.readFile(absSource)
    const transform = stage.transforms.find((t) => t.path === targetRel)
    if (transform) {
      try {
        content = Buffer.from(
          applyJsonTransform(content.toString('utf8'), transform.ops),
          'utf8'
        )
      } catch (error) {
        throw new Error(
          `Failed to apply transform to "${targetRel}": ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
    expected.set(targetRel, { type, content, attrs, sourcePath: absSource })
  }

  return expected
}

/**
 * Compares the existing dest entry with the expected entry and decides the action and reason.
 * @param destPath Absolute path on the dest side
 * @param expected Expected entry
 * @returns Action and reason
 */
async function decideAction(
  destPath: string,
  expected: ExpectedEntry
): Promise<{ action: PlanAction; reason: string }> {
  const destStat = await fs.lstat(destPath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  })

  if (!destStat) {
    return { action: 'create', reason: 'not present in dest' }
  }

  if (expected.type === 'symlink') {
    if (!destStat.isSymbolicLink()) {
      return { action: 'update', reason: 'dest is not a symlink' }
    }
    const currentTarget = await fs.readlink(destPath)
    return currentTarget === expected.symlinkTarget
      ? { action: 'skip', reason: 'no difference' }
      : { action: 'update', reason: 'symlink target differs' }
  }

  if (destStat.isDirectory()) {
    return {
      action: 'update',
      reason: 'dest is a directory with the same name',
    }
  }
  if (destStat.isSymbolicLink()) {
    return { action: 'update', reason: 'dest is a symlink' }
  }

  const currentContent = await fs.readFile(destPath)
  return currentContent.equals(expected.content ?? Buffer.alloc(0))
    ? { action: 'skip', reason: 'no difference' }
    : { action: 'update', reason: 'content differs' }
}

/**
 * Computes the sync plan (create/update/delete/skip) for one stage.
 * @param stage Stage config (`~` may be unexpanded)
 * @returns The stage and its plan items
 */
export async function planStage(stage: StageConfig): Promise<StagePlan> {
  const sourceDir = expandHome(stage.source)
  const destDir = expandHome(stage.dest)
  const items: PlanItem[] = []

  const expected = await buildExpectedEntries(stage, sourceDir)

  for (const [targetRel, entry] of expected) {
    // protected is always excluded from create/update too
    if (matchAnyGlob(stage.protected, targetRel)) {
      continue
    }

    const destPath = path.join(destDir, ...targetRel.split('/'))
    const { action, reason } = await decideAction(destPath, entry)

    items.push({
      relPath: targetRel,
      action,
      type: entry.type,
      sourcePath: entry.sourcePath,
      destPath,
      content: entry.content,
      symlinkTarget: entry.symlinkTarget,
      attrs: entry.attrs,
      reason,
    })
  }

  if (stage.mirror) {
    const destFiles = await walkFiles(destDir)
    for (const relPath of destFiles) {
      // protected is always excluded from deletion (highest-priority guard)
      if (matchAnyGlob(stage.protected, relPath)) {
        continue
      }
      // Files outside managed are not managed (never deleted)
      if (!matchAnyGlob(stage.managed, relPath)) {
        continue
      }
      // Already handled as create/update if in the expected set
      if (expected.has(relPath)) {
        continue
      }

      items.push({
        relPath,
        action: 'delete',
        type: 'file',
        destPath: path.join(destDir, ...relPath.split('/')),
        reason: 'managed file not present in source (mirror delete)',
      })
    }
  }

  return { stage, items }
}
