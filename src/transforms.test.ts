import {
  applyJsonTransform,
  deepMerge,
  getByPointer,
  removeByPointer,
  setByPointer,
} from './transforms'

describe('getByPointer', () => {
  test('gets a value at a nested path', () => {
    const obj = { hooks: { Stop: [{ matcher: '' }] } }
    expect(getByPointer(obj, '/hooks/Stop/0/matcher')).toBe('')
  })

  test('returns undefined for a missing path', () => {
    const obj = { hooks: {} }
    expect(getByPointer(obj, '/hooks/Stop')).toBeUndefined()
  })
})

describe('removeByPointer', () => {
  test('removes the given key', () => {
    const obj: Record<string, unknown> = { hooks: { Stop: [] }, theme: 'dark' }
    removeByPointer(obj, '/hooks')
    expect(obj, 'the hooks key is removed and theme remains').toEqual({
      theme: 'dark',
    })
  })

  test('does nothing when the parent path is missing', () => {
    const obj: Record<string, unknown> = { theme: 'dark' }
    removeByPointer(obj, '/hooks/Stop')
    expect(obj, 'nothing changes').toEqual({ theme: 'dark' })
  })
})

describe('setByPointer', () => {
  test('sets a value on an existing object', () => {
    const obj: Record<string, unknown> = { theme: 'light' }
    setByPointer(obj, '/theme', 'dark-daltonized')
    expect(obj.theme).toBe('dark-daltonized')
  })

  test('creates missing intermediate objects', () => {
    const obj: Record<string, unknown> = {}
    setByPointer(obj, '/a/b/c', 1)
    expect(obj, 'intermediate objects are created automatically').toEqual({
      a: { b: { c: 1 } },
    })
  })
})

describe('deepMerge', () => {
  test('objects are merged recursively', () => {
    const target = { a: { x: 1, y: 2 }, b: 1 }
    const source = { a: { y: 3, z: 4 }, c: 5 }
    expect(deepMerge(target, source)).toEqual({
      a: { x: 1, y: 3, z: 4 },
      b: 1,
      c: 5,
    })
  })

  test('arrays are not recursed into and are overwritten by the source value', () => {
    const target = { list: [1, 2] }
    const source = { list: [3] }
    expect(deepMerge(target, source)).toEqual({ list: [3] })
  })

  test('target is not modified (non-destructive)', () => {
    const target = { a: { x: 1 } }
    deepMerge(target, { a: { y: 2 } })
    expect(target, 'the original object is not modified').toEqual({
      a: { x: 1 },
    })
  })
})

describe('applyJsonTransform', () => {
  test('applies remove -> set -> merge in order', () => {
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

  test('formats with 2-space indent and a trailing newline', () => {
    const result = applyJsonTransform('{"a":1}', [])
    expect(result).toBe('{\n  "a": 1\n}\n')
  })
})
