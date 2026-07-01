import { stripDoubleDashSeparator } from './main'

describe('stripDoubleDashSeparator', () => {
  test('pnpm 経由で転送される孤立した -- を取り除く', () => {
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

  test('複数箇所に -- があってもすべて取り除く', () => {
    expect(
      stripDoubleDashSeparator(['sync', '--', '--apply', '--', '--stage'])
    ).toEqual(['sync', '--apply', '--stage'])
  })

  test('値そのものに -- を含むオプション値は変化しない', () => {
    expect(
      stripDoubleDashSeparator(['sync', '--config', './--weird.json'])
    ).toEqual(['sync', '--config', './--weird.json'])
  })
})
