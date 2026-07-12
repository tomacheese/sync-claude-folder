import {
  applyJsonTransform,
  deepMerge,
  getByPointer,
  removeByPointer,
  setByPointer,
} from './transforms'

describe('getByPointer', () => {
  test('ネストしたパスの値を取得できる', () => {
    const object = { hooks: { Stop: [{ matcher: '' }] } }
    expect(getByPointer(object, '/hooks/Stop/0/matcher')).toBe('')
  })

  test('存在しないパスは undefined を返す', () => {
    const object = { hooks: {} }
    expect(getByPointer(object, '/hooks/Stop')).toBeUndefined()
  })
})

describe('removeByPointer', () => {
  test('指定したキーを削除する', () => {
    const object: Record<string, unknown> = {
      hooks: { Stop: [] },
      theme: 'dark',
    }
    removeByPointer(object, '/hooks')
    expect(object, 'hooks キーが削除され theme は残ること').toEqual({
      theme: 'dark',
    })
  })

  test('親パスが存在しない場合は何もしない', () => {
    const object: Record<string, unknown> = { theme: 'dark' }
    removeByPointer(object, '/hooks/Stop')
    expect(object, '何も変化しないこと').toEqual({ theme: 'dark' })
  })
})

describe('setByPointer', () => {
  test('既存オブジェクトに値を設定する', () => {
    const object: Record<string, unknown> = { theme: 'light' }
    setByPointer(object, '/theme', 'dark-daltonized')
    expect(object.theme).toBe('dark-daltonized')
  })

  test('中間オブジェクトが存在しない場合は新規作成する', () => {
    const object: Record<string, unknown> = {}
    setByPointer(object, '/a/b/c', 1)
    expect(object, '中間オブジェクトが自動生成されること').toEqual({
      a: { b: { c: 1 } },
    })
  })
})

describe('deepMerge', () => {
  test('オブジェクトは再帰的にマージされる', () => {
    const target = { a: { x: 1, y: 2 }, b: 1 }
    const source = { a: { y: 3, z: 4 }, c: 5 }
    expect(deepMerge(target, source)).toEqual({
      a: { x: 1, y: 3, z: 4 },
      b: 1,
      c: 5,
    })
  })

  test('配列は再帰せず source の値で上書きされる', () => {
    const target = { list: [1, 2] }
    const source = { list: [3] }
    expect(deepMerge(target, source)).toEqual({ list: [3] })
  })

  test('target は変更されない (非破壊)', () => {
    const target = { a: { x: 1 } }
    deepMerge(target, { a: { y: 2 } })
    expect(target, '元のオブジェクトは変更されないこと').toEqual({
      a: { x: 1 },
    })
  })
})

describe('applyJsonTransform', () => {
  test('remove → set → merge の順に適用される', () => {
    const content = JSON.stringify({
      hooks: { Stop: [] },
      theme: 'light',
      env: { A: '1' },
    })
    const result = applyJsonTransform(content, [
      { op: 'remove', pointer: '/hooks' },
      { op: 'set', pointer: '/theme', value: 'dark-daltonized' },
      { op: 'merge', value: { tui: 'fullscreen', env: { B: '2' } } },
    ])
    expect(JSON.parse(result)).toEqual({
      theme: 'dark-daltonized',
      env: { A: '1', B: '2' },
      tui: 'fullscreen',
    })
  })

  test('2 スペースインデント + 末尾改行で整形される', () => {
    const result = applyJsonTransform('{"a":1}', [])
    expect(result).toBe('{\n  "a": 1\n}\n')
  })
})
