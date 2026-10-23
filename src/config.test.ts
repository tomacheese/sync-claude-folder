import * as fs from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import { loadConfig } from './config'

/**
 * 指定した名前の stage を持つ最小構成の config を生成する。
 * @param names stage 名の配列
 * @returns config.json 相当のオブジェクト
 */
function buildConfig(names: string[]): { stages: Record<string, unknown>[] } {
  return {
    stages: names.map((name) => ({
      name,
      source: '/tmp/source',
      dest: '/tmp/dest',
      chezmoiNaming: false,
      mirror: false,
      managed: ['**'],
      ignore: [],
      protected: [],
      transforms: [],
    })),
  }
}

describe('loadConfig の stage 名検証', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-config-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  /**
   * config を temp ディレクトリへ書き出して読み込む。
   * @param names stage 名の配列
   * @returns 読み込んだ設定
   */
  function load(names: string[]): ReturnType<typeof loadConfig> {
    const configPath = path.join(tmpDir, 'config.json')
    fs.writeFileSync(configPath, JSON.stringify(buildConfig(names)))
    return loadConfig(configPath)
  }

  test('有効な stage 名を受理する', () => {
    const config = load(['dotfiles-to-claude', 'claude-to-claude-work'])
    expect(config.stages.map((s) => s.name)).toEqual([
      'dotfiles-to-claude',
      'claude-to-claude-work',
    ])
  })

  test.each([
    ['', 0],
    ['.', 0],
    ['..', 0],
    ['a/b', 0],
    [String.raw`a\b`, 0],
    ['.hidden', 0],
    ['with space', 0],
  ])('不正な stage 名 %j を拒否する', (name, index) => {
    expect(() => load([name])).toThrow(
      `Invalid config: stages[${index}].name "${name}" must match ^[A-Za-z0-9_][A-Za-z0-9._-]*$`
    )
  })

  test('重複した stage 名は 2 件目を報告して拒否する', () => {
    expect(() => load(['stage-a', 'stage-b', 'stage-a'])).toThrow(
      'Invalid config: stages[2].name "stage-a" is duplicated'
    )
  })
})
