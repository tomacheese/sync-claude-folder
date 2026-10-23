/**
 * プランを実際のファイルシステムへ適用するモジュール。
 * 上書き・削除の前には常にバックアップを取得する。
 */

import * as fs from 'node:fs/promises'
import path from 'node:path'
import { PlanItem, StagePlan } from './planner'

/**
 * 数値を 2 桁ゼロ埋めした文字列へ変換する。
 * @param n 変換対象の数値
 * @returns 2 桁ゼロ埋め文字列
 */
function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** apply 実行時のオプション */
export interface ApplyOptions {
  /** true の場合のみ実際にファイルを書き込む。false の場合は何も変更しない (dry-run) */
  apply: boolean
  /** バックアップ先のルートディレクトリ (絶対パス) */
  backupRoot: string
  /** バックアップディレクトリ名に使うタイムスタンプ (未指定の場合は実行時刻から生成) */
  timestamp?: string
}

/** apply 実行結果の集計 */
export interface ApplyResult {
  created: number
  updated: number
  deleted: number
  skipped: number
}

/**
 * 現在時刻からバックアップディレクトリ名に使うタイムスタンプ文字列を生成する。
 * @returns `YYYYMMDDTHHMMSS` 形式の文字列
 */
export function buildTimestamp(): string {
  const now = new Date()
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `${date}T${time}`
}

/** 既存バックアップとの衝突を表す Node.js のエラーコード */
const BACKUP_CONFLICT_CODES = new Set(['EEXIST', 'ERR_FS_CP_EEXIST'])

/**
 * バックアップ先が既に存在することを示すエラーを生成する。
 * @param backupPath バックアップ先の絶対パス
 * @returns 衝突を示す Error
 */
function backupConflictError(backupPath: string): Error {
  return new Error(`Backup destination already exists: ${backupPath}`)
}

/**
 * dest の既存エントリをバックアップ先へコピーする (存在しない場合は何もしない)。
 * 既存のバックアップは上書きせず、衝突した場合は dest を変更する前に中断する。
 * @param destPath dest 側の絶対パス
 * @param backupPath バックアップ先の絶対パス
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

  // fs.cp は既存の空ディレクトリへのコピーを検出せずマージするため、種別によらず事前に確認する
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
 * chezmoi 属性をファイルへ best-effort で反映する。
 * Windows 等で chmod が失敗した場合は警告を出力するのみで処理を継続する。
 * @param filePath 対象ファイルの絶対パス
 * @param attrs chezmoi 属性
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
    // Windows では chmod が期待通りに動作しないことがあるため、警告のみで継続する
    console.warn(
      `Warning: failed to chmod ${filePath} to ${mode.toString(8)}: ${String(error)}`
    )
  }
}

/**
 * 1 件分のプランを適用する (apply=false の場合は判定のみ行い書き込まない)。
 * @param item プラン項目
 * @param options apply オプション
 * @param stageName バックアップ先を stage ごとに分離するための stage 名
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

  // dest が symlink やディレクトリの場合、書き込み前に取り除く
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
 * ステージのプランを適用し、結果を集計する。
 * @param plan ステージプラン
 * @param options apply オプション
 * @returns create/update/delete/skip の件数
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
