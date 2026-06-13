/**
 * JSON Pointer (RFC 6901) ベースの transform 操作 (remove / set / merge) を
 * ゼロ依存で実装するモジュール。
 */

import { TransformOp } from './config'

/**
 * JSON Pointer のトークンをアンエスケープする (`~1` → `/`, `~0` → `~`)。
 * @param token エスケープされたトークン
 * @returns アンエスケープ後のトークン
 */
function unescapeToken(token: string): string {
  return token.replaceAll('~1', '/').replaceAll('~0', '~')
}

/**
 * JSON Pointer 文字列をトークン配列へ分解する。
 * @param pointer JSON Pointer (例: `/hooks/Stop`)
 * @returns トークン配列 (ルートの場合は空配列)
 * @throws ポインタが `/` で始まらない場合 Error
 */
function parsePointer(pointer: string): string[] {
  if (pointer === '') {
    return []
  }
  if (!pointer.startsWith('/')) {
    throw new Error(`Invalid JSON Pointer: ${pointer}`)
  }
  return pointer
    .split('/')
    .slice(1)
    .map((token) => unescapeToken(token))
}

/**
 * JSON Pointer が指す値を取得する。
 * @param obj 対象オブジェクト
 * @param pointer JSON Pointer
 * @returns 指す値。存在しない場合は undefined
 */
export function getByPointer(obj: unknown, pointer: string): unknown {
  let current = obj
  for (const token of parsePointer(pointer)) {
    if (current === null || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[token]
  }
  return current
}

/**
 * JSON Pointer が指す値を削除する (破壊的)。
 * 親パスが存在しない場合は何もしない。
 * @param obj 対象オブジェクト
 * @param pointer JSON Pointer (ルートは指定不可)
 * @throws ルート (`""`) を指定した場合 Error
 */
export function removeByPointer(
  obj: Record<string, unknown>,
  pointer: string
): void {
  const tokens = parsePointer(pointer)
  if (tokens.length === 0) {
    throw new Error('Cannot remove the root of a JSON document')
  }
  let current: Record<string, unknown> = obj
  for (let i = 0; i < tokens.length - 1; i++) {
    const next = current[tokens[i]]
    if (typeof next !== 'object' || next === null) {
      // 親パスが存在しない場合は削除対象も存在しないとみなし、何もしない
      return
    }
    current = next as Record<string, unknown>
  }
  // tokens.length > 0 は上でガード済みのため、最後の要素は必ず存在する
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const lastToken = tokens.at(-1)!
  Reflect.deleteProperty(current, lastToken)
}

/**
 * JSON Pointer が指す値を設定する (破壊的)。
 * 中間オブジェクトが存在しない場合は新規作成する。
 * @param obj 対象オブジェクト
 * @param pointer JSON Pointer (ルートは指定不可)
 * @param value 設定する値
 * @throws ルート (`""`) を指定した場合 Error
 */
export function setByPointer(
  obj: Record<string, unknown>,
  pointer: string,
  value: unknown
): void {
  const tokens = parsePointer(pointer)
  if (tokens.length === 0) {
    throw new Error('Cannot set the root of a JSON document')
  }
  let current: Record<string, unknown> = obj
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i]
    const next = current[token]
    if (typeof next !== 'object' || next === null) {
      current[token] = {}
    }
    current = current[token] as Record<string, unknown>
  }
  // tokens.length > 0 は上でガード済みのため、最後の要素は必ず存在する
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  current[tokens.at(-1)!] = value
}

/**
 * 値が配列を除くプレーンオブジェクトかどうかを判定する。
 * @param value 判定対象
 * @returns プレーンオブジェクトの場合 true
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * オブジェクトを再帰的に深いマージする (非破壊)。
 * 両者がオブジェクト (配列を除く) の場合のみ再帰し、それ以外は source の値で上書きする。
 * @param target ベースとなるオブジェクト
 * @param source マージするオブジェクト
 * @returns マージ後の新しいオブジェクト
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>
): T {
  const result: Record<string, unknown> = { ...target }
  for (const [key, value] of Object.entries(source)) {
    const existing = result[key]
    result[key] =
      isPlainObject(value) && isPlainObject(existing)
        ? deepMerge(existing, value)
        : value
  }
  return result as T
}

/**
 * JSON テキストに transform 操作 (remove / set / merge) を順に適用する。
 * @param content 変換対象の JSON テキスト
 * @param ops 適用する操作の配列 (先頭から順に適用)
 * @returns 整形 (2 スペースインデント + 末尾改行) された JSON テキスト
 */
export function applyJsonTransform(
  content: string,
  ops: TransformOp[]
): string {
  let data = JSON.parse(content) as Record<string, unknown>
  for (const op of ops) {
    switch (op.op) {
      case 'remove': {
        removeByPointer(data, op.pointer)
        break
      }
      case 'set': {
        setByPointer(data, op.pointer, op.value)
        break
      }
      case 'merge': {
        data = deepMerge(data, op.value)
        break
      }
    }
  }
  return `${JSON.stringify(data, null, 2)}\n`
}
