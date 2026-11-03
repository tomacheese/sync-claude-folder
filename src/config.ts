/**
 * Type definitions, loading and validation for the sync config (config.json).
 */

import * as fs from 'node:fs'

/** Transform op that removes the value at a JSON Pointer. */
export interface TransformOpRemove {
  op: 'remove'
  pointer: string
}

/** Transform op that sets a value at a JSON Pointer. */
export interface TransformOpSet {
  op: 'set'
  pointer: string
  value: unknown
}

/** Transform op that deep-merges a value into the root object. */
export interface TransformOpMerge {
  op: 'merge'
  value: Record<string, unknown>
}

/** Union of all transform ops. */
export type TransformOp = TransformOpRemove | TransformOpSet | TransformOpMerge

/** Transform definition for a JSON file. */
export interface JsonTransform {
  /** Real-name path of the transform target (after conversion, POSIX separators). */
  path: string
  type: 'json'
  ops: TransformOp[]
}

/** Configuration of one sync stage. */
export interface StageConfig {
  /** Stage name (the identifier passed to the CLI `--stage` option). */
  name: string
  /** Source directory (`~` expansion supported). */
  source: string
  /** Destination directory (`~` expansion supported). */
  dest: string
  /** When true, source names are converted to real names using chezmoi naming rules. */
  chezmoiNaming: boolean
  /** When true, real-name files within `managed` that no longer exist in the source are deleted. */
  mirror: boolean
  /** Real-name globs to sync and mirror. */
  managed: string[]
  /** Globs ignored on the source side (matched against source names). */
  ignore: string[]
  /** Globs on the dest side excluded from create, update and delete. */
  protected: string[]
  /** Transforms applied when copying. */
  transforms: JsonTransform[]
}

/** Shape of the whole config.json. */
export interface SyncConfig {
  stages: StageConfig[]
}

/** Stage names are used as a backup path segment, so separators and `.` / `..` are not allowed. */
const STAGE_NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/

/**
 * Performs a basic structural validation of config.json.
 * @param value Value straight from JSON.parse
 * @param configPath Path used in error messages
 * @throws Error if the structure is invalid
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
  const seenNames = new Set<string>()
  for (const [index, stage] of config.stages.entries()) {
    const stageConfig = stage as Partial<StageConfig>
    for (const key of ['name', 'source', 'dest'] as const) {
      if (typeof stageConfig[key] !== 'string') {
        throw new TypeError(
          `Invalid config: stages[${index}].${key} must be a string`
        )
      }
    }
    const stageName = String(stageConfig.name)
    if (!STAGE_NAME_PATTERN.test(stageName)) {
      throw new Error(
        `Invalid config: stages[${index}].name "${stageName}" must match ${STAGE_NAME_PATTERN.source}`
      )
    }
    if (seenNames.has(stageName)) {
      throw new Error(
        `Invalid config: stages[${index}].name "${stageName}" is duplicated`
      )
    }
    seenNames.add(stageName)
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
 * Loads config.json and validates its basic structure.
 * @param configPath Absolute path to config.json
 * @returns The loaded config
 * @throws Error if the config is invalid
 */
export function loadConfig(configPath: string): SyncConfig {
  const raw = fs.readFileSync(configPath, 'utf8')
  const json = JSON.parse(raw) as unknown
  validateConfig(json, configPath)
  return json as SyncConfig
}

/**
 * Selects stages from the config by name.
 * @param config Sync config
 * @param stageName Stage name (all stages when omitted)
 * @returns Selected stage configs
 * @throws Error if the named stage does not exist
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
