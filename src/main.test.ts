import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import path from 'node:path'
import { buildTimestamp } from './apply'
import { runSync, stripDoubleDashSeparator } from './main'

jest.mock('./apply', () => ({
  ...jest.requireActual<typeof import('./apply')>('./apply'),
  buildTimestamp: jest.fn(),
}))

describe('stripDoubleDashSeparator', () => {
  test('removes the stray leading -- forwarded via pnpm', () => {
    expect(stripDoubleDashSeparator(['sync', '--', '--apply'])).toEqual([
      'sync',
      '--apply',
    ])
  })

  test('is unchanged when there is no --', () => {
    expect(stripDoubleDashSeparator(['sync', '--apply'])).toEqual([
      'sync',
      '--apply',
    ])
  })

  test('keeps the second and later -- as ordinary terminators', () => {
    expect(
      stripDoubleDashSeparator(['sync', '--', '--apply', '--', '--stage'])
    ).toEqual(['sync', '--apply', '--', '--stage'])
  })

  test('an option value containing -- is unchanged', () => {
    expect(
      stripDoubleDashSeparator(['sync', '--config', './--weird.json'])
    ).toEqual(['sync', '--config', './--weird.json'])
  })

  test('after removing the leading --, a literal -- option value is preserved', () => {
    expect(stripDoubleDashSeparator(['sync', '--', '--config', '--'])).toEqual([
      'sync',
      '--config',
      '--',
    ])
  })
})

describe('runSync backups', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-main-'))
    let counter = 0
    jest.mocked(buildTimestamp).mockImplementation(() => {
      counter++
      return `20260101T00000${counter}`
    })
    jest.spyOn(console, 'log').mockReturnValue()
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    jest.mocked(buildTimestamp).mockReset()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('per-stage backups are kept under a single run ID when multiple stages update the same file', async () => {
    const source = path.join(tmpDir, 'source')
    await fs.mkdir(source)
    await fs.writeFile(path.join(source, 'settings.json'), 'new')

    const stages = ['stage-a', 'stage-b'].map((name) => ({
      name,
      source,
      dest: path.join(tmpDir, name),
      chezmoiNaming: false,
      mirror: false,
      managed: ['settings.json'],
      ignore: [],
      protected: [],
      transforms: [],
    }))
    for (const stage of stages) {
      await fs.mkdir(stage.dest)
      await fs.writeFile(
        path.join(stage.dest, 'settings.json'),
        `old-${stage.name}`
      )
    }
    const configPath = path.join(tmpDir, 'config.json')
    await fs.writeFile(configPath, JSON.stringify({ stages }))
    const backupRoot = path.join(tmpDir, 'backup')

    await runSync(configPath, undefined, true, backupRoot)

    expect(buildTimestamp).toHaveBeenCalledTimes(1)
    expect(await fs.readdir(backupRoot)).toEqual(['20260101T000001'])
    const runDir = path.join(backupRoot, '20260101T000001')
    const stageDirs = await fs.readdir(runDir)
    expect(stageDirs.toSorted((a, b) => a.localeCompare(b))).toEqual([
      'stage-a',
      'stage-b',
    ])
    for (const stage of stages) {
      expect(
        await fs.readFile(
          path.join(runDir, stage.name, 'settings.json'),
          'utf8'
        )
      ).toBe(`old-${stage.name}`)
      expect(
        await fs.readFile(path.join(stage.dest, 'settings.json'), 'utf8')
      ).toBe('new')
    }
  })
})
