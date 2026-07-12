/**
 * chezmoi のソースファイル名から実名・種別・属性を解決するモジュール。
 *
 * chezmoi 本体の全属性は対応せず、dot_claude ソースで実際に使用されている
 * サブセット (dot_ / private_ / executable_ / readonly_ / exact_ / literal_ /
 * symlink_ / .tmpl / run_*・create_* 等の実行系プレフィックス) のみを解釈する。
 *
 * 参考: https://www.chezmoi.io/reference/source-state-attributes/
 */

/** 実体化後のエントリ種別 */
export type ChezmoiEntryType = 'file' | 'dir' | 'symlink'

/** chezmoi 属性のうち、本ツールで扱うもの */
export interface ChezmoiAttributes {
  /** private_: パーミッションを所有者のみ読み書き可 (0600) にする */
  private: boolean
  /** readonly_: 読み取り専用にする */
  readonly: boolean
  /** executable_: 実行ビットを付与する */
  executable: boolean
  /** exact_: ディレクトリ配下を管理ミラーとして扱う (本ツールでは mirror 設定に委譲) */
  exact: boolean
}

/** ソース名 1 セグメントの解決結果 */
export interface ResolvedChezmoiName {
  /** 変換後の実名 (1 セグメント分) */
  name: string
  /** エントリ種別 */
  type: ChezmoiEntryType
  /** 解決した属性 */
  attrs: ChezmoiAttributes
  /**
   * 本ツールでは扱わない/扱えない属性 (.tmpl, run_* 等の実行スクリプト系) を
   * 検出した場合 true。true の場合、呼び出し側はこのエントリを無視する。
   */
  ignore: boolean
}

/** ソース全体パスの解決結果 */
export interface ResolvedChezmoiPath {
  /** 変換後の実名パス (POSIX 区切り) */
  targetPath: string
  /** 末端エントリの種別 */
  type: ChezmoiEntryType
  /** 末端エントリの属性 */
  attrs: ChezmoiAttributes
  /** パス中のいずれかのセグメントが ignore 対象だった場合 true */
  ignore: boolean
}

/**
 * 全属性が false のデフォルト `ChezmoiAttributes` を返す。
 * @returns デフォルト属性オブジェクト
 */
function defaultAttributes(): ChezmoiAttributes {
  return { private: false, readonly: false, executable: false, exact: false }
}

/**
 * 本ツールでは解釈せずに ignore とするソース名プレフィックス。
 * run_ , create_ , modify_ , remove_ , onchange_ , encrypted_ , empty_ , external_
 * は対象ファイルに存在しないか、実行スクリプト系のため対象外とする。
 * (run_once_ 等の "*_once_" も run_ 等の前方一致でカバーされる)
 */
const IGNORED_PREFIXES = [
  'run_',
  'create_',
  'modify_',
  'remove_',
  'onchange_',
  'encrypted_',
  'empty_',
  'external_',
]

/**
 * ソース名 (パスの 1 セグメント) を実名・種別・属性へ解決する。
 * @param sourceName chezmoi ソース上のファイル/ディレクトリ名 (1 セグメント)
 * @returns 解決結果
 */
export function resolveChezmoiName(sourceName: string): ResolvedChezmoiName {
  let name = sourceName
  const attributes = defaultAttributes()
  let type: ChezmoiEntryType = 'file'

  // .tmpl はテンプレートエンジン未対応のため ignore
  if (name.endsWith('.tmpl')) {
    return { name, type, attrs: attributes, ignore: true }
  }

  // run_*/create_* 等の実行・スクリプト系プレフィックスは ignore
  for (const prefix of IGNORED_PREFIXES) {
    if (name.startsWith(prefix)) {
      return { name, type, attrs: attributes, ignore: true }
    }
  }

  // symlink_ は先頭の型プレフィックスとして解析する
  if (name.startsWith('symlink_')) {
    type = 'symlink'
    name = name.slice('symlink_'.length)
  }

  // literal_ / .literal が出現するまで private_/readonly_/executable_/exact_ を繰り返し解析する
  let isLiteral = false
  let hasChanged = true
  while (hasChanged && !isLiteral) {
    hasChanged = false
    if (name.startsWith('private_')) {
      attributes.private = true
      name = name.slice('private_'.length)
      hasChanged = true
    } else if (name.startsWith('readonly_')) {
      attributes.readonly = true
      name = name.slice('readonly_'.length)
      hasChanged = true
    } else if (name.startsWith('executable_')) {
      attributes.executable = true
      name = name.slice('executable_'.length)
      hasChanged = true
    } else if (name.startsWith('exact_')) {
      attributes.exact = true
      if (type !== 'symlink') {
        type = 'dir'
      }
      name = name.slice('exact_'.length)
      hasChanged = true
    } else if (name.startsWith('literal_')) {
      isLiteral = true
      name = name.slice('literal_'.length)
    } else if (name.endsWith('.literal')) {
      isLiteral = true
      name = name.slice(0, -'.literal'.length)
    }
  }

  // literal 指定が無い場合のみ dot_ → '.' 変換を行う
  if (!isLiteral && name.startsWith('dot_')) {
    name = '.' + name.slice('dot_'.length)
  }

  return { name, type, attrs: attributes, ignore: false }
}

/**
 * ソース相対パス (POSIX 区切り) を実名パスへ解決する。
 * パス中の各セグメントに {@link resolveChezmoiName} を適用し、
 * いずれかのセグメントが ignore 対象であれば全体を ignore とする。
 * @param relativePath ソースディレクトリからの相対パス (POSIX 区切り)
 * @returns 解決結果
 */
export function resolveChezmoiPath(relativePath: string): ResolvedChezmoiPath {
  const segments = relativePath.split('/')
  const targetSegments: string[] = []
  let isIgnored = false
  let type: ChezmoiEntryType = 'file'
  let attributes = defaultAttributes()

  for (const [index, segment] of segments.entries()) {
    const resolved = resolveChezmoiName(segment)
    if (resolved.ignore) {
      isIgnored = true
    }
    targetSegments.push(resolved.name)
    if (index === segments.length - 1) {
      type = resolved.type
      attributes = resolved.attrs
    }
  }

  return {
    targetPath: targetSegments.join('/'),
    type,
    attrs: attributes,
    ignore: isIgnored,
  }
}
