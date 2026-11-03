/**
 * CLI entry point of sync-claude-folder.
 *
 * - `sync [--stage <name>] [--apply] [--config <path>] [--backup-root <path>]`
 *   Computes and prints the source -> dest sync plan for each stage in config.json.
 *   Files are written only when `--apply` is given (dry-run by default).
 */

import * as os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { applyStagePlan, buildTimestamp } from './apply'
import { loadConfig, selectStages, StageConfig } from './config'
import { expandHome } from './fsutil'
import { PlanItem, planStage, StagePlan } from './planner'

// eslint-disable-next-line unicorn/prefer-module -- CommonJS build, so __dirname is used
const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config.json')
const DEFAULT_BACKUP_ROOT = path.join(os.homedir(), '.sync-claude-backup')

/** Prints one plan item on a single line. */
function printPlanItem(item: PlanItem): void {
  const marker: Record<PlanItem['action'], string> = {
    create: '+',
    update: '~',
    delete: '-',
    skip: '=',
  }
  console.log(`  [${marker[item.action]}] ${item.relPath} (${item.reason})`)
}

/** Prints the plan of one stage. */
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
 * Runs the `sync` subcommand.
 * @param configPath Absolute path to config.json
 * @param stageName Target stage name (all stages when omitted)
 * @param apply Writes files only when true
 * @param backupRoot Root directory for backups
 */
export async function runSync(
  configPath: string,
  stageName: string | undefined,
  apply: boolean,
  backupRoot: string
): Promise<void> {
  const config = loadConfig(configPath)
  const stages: StageConfig[] = selectStages(config, stageName)

  console.log(
    apply ? 'Mode: apply (files will be written)' : 'Mode: dry-run (plan only)'
  )
  console.log('')

  const timestamp = buildTimestamp()
  for (const stage of stages) {
    const plan = await planStage(stage)
    printStagePlan(plan)

    const result = await applyStagePlan(plan, {
      apply,
      backupRoot,
      timestamp,
    })
    if (apply) {
      console.log(
        `  applied: created=${result.created}, updated=${result.updated}, deleted=${result.deleted}`
      )
    }
    console.log('')
  }
}

/** Prints CLI usage. */
function printUsage(): void {
  console.log('Usage:')
  console.log(
    '  sync-claude-folder sync [--stage <name>] [--apply] [--config <path>] [--backup-root <path>]'
  )
}

/**
 * Removes the stray leading `--` token forwarded by pnpm before the args reach `parseArgs`.
 *
 * When run through pnpm, as in `pnpm run sync -- --apply`, the `--` itself stays in
 * `process.argv` as a literal element. `util.parseArgs` treats a bare `--` as the end of
 * option parsing and turns every following argument into positionals, so `--apply` would
 * not be recognized as an option and the run would always be a dry-run.
 *
 * Only the first `--` in the array is removed. This keeps the standard `parseArgs` behavior
 * for a literal `"--"` passed as an option value (e.g. `--config --`) and for a second `--`
 * that the user intentionally uses as the "treat everything after this as positional" marker.
 * @param args Raw CLI argument array
 * @returns The arguments without the first `--`
 */
export function stripDoubleDashSeparator(args: string[]): string[] {
  const index = args.indexOf('--')
  return index === -1
    ? args
    : [...args.slice(0, index), ...args.slice(index + 1)]
}

/** CLI entry point. */
async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    args: stripDoubleDashSeparator(process.argv.slice(2)),
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
    ? path.resolve(expandHome(values.config))
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
    default: {
      printUsage()
      process.exitCode = 1
    }
  }
}

// eslint-disable-next-line unicorn/prefer-module -- CommonJS build, so require.main is used
if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
