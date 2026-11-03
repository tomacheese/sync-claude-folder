import * as fs from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import { loadConfig } from './config'

/**
 * Builds a minimal config with stages of the given names.
 * @param names Stage names
 * @returns An object equivalent to config.json
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

describe('loadConfig stage name validation', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-config-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  /**
   * Writes the config to a temp directory and loads it.
   * @param names Stage names
   * @returns The loaded config
   */
  function load(names: string[]): ReturnType<typeof loadConfig> {
    const configPath = path.join(tmpDir, 'config.json')
    fs.writeFileSync(configPath, JSON.stringify(buildConfig(names)))
    return loadConfig(configPath)
  }

  test('accepts valid stage names', () => {
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
  ])('rejects invalid stage name %j', (name, index) => {
    expect(() => load([name])).toThrow(
      `Invalid config: stages[${index}].name "${name}" must match ^[A-Za-z0-9_][A-Za-z0-9._-]*$`
    )
  })

  test('rejects a duplicated stage name, reporting the second occurrence', () => {
    expect(() => load(['stage-a', 'stage-b', 'stage-a'])).toThrow(
      'Invalid config: stages[2].name "stage-a" is duplicated'
    )
  })
})
