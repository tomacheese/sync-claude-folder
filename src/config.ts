/**
 * 同期設定 (config.json) の型定義・読み込み・検証を行うモジュール。
 */

import * as fs from 'node:fs'

/** JSON Pointer を削除する transform 操作 */
export interface TransformOpRemove {
  op: 'remove'
  pointer: string
}

/** JSON Pointer に値を設定する transform 操作 */
export interface TransformOpSet {
  op: 'set'
  pointer: string
  value: unknown
}

/** ルートオブジェクトへ深いマージを行う transform 操作 */
export interface TransformOpMerge {
  op: 'merge'
  value: Record<string, unknown>
}

/** transform 操作の合併型 */
export type TransformOp = TransformOpRemove | TransformOpSet | TransformOpMerge

/** JSON ファイルに対する transform 定義 */
export interface JsonTransform {
  /** transform 対象の実名パス (変換後・POSIX 区切り) */
  path: string
  type: 'json'
  ops: TransformOp[]
}

/** 同期ステージ 1 件の設定 */
export interface StageConfig {
  /** ステージ名 (CLI の --stage で指定する識別子) */
  name: string
  /** 同期元ディレクトリ (`~` 展開対応) */
  source: string
  /** 同期先ディレクトリ (`~` 展開対応) */
  dest: string
  /** true の場合、ソース名を chezmoi 命名規則で実名へ変換する */
  chezmoiNaming: boolean
  /** true の場合、managed 範囲内でソースに存在しない実名ファイルを削除する */
  mirror: boolean
  /** 同期・ミラー対象とする実名 glob 一覧 */
  managed: string[]
  /** ソース側で無視する glob 一覧 (ソース名に対して判定) */
  ignore: string[]
  /** dest 側で create/update/delete のいずれからも除外する glob 一覧 */
  protected: string[]
  /** コピー時に適用する transform 一覧 */
  transforms: JsonTransform[]
}

/** config.json 全体の型 */
export interface SyncConfig {
  stages: StageConfig[]
}

/**
 * config.json の構造を簡易検証する。
 * @param value JSON.parse 直後の値
 * @param configPath エラーメッセージ用のパス
 * @throws 構造が不正な場合 Error
 */
function validateConfig(value: unknown, configPath: string): void {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Invalid config: ${configPath} must contain a JSON object`)
  }
  const config = value as Partial<SyncConfig>
  if (!Array.isArray(config.stages)) {
    throw new TypeError(
      `Invalid config: "stages" must be an array in ${configPath}`
    )
  }
  for (const [index, stage] of config.stages.entries()) {
    const stageConfig = stage as Partial<StageConfig>
    for (const key of ['name', 'source', 'dest'] as const) {
      if (typeof stageConfig[key] !== 'string') {
        throw new TypeError(
          `Invalid config: stages[${index}].${key} must be a string`
        )
      }
    }
    for (const key of ['chezmoiNaming', 'mirror'] as const) {
      if (typeof stageConfig[key] !== 'boolean') {
        throw new TypeError(
          `Invalid config: stages[${index}].${key} must be a boolean`
        )
      }
    }
    for (const key of ['managed', 'ignore', 'protected'] as const) {
      const arr = stageConfig[key]
      if (!Array.isArray(arr)) {
        throw new TypeError(
          `Invalid config: stages[${index}].${key} must be an array`
        )
      }
      for (const [i, item] of arr.entries()) {
        if (typeof item !== 'string') {
          throw new TypeError(
            `Invalid config: stages[${index}].${key}[${i}] must be a string`
          )
        }
      }
    }
    const transforms = stageConfig.transforms
    if (!Array.isArray(transforms)) {
      throw new TypeError(
        `Invalid config: stages[${index}].transforms must be an array`
      )
    }
    for (const [i, t] of transforms.entries()) {
      const transform = t as Partial<JsonTransform>
      if (typeof transform.path !== 'string') {
        throw new TypeError(
          `Invalid config: stages[${index}].transforms[${i}].path must be a string`
        )
      }
      if (transform.type !== 'json') {
        throw new TypeError(
          `Invalid config: stages[${index}].transforms[${i}].type must be "json"`
        )
      }
      if (!Array.isArray(transform.ops)) {
        throw new TypeError(
          `Invalid config: stages[${index}].transforms[${i}].ops must be an array`
        )
      }
    }
  }
}

/**
 * config.json を読み込み、最低限の構造検証を行う。
 * @param configPath config.json への絶対パス
 * @returns 読み込んだ設定
 * @throws 設定が不正な場合 Error
 */
export function loadConfig(configPath: string): SyncConfig {
  const raw = fs.readFileSync(configPath, 'utf8')
  const json = JSON.parse(raw) as unknown
  validateConfig(json, configPath)
  return json as SyncConfig
}

/**
 * 指定したステージ名を config から取得する。
 * @param config 同期設定
 * @param stageName ステージ名 (未指定の場合は全ステージ)
 * @returns ステージ設定の配列
 * @throws 指定したステージ名が存在しない場合 Error
 */
export function selectStages(
  config: SyncConfig,
  stageName?: string
): StageConfig[] {
  if (!stageName) {
    return config.stages
  }
  const stage = config.stages.find((s) => s.name === stageName)
  if (!stage) {
    const names = config.stages.map((s) => s.name).join(', ')
    throw new Error(`Unknown stage: ${stageName} (available: ${names})`)
  }
  return [stage]
}
