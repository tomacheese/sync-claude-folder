/**
 * `~/.claude` がソースリポジトリへのジャンクション/シンボリックリンクである状態から、
 * 実ディレクトリへ一回限りで完全移行するモジュール。
 *
 * 手順:
 * 1. `~/.claude` がソースディレクトリへのジャンクション/シンボリックリンクであることを確認する
 * 2. ソースディレクトリ全体をバックアップする
 * 3. `git ls-files` でソース (追跡対象) のトップレベルエントリ集合を求める
 * 4. 追跡対象外 (ランタイム/認証) のトップレベルエントリを「移動対象」とする
 * 5. ジャンクション/シンボリックリンクを解除し、`~/.claude` を実ディレクトリとして作成する
 * 6. 移動対象のエントリをソースディレクトリから新しい `~/.claude` へ move する
 *    (ソース側の chezmoi 名ファイルはソースディレクトリに残し、純粋ソース化する)
 */

import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { buildTimestamp } from './apply'

/** migrate-claude のプラン */
export interface MigratePlan {
  /** `~/.claude` の絶対パス */
  claudeDir: string
  /** chezmoi ソースディレクトリ (dot_claude) の絶対パス */
  sourceDir: string
  /** バックアップ先ディレクトリの絶対パス */
  backupDir: string
  /** ソースディレクトリから `~/.claude` へ移動するトップレベルエントリ名 (ランタイム/認証) */
  runtimeEntries: string[]
  /** ソースディレクトリに残すトップレベルエントリ名 (chezmoi ソース) */
  sourceEntries: string[]
  /**
   * `~/.claude` が既にソースディレクトリへのジャンクション/シンボリックリンクでは
   * ない場合 true (= 移行不要、または既に移行済み)
   */
  alreadyMigrated: boolean
}

/**
 * `sourceDir` における git 追跡ファイルのトップレベルエントリ名集合を取得する。
 * @param sourceDir git ls-files を実行するディレクトリ (絶対パス)
 * @returns トップレベルエントリ名の集合
 */
function getTrackedTopLevelEntries(sourceDir: string): Set<string> {
  const output = execFileSync('git', ['ls-files'], {
    cwd: sourceDir,
    encoding: 'utf8',
  })
  const trackedTopLevel = new Set<string>()
  for (const line of output.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') {
      continue
    }
    const topLevel = trimmed.split('/')[0]
    trackedTopLevel.add(topLevel)
  }
  return trackedTopLevel
}

/**
 * `~/.claude` がソースディレクトリへのジャンクション/シンボリックリンクかどうかを判定する。
 * @param claudeDir `~/.claude` の絶対パス
 * @param sourceDir chezmoi ソースディレクトリの絶対パス
 * @returns ジャンクション/シンボリックリンクとして sourceDir を指している場合 true
 */
async function isJunctionToSource(
  claudeDir: string,
  sourceDir: string
): Promise<boolean> {
  const stat = await fs.lstat(claudeDir).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  })
  if (!stat?.isSymbolicLink()) {
    return false
  }
  const linkTarget = await fs.readlink(claudeDir)
  const resolvedTarget = path.resolve(path.dirname(claudeDir), linkTarget)
  return path.resolve(resolvedTarget) === path.resolve(sourceDir)
}

/**
 * migrate-claude のプランを算出する。
 * @param claudeDir `~/.claude` の絶対パス
 * @param sourceDir chezmoi ソースディレクトリ (dot_claude) の絶対パス
 * @param backupRoot バックアップ先のルートディレクトリ (絶対パス)
 * @returns 移行プラン
 */
export async function planMigration(
  claudeDir: string,
  sourceDir: string,
  backupRoot: string
): Promise<MigratePlan> {
  const alreadyMigrated = !(await isJunctionToSource(claudeDir, sourceDir))

  const trackedTopLevel = getTrackedTopLevelEntries(sourceDir)
  const allEntries = await fs.readdir(sourceDir)

  const runtimeEntries: string[] = []
  const sourceEntries: string[] = []
  for (const entry of allEntries) {
    // .git はリポジトリ管理データのためソース側に残す
    if (entry === '.git' || trackedTopLevel.has(entry)) {
      sourceEntries.push(entry)
    } else {
      runtimeEntries.push(entry)
    }
  }

  const timestamp = buildTimestamp()
  return {
    claudeDir,
    sourceDir,
    backupDir: path.join(backupRoot, `migrate-claude-${timestamp}`),
    runtimeEntries,
    sourceEntries,
    alreadyMigrated,
  }
}

/**
 * ジャンクション/シンボリックリンクを解除する。
 * Windows のディレクトリジャンクションは `fs.unlink` が EPERM/EISDIR を返す
 * 場合があるため、その際は `fs.rmdir` にフォールバックする。
 * @param targetPath 解除対象の絶対パス
 */
async function removeJunction(targetPath: string): Promise<void> {
  try {
    await fs.unlink(targetPath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EPERM' || code === 'EISDIR') {
      await fs.rmdir(targetPath)
      return
    }
    throw error
  }
}

/**
 * migrate-claude のプランを適用する。
 * `options.apply` が false の場合は何も変更しない (dry-run)。
 * @param plan 移行プラン
 * @param options apply オプション
 * @throws 既に移行済み (ジャンクションでない) 場合 Error
 */
export async function applyMigration(
  plan: MigratePlan,
  options: { apply: boolean }
): Promise<void> {
  if (plan.alreadyMigrated) {
    throw new Error(
      `${plan.claudeDir} is not a junction/symlink to ${plan.sourceDir}; migration is not needed (already migrated, or unexpected state)`
    )
  }

  if (!options.apply) {
    return
  }

  // 1. ソースディレクトリ全体をバックアップする
  await fs.cp(plan.sourceDir, plan.backupDir, { recursive: true })

  // 2. ジャンクション/シンボリックリンクを解除する
  await removeJunction(plan.claudeDir)

  // 3. 実ディレクトリとして再作成する
  await fs.mkdir(plan.claudeDir, { recursive: true })

  // 4. ランタイム/認証エントリを新しい ~/.claude へ移動する
  //    (chezmoi ソースのエントリは sourceDir に残し、純粋ソース化する)
  for (const entry of plan.runtimeEntries) {
    await fs.rename(
      path.join(plan.sourceDir, entry),
      path.join(plan.claudeDir, entry)
    )
  }
}
