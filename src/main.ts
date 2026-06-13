/**
 * sync-claude-folder の CLI エントリポイント。
 *
 * - `sync [--stage <name>] [--apply] [--config <path>]`
 *   config.json の各ステージに従い、ソース → dest の同期プランを算出・表示する。
 *   `--apply` を指定した場合のみ実際にファイルを書き込む (既定は dry-run)。
 * - `migrate-claude [--apply] [--backup-root <path>] [--config <path>]`
 *   `~/.claude` がソースリポジトリへのジャンクションである状態から実ディレクトリへ
 *   一回限りで完全移行する。`--apply` を指定した場合のみ実行する (既定は dry-run)。
 */

import * as os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { applyStagePlan } from './apply'
import { loadConfig, selectStages, StageConfig } from './config'
import { expandHome } from './fsutil'
import { applyMigration, planMigration } from './migrate'
import { PlanItem, planStage, StagePlan } from './planner'

// eslint-disable-next-line unicorn/prefer-module -- CommonJS 構成のため __dirname を使用する
const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config.json')
const DEFAULT_BACKUP_ROOT = path.join(os.homedir(), '.sync-claude-backup')

/**
 * プラン項目 1 件を 1 行で表示する。
 * @param item プラン項目
 */
function printPlanItem(item: PlanItem): void {
  const marker: Record<PlanItem['action'], string> = {
    create: '+',
    update: '~',
    delete: '-',
    skip: '=',
  }
  console.log(`  [${marker[item.action]}] ${item.relPath} (${item.reason})`)
}

/**
 * 1 ステージ分のプランを表示する。
 * @param plan ステージプラン
 */
function printStagePlan(plan: StagePlan): void {
  console.log(`Stage: ${plan.stage.name}`)
  console.log(`  source: ${plan.stage.source}`)
  console.log(`  dest:   ${plan.stage.dest}`)

  const sorted = [...plan.items].toSorted((a, b) =>
    a.relPath.localeCompare(b.relPath)
  )
  for (const item of sorted) {
    if (item.action === 'skip') {
      continue
    }
    printPlanItem(item)
  }

  const counts = { create: 0, update: 0, delete: 0, skip: 0 }
  for (const item of plan.items) {
    counts[item.action]++
  }
  console.log(
    `  summary: create=${counts.create}, update=${counts.update}, delete=${counts.delete}, skip=${counts.skip}`
  )
}

/**
 * `sync` サブコマンドを実行する。
 * @param configPath config.json への絶対パス
 * @param stageName 対象ステージ名 (未指定の場合は全ステージ)
 * @param apply true の場合のみ実際にファイルを書き込む
 * @param backupRoot バックアップ先ルートディレクトリ
 */
async function runSync(
  configPath: string,
  stageName: string | undefined,
  apply: boolean,
  backupRoot: string
): Promise<void> {
  const config = loadConfig(configPath)
  const stages: StageConfig[] = selectStages(config, stageName)

  console.log(
    apply
      ? 'Mode: apply (ファイルを書き込みます)'
      : 'Mode: dry-run (計画のみ表示します)'
  )
  console.log('')

  for (const stage of stages) {
    const plan = await planStage(stage)
    printStagePlan(plan)

    const result = await applyStagePlan(plan, { apply, backupRoot })
    if (apply) {
      console.log(
        `  applied: created=${result.created}, updated=${result.updated}, deleted=${result.deleted}`
      )
    }
    console.log('')
  }
}

/**
 * `migrate-claude` サブコマンドを実行する。
 * @param configPath config.json への絶対パス (stage1 の source/dest を利用する)
 * @param apply true の場合のみ実際に移行を実行する
 * @param backupRoot バックアップ先ルートディレクトリ
 */
async function runMigrate(
  configPath: string,
  apply: boolean,
  backupRoot: string
): Promise<void> {
  const config = loadConfig(configPath)
  if (config.stages.length === 0) {
    throw new Error('No stages defined in config.json')
  }
  const [firstStage] = config.stages

  const claudeDir = expandHome(firstStage.dest)
  const sourceDir = expandHome(firstStage.source)

  const plan = await planMigration(claudeDir, sourceDir, backupRoot)

  console.log(
    apply
      ? 'Mode: apply (移行を実行します)'
      : 'Mode: dry-run (計画のみ表示します)'
  )
  console.log('')
  console.log(`claude dir: ${plan.claudeDir}`)
  console.log(`source dir: ${plan.sourceDir}`)
  console.log(`backup dir: ${plan.backupDir}`)
  console.log('')

  if (plan.alreadyMigrated) {
    console.log(
      `${plan.claudeDir} はソースディレクトリへのジャンクション/シンボリックリンクではありません。移行は不要、または既に完了しています。`
    )
    return
  }

  console.log('source dir に残すエントリ (chezmoi ソース):')
  for (const entry of plan.sourceEntries.toSorted()) {
    console.log(`  = ${entry}`)
  }
  console.log('')
  console.log('claude dir へ移動するエントリ (ランタイム/認証):')
  for (const entry of plan.runtimeEntries.toSorted()) {
    console.log(`  > ${entry}`)
  }
  console.log('')

  await applyMigration(plan, { apply })

  if (apply) {
    console.log(
      '移行が完了しました。続けて `sync --stage dotfiles-to-claude --apply` を実行してください。'
    )
  }
}

/** CLI の使い方を表示する */
function printUsage(): void {
  console.log('Usage:')
  console.log(
    '  sync-claude-folder sync [--stage <name>] [--apply] [--config <path>] [--backup-root <path>]'
  )
  console.log(
    '  sync-claude-folder migrate-claude [--apply] [--config <path>] [--backup-root <path>]'
  )
}

/** CLI のエントリポイント */
async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      config: { type: 'string' },
      stage: { type: 'string' },
      apply: { type: 'boolean', default: false },
      'backup-root': { type: 'string' },
    },
  })

  const command = positionals[0]
  const configPath = values.config
    ? path.resolve(values.config)
    : DEFAULT_CONFIG_PATH
  const backupRoot = values['backup-root']
    ? path.resolve(expandHome(values['backup-root']))
    : DEFAULT_BACKUP_ROOT
  const apply = values.apply

  switch (command) {
    case 'sync': {
      await runSync(configPath, values.stage, apply, backupRoot)
      return
    }
    case 'migrate-claude': {
      await runMigrate(configPath, apply, backupRoot)
      return
    }
    default: {
      printUsage()
      process.exitCode = 1
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
