/**
 * Applies plans to the real filesystem.
 * Existing entries are always backed up before being overwritten or deleted.
 */

import * as fs from 'node:fs/promises'
import path from 'node:path'
import { PlanItem, StagePlan } from './planner'

/** Zero-pads a number to 2 digits. */
function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Options for applying a plan. */
export interface ApplyOptions {
  /** Writes files only when true; when false nothing is changed (dry-run). */
  apply: boolean
  /** Root directory for backups (absolute path). */
  backupRoot: string
  /** Timestamp used as the backup directory name (generated from the current time when omitted). */
  timestamp?: string
}

/** Counts of applied plan items by action. */
export interface ApplyResult {
  created: number
  updated: number
  deleted: number
  skipped: number
}

/**
 * Builds a local-time timestamp for the backup directory name.
 * @returns A string in `YYYYMMDDTHHMMSS` format
 */
export function buildTimestamp(): string {
  const now = new Date()
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `${date}T${time}`
}

/** Node.js error codes that indicate a collision with an existing backup. */
const BACKUP_CONFLICT_CODES = new Set(['EEXIST', 'ERR_FS_CP_EEXIST'])

/** Creates the error thrown when the backup destination already exists. */
function backupConflictError(backupPath: string): Error {
  return new Error(`Backup destination already exists: ${backupPath}`)
}

/**
 * Copies an existing dest entry to the backup location (no-op if dest does not exist).
 * An existing backup is never overwritten; on a collision this aborts before dest is modified.
 * @param destPath Absolute path on the dest side
 * @param backupPath Absolute backup path
 */
async function backupExisting(
  destPath: string,
  backupPath: string
): Promise<void> {
  const stat = await fs.lstat(destPath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  })
  if (!stat) {
    return
  }

  // fs.cp merges into an existing empty directory without reporting a collision, so check up front regardless of entry type
  const existing = await fs.lstat(backupPath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  })
  if (existing) {
    throw backupConflictError(backupPath)
  }

  await fs.mkdir(path.dirname(backupPath), { recursive: true })
  try {
    if (stat.isSymbolicLink()) {
      await fs.symlink(await fs.readlink(destPath), backupPath)
    } else if (stat.isDirectory()) {
      await fs.cp(destPath, backupPath, {
        recursive: true,
        force: false,
        errorOnExist: true,
      })
    } else {
      await fs.copyFile(destPath, backupPath, fs.constants.COPYFILE_EXCL)
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== undefined && BACKUP_CONFLICT_CODES.has(code)) {
      throw backupConflictError(backupPath)
    }
    throw error
  }
}

/**
 * Applies chezmoi attributes to a file on a best-effort basis.
 * If chmod fails (e.g. on Windows), only a warning is printed and processing continues.
 * @param filePath Absolute path of the target file
 * @param attrs chezmoi attributes
 */
async function applyAttrs(
  filePath: string,
  attrs: PlanItem['attrs']
): Promise<void> {
  if (!attrs) {
    return
  }
  let mode: number | undefined
  if (attrs.private) {
    mode = 0o600
  } else if (attrs.readonly) {
    mode = 0o444
  } else if (attrs.executable) {
    mode = 0o755
  }
  if (mode === undefined) {
    return
  }
  try {
    await fs.chmod(filePath, mode)
  } catch (error) {
    // chmod may not work as expected on Windows, so warn and continue
    console.warn(
      `Warning: failed to chmod ${filePath} to ${mode.toString(8)}: ${String(error)}`
    )
  }
}

/**
 * Applies one plan item (with apply=false nothing is written).
 * @param item Plan item
 * @param options Apply options
 * @param stageName Stage name, used to separate backups per stage
 */
async function applyItem(
  item: PlanItem,
  options: ApplyOptions,
  stageName: string
): Promise<void> {
  if (item.action === 'skip') {
    return
  }

  const timestamp = options.timestamp ?? buildTimestamp()
  const backupPath = path.join(
    options.backupRoot,
    timestamp,
    stageName,
    item.relPath
  )

  if (item.action === 'delete') {
    if (!options.apply) {
      return
    }
    await backupExisting(item.destPath, backupPath)
    await fs.rm(item.destPath, { recursive: true, force: true })
    return
  }

  // create / update
  if (!options.apply) {
    return
  }

  await backupExisting(item.destPath, backupPath)

  // Remove dest first if it is a symlink or directory
  await fs.rm(item.destPath, { recursive: true, force: true })
  await fs.mkdir(path.dirname(item.destPath), { recursive: true })

  if (item.type === 'symlink') {
    if (item.symlinkTarget === undefined) {
      throw new Error(`symlinkTarget is missing for ${item.relPath}`)
    }
    await fs.symlink(item.symlinkTarget, item.destPath)
    return
  }

  if (item.content === undefined) {
    throw new Error(`content is missing for ${item.relPath}`)
  }
  await fs.writeFile(item.destPath, item.content)
  await applyAttrs(item.destPath, item.attrs)
}

/**
 * Applies a stage plan and tallies the results.
 * @param plan Stage plan
 * @param options Apply options
 * @returns Counts of create/update/delete/skip items
 */
export async function applyStagePlan(
  plan: StagePlan,
  options: ApplyOptions
): Promise<ApplyResult> {
  const result: ApplyResult = { created: 0, updated: 0, deleted: 0, skipped: 0 }
  const timestamp = options.timestamp ?? buildTimestamp()
  const resolvedOptions: ApplyOptions = { ...options, timestamp }

  for (const item of plan.items) {
    switch (item.action) {
      case 'create': {
        result.created++
        break
      }
      case 'update': {
        result.updated++
        break
      }
      case 'delete': {
        result.deleted++
        break
      }
      case 'skip': {
        result.skipped++
        break
      }
    }
    await applyItem(item, resolvedOptions, plan.stage.name)
  }

  return result
}
