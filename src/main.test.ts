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
  test('pnpm 経由で転送される先頭の孤立した -- を取り除く', () => {
    expect(stripDoubleDashSeparator(['sync', '--', '--apply'])).toEqual([
      'sync',
      '--apply',
    ])
  })

  test('-- が存在しない場合は変化しない', () => {
    expect(stripDoubleDashSeparator(['sync', '--apply'])).toEqual([
      'sync',
      '--apply',
    ])
  })

  test('2 個目以降の -- は取り除かず、通常の終端記号として残す', () => {
    expect(
      stripDoubleDashSeparator(['sync', '--', '--apply', '--', '--stage'])
    ).toEqual(['sync', '--apply', '--', '--stage'])
  })

  test('値そのものに -- を含むオプション値は変化しない', () => {
    expect(
      stripDoubleDashSeparator(['sync', '--config', './--weird.json'])
    ).toEqual(['sync', '--config', './--weird.json'])
  })

  test('先頭の -- を取り除いた後、オプション値として literal な -- は保持する', () => {
    expect(stripDoubleDashSeparator(['sync', '--', '--config', '--'])).toEqual([
      'sync',
      '--config',
      '--',
    ])
  })
})

describe('runSync のバックアップ', () => {
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

  test('複数 stage が同名ファイルを更新しても 1 つの実行 ID 配下に stage ごとのバックアップが残る', async () => {
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
