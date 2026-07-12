/**
 * 同期ステージごとに create/update/delete/skip のプランを算出するモジュール。
 */

import * as fs from 'node:fs/promises'
import path from 'node:path'
import { ChezmoiAttributes, resolveChezmoiPath } from './chezmoi-name'
import { StageConfig } from './config'
import { expandHome, isMatchAnyGlob, walkFiles } from './fsutil'
import { applyJsonTransform } from './transforms'

/** プラン上のアクション種別 */
export type PlanAction = 'create' | 'update' | 'delete' | 'skip'

/** プラン 1 件分の情報 */
export interface PlanItem {
  /** dest からの相対パス (実名・POSIX 区切り) */
  relPath: string
  /** 実行するアクション */
  action: PlanAction
  /** エントリ種別 (delete の場合は dest 側の実態に依らず 'file' とする) */
  type: 'file' | 'symlink'
  /** コピー元の絶対パス (create/update のみ) */
  sourcePath?: string
  /** コピー先の絶対パス */
  destPath: string
  /** 書き込む内容 (transform 適用後。type が 'file' の create/update のみ) */
  content?: Buffer
  /** symlink のリンク先 (type が 'symlink' の create/update のみ) */
  symlinkTarget?: string
  /** chezmoi 属性 (create/update のみ) */
  attrs?: ChezmoiAttributes
  /** アクションを選択した理由 (ログ表示用) */
  reason: string
}

/** ステージ 1 件分のプラン */
export interface StagePlan {
  stage: StageConfig
  items: PlanItem[]
}

/** 期待される (ソース側から算出した) エントリ情報 */
interface ExpectedEntry {
  content?: Buffer
  symlinkTarget?: string
  type: 'file' | 'symlink'
  attrs: ChezmoiAttributes
  sourcePath: string
}

/**
 * ソースディレクトリを走査し、ステージの managed/ignore/transforms を適用した
 * 「期待される実名エントリ集合」を算出する。
 * @param stage ステージ設定
 * @param sourceDirectory 展開済みのソースディレクトリ絶対パス
 * @returns 実名相対パス (POSIX) → 期待エントリ のマップ
 */
