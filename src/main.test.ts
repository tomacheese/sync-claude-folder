import { stripDoubleDashSeparator } from './main'

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
