/**
 * JSON Pointer (RFC 6901) based transform operations (remove / set / merge),
 * implemented without dependencies.
 */

import { TransformOp } from './config'

/** Unescapes a JSON Pointer token (`~1` -> `/`, `~0` -> `~`). */
function unescapeToken(token: string): string {
  return token.replaceAll('~1', '/').replaceAll('~0', '~')
}

/**
 * Splits a JSON Pointer string into tokens.
 * @param pointer JSON Pointer (e.g. `/hooks/Stop`)
 * @returns Tokens (empty array for the root)
 * @throws Error if the pointer does not start with `/`
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
 * Gets the value a JSON Pointer refers to.
 * @param obj Target object
 * @param pointer JSON Pointer
 * @returns The value, or undefined if it does not exist
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
 * Removes the value a JSON Pointer refers to (mutates `obj`).
 * Does nothing if the parent path does not exist.
 * @param obj Target object
 * @param pointer JSON Pointer (the root is not allowed)
 * @throws Error if the root (`""`) is given
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
      // If the parent path is missing, the target does not exist either, so do nothing
      return
    }
    current = next as Record<string, unknown>
  }
  // tokens.length > 0 is guarded above, so the last element always exists
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const lastToken = tokens.at(-1)!
  Reflect.deleteProperty(current, lastToken)
}

/**
 * Sets the value a JSON Pointer refers to (mutates `obj`).
 * Missing intermediate objects are created.
 * @param obj Target object
 * @param pointer JSON Pointer (the root is not allowed)
 * @param value Value to set
 * @throws Error if the root (`""`) is given
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
  // tokens.length > 0 is guarded above, so the last element always exists
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  current[tokens.at(-1)!] = value
}

/** Returns true if the value is a plain object (arrays excluded). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Deep-merges objects recursively without mutating the inputs.
 * Recurses only when both values are objects (arrays excluded); otherwise the source value wins.
 * @param target Base object
 * @param source Object to merge in
 * @returns A new merged object
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
 * Applies transform ops (remove / set / merge) to JSON text in order.
 * @param content JSON text to transform
 * @param ops Operations, applied from the first
 * @returns Formatted JSON text (2-space indent plus trailing newline)
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