async function buildExpectedEntries(
  stage: StageConfig,
  sourceDirectory: string
): Promise<Map<string, ExpectedEntry>> {
  const expected = new Map<string, ExpectedEntry>()
  const sourceFiles = await walkFiles(sourceDirectory)

  for (const relativePath of sourceFiles) {
    // ソース名に対する ignore 判定 (chezmoi 命名変換前)
    if (isMatchAnyGlob(stage.ignore, relativePath)) {
      continue
    }

    let targetRelative = relativePath
    let type: 'file' | 'symlink' = 'file'
    let attributes: ChezmoiAttributes = {
      private: false,
      readonly: false,
      executable: false,
      exact: false,
    }

    if (stage.chezmoiNaming) {
      const resolved = resolveChezmoiPath(relativePath)
      if (resolved.ignore) {
        continue
      }
      targetRelative = resolved.targetPath
      type = resolved.type === 'symlink' ? 'symlink' : 'file'
      attributes = resolved.attrs
    } else {
      // chezmoiNaming: false の場合も lstat でシンボリックリンクを検出する
      const absSource = path.join(sourceDirectory, ...relativePath.split('/'))
      const sourceStat = await fs.lstat(absSource)
      if (sourceStat.isSymbolicLink()) {
        type = 'symlink'
      }
    }

    // 変換後の実名に対する managed 判定
    if (!isMatchAnyGlob(stage.managed, targetRelative)) {
      continue
    }

    const absSource = path.join(sourceDirectory, ...relativePath.split('/'))

    if (type === 'symlink') {
      const symlinkTarget = await fs.readlink(absSource)
      expected.set(targetRelative, {
        type,
        symlinkTarget,
        attrs: attributes,
        sourcePath: absSource,
      })
      continue
    }

    let content = await fs.readFile(absSource)
    const transform = stage.transforms.find((t) => t.path === targetRelative)
    if (transform) {
      try {
        content = Buffer.from(
          applyJsonTransform(content.toString('utf8'), transform.ops),
          'utf8'
        )
      } catch (error) {
        throw new Error(
          `Failed to apply transform to "${targetRelative}": ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
    expected.set(targetRelative, {
      type,
      content,
      attrs: attributes,
      sourcePath: absSource,
    })
  }

  return expected
}

/**
 * dest 側の既存エントリと期待エントリを比較し、アクションと理由を決定する。
 * @param destinationPath dest 側の絶対パス
 * @param expected 期待エントリ
 * @returns アクションと理由
 */
async function decideAction(
  destinationPath: string,
  expected: ExpectedEntry
): Promise<{ action: PlanAction; reason: string }> {
  let destinationStat: Awaited<ReturnType<typeof fs.lstat>> | undefined
  try {
    destinationStat = await fs.lstat(destinationPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  if (!destinationStat) {
    return { action: 'create', reason: 'dest に存在しない' }
  }

  if (expected.type === 'symlink') {
    if (!destinationStat.isSymbolicLink()) {
      return { action: 'update', reason: 'dest が symlink ではない' }
    }
    const currentTarget = await fs.readlink(destinationPath)
    return currentTarget === expected.symlinkTarget
      ? { action: 'skip', reason: '差分なし' }
      : { action: 'update', reason: 'symlink の参照先が異なる' }
  }

  if (destinationStat.isDirectory()) {
    return { action: 'update', reason: 'dest が同名のディレクトリになっている' }
  }
  if (destinationStat.isSymbolicLink()) {
    return { action: 'update', reason: 'dest が symlink になっている' }
  }

  const currentContent = await fs.readFile(destinationPath)
  return currentContent.equals(expected.content ?? Buffer.alloc(0))
    ? { action: 'skip', reason: '差分なし' }
    : { action: 'update', reason: '内容が異なる' }
}

/**
 * 1 ステージ分の同期プラン (create/update/delete/skip) を算出する。
 * @param stage ステージ設定 (`~` は未展開でよい)
 * @returns ステージとプラン項目一覧
 */
export async function planStage(stage: StageConfig): Promise<StagePlan> {
  const sourceDirectory = expandHome(stage.source)
  const destinationDirectory = expandHome(stage.dest)
  const items: PlanItem[] = []

  const expected = await buildExpectedEntries(stage, sourceDirectory)

  for (const [targetRelative, entry] of expected) {
    // protected は create/update からも常に除外する
    if (isMatchAnyGlob(stage.protected, targetRelative)) {
      continue
    }

    const destinationPath = path.join(
      destinationDirectory,
      ...targetRelative.split('/')
    )
    const { action, reason } = await decideAction(destinationPath, entry)

    items.push({
      relPath: targetRelative,
      action,
      type: entry.type,
      sourcePath: entry.sourcePath,
      destPath: destinationPath,
      content: entry.content,
      symlinkTarget: entry.symlinkTarget,
      attrs: entry.attrs,
      reason,
    })
  }

  if (stage.mirror) {
    const destinationFiles = await walkFiles(destinationDirectory)
    for (const relativePath of destinationFiles) {
      // protected は削除対象から常に除外する (最優先ガード)
      if (isMatchAnyGlob(stage.protected, relativePath)) {
        continue
      }
      // managed 範囲外の実名ファイルは管理しない (削除しない)
      if (!isMatchAnyGlob(stage.managed, relativePath)) {
        continue
      }
      // 期待集合に含まれていれば create/update 側で処理済み
      if (expected.has(relativePath)) {
        continue
      }

      items.push({
        relPath: relativePath,
        action: 'delete',
        type: 'file',
        destPath: path.join(destinationDirectory, ...relativePath.split('/')),
        reason: 'ソースに存在しない managed ファイル (mirror 削除)',
      })
    }
  }

  return { stage, items }
}
