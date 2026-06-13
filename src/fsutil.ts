/**
 * ファイルシステム関連の小さなユーティリティ群。
 * glob 判定・パス展開・再帰走査をゼロ依存で実装する。
 */

import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import path from 'node:path'

/**
 * パス先頭の `~` をホームディレクトリへ展開する。
 * @param targetPath 展開対象のパス
 * @returns 展開後の絶対/相対パス
 */
export function expandHome(targetPath: string): string {
  if (targetPath === '~') {
    return os.homedir()
  }
  if (targetPath.startsWith('~/') || targetPath.startsWith('~\\')) {
    return path.join(os.homedir(), targetPath.slice(2))
  }
  return targetPath
}

/**
 * OS のパス区切りを POSIX (`/`) に統一する。
 * @param targetPath 変換対象のパス
 * @returns POSIX 区切りのパス
 */
export function toPosixPath(targetPath: string): string {
  return targetPath.split(path.sep).join('/')
}

/**
 * 指定ディレクトリ以下を再帰的に走査し、ファイル・シンボリックリンクの
 * 相対パス (POSIX 区切り) 一覧を返す。ディレクトリ自体は結果に含めない。
 * ルートディレクトリが存在しない場合は空配列を返す。
 * @param root 走査対象のディレクトリ (絶対パス)
 * @returns ルートからの相対パス (POSIX 区切り) の一覧
 */
export async function walkFiles(root: string): Promise<string[]> {
  const result: string[] = []

  /**
   * 指定ディレクトリを再帰的に走査して `result` へ追加する内部ヘルパー。
   * @param dir 走査対象ディレクトリの絶対パス
   */
  async function walk(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return
      }
      throw error
    }

    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(absolutePath)
        continue
      }
      // ファイル・シンボリックリンクは走査結果に含める
      result.push(toPosixPath(path.relative(root, absolutePath)))
    }
  }

  await walk(root)
  return result
}

/** glob パターン文字列 → 正規表現のキャッシュ */
const globRegExpCache = new Map<string, RegExp>()

/**
 * glob パターン (`*` / `**` / `?` に対応) を正規表現へ変換する。
 * 変換結果はモジュールレベルでキャッシュされ、同一パターンの再コンパイルを避ける。
 * `**` はパス区切りを含めて任意長にマッチし、`**\/` は 0 階層も許容する。
 * `*` はパス区切りを含まない任意長、`?` は任意の 1 文字 (パス区切り以外) にマッチする。
 * @param pattern glob パターン
 * @returns 変換後の正規表現 (完全一致)
 */
export function globToRegExp(pattern: string): RegExp {
  const cached = globRegExpCache.get(pattern)
  if (cached) {
    return cached
  }
  let regExpSource = ''
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          // `**/` -> 0 階層以上のディレクトリにマッチ
          regExpSource += '(?:.*/)?'
          i += 2
        } else {
          // `**` -> パス区切りを含む任意長
          regExpSource += '.*'
          i += 1
        }
      } else {
        // `*` -> パス区切りを含まない任意長
        regExpSource += '[^/]*'
      }
    } else if (char === '?') {
      regExpSource += '[^/]'
    } else if (/[.+^${}()|[\]\\]/.test(char)) {
      regExpSource += `\\${char}`
    } else {
      regExpSource += char
    }
  }
  const regexp = new RegExp(`^${regExpSource}$`)
  globRegExpCache.set(pattern, regexp)
  return regexp
}

/**
 * パスが glob パターンに一致するか判定する。
 * @param pattern glob パターン
 * @param targetPath 判定対象のパス (POSIX 区切り)
 * @returns 一致する場合 true
 */
export function matchGlob(pattern: string, targetPath: string): boolean {
  return globToRegExp(pattern).test(targetPath)
}

/**
 * パスがいずれかの glob パターンに一致するか判定する。
 * @param patterns glob パターンの配列
 * @param targetPath 判定対象のパス (POSIX 区切り)
 * @returns いずれかに一致する場合 true
 */
export function matchAnyGlob(patterns: string[], targetPath: string): boolean {
  return patterns.some((pattern) => matchGlob(pattern, targetPath))
}
