import { resolveChezmoiName, resolveChezmoiPath } from './chezmoi-name'

describe('resolveChezmoiName', () => {
  test('executable_ prefix is stripped and the executable attribute is set', () => {
    const result = resolveChezmoiName('executable_statusline.sh')
    expect(result, 'name has executable_ stripped').toEqual({
      name: 'statusline.sh',
      type: 'file',
      attrs: {
        private: false,
        readonly: false,
        executable: true,
        exact: false,
      },
      ignore: false,
    })
  })

  test('readonly_dot_ applies both the readonly attribute and the dot_ conversion', () => {
    const result = resolveChezmoiName('readonly_dot_rtk-hook.sha256')
    expect(result, 'readonly and dot_ conversion are both applied').toEqual({
      name: '.rtk-hook.sha256',
      type: 'file',
      attrs: {
        private: false,
        readonly: true,
        executable: false,
        exact: false,
      },
      ignore: false,
    })
  })

  test('private_ prefix is stripped and the private attribute is set', () => {
    const result = resolveChezmoiName('private_settings.json')
    expect(
      result,
      'private_ is stripped and the private attribute is set'
    ).toEqual({
      name: 'settings.json',
      type: 'file',
      attrs: {
        private: true,
        readonly: false,
        executable: false,
        exact: false,
      },
      ignore: false,
    })
  })

  test('dot_ prefix is converted to .', () => {
    const result = resolveChezmoiName('dot_env')
    expect(result.name, 'dot_ is converted to .').toBe('.env')
    expect(result.ignore, 'regular files are not ignored').toBe(false)
  })

  test('a plain name without prefixes is returned unchanged', () => {
    const result = resolveChezmoiName('CLAUDE.md')
    expect(result, 'a plain name is returned unchanged').toEqual({
      name: 'CLAUDE.md',
      type: 'file',
      attrs: {
        private: false,
        readonly: false,
        executable: false,
        exact: false,
      },
      ignore: false,
    })
  })

  test('symlink_literal_executable_ yields a symlink whose literal part becomes the real name', () => {
    const result = resolveChezmoiName('symlink_literal_executable_foo.sh')
    expect(result.type, 'symlink_ makes the type symlink').toBe('symlink')
    expect(
      result.name,
      'after literal_ no dot_ conversion etc. is applied and the name stays literal'
    ).toBe('executable_foo.sh')
    expect(
      result.ignore,
      'chezmoi-name alone does not ignore it; that is left to the config ignore globs'
    ).toBe(false)
  })

  test('names ending in .tmpl are ignored', () => {
    const result = resolveChezmoiName(
      'run_onchange_after_clear-plugin-cache.sh.tmpl'
    )
    expect(result.ignore, '.tmpl is unsupported, so it is ignored').toBe(true)
  })

  test('run_once_ prefix is ignored', () => {
    const result = resolveChezmoiName('run_once_before_test.sh')
    expect(result.ignore, 'run_ prefix is ignored').toBe(true)
  })
})

describe('resolveChezmoiPath', () => {
  test('dot_ conversion is applied across a whole path with directories', () => {
    const result = resolveChezmoiPath('scripts/completion-notify/dot_env')
    expect(result.targetPath, 'each segment is converted and joined').toBe(
      'scripts/completion-notify/.env'
    )
    expect(result.type).toBe('file')
    expect(result.ignore).toBe(false)
  })

  test('a path containing readonly_dot_ reflects the last segment attributes', () => {
    const result = resolveChezmoiPath('hooks/readonly_dot_rtk-hook.sha256')
    expect(result.targetPath).toBe('hooks/.rtk-hook.sha256')
    expect(
      result.attrs.readonly,
      'the readonly attribute of the last segment is reflected'
    ).toBe(true)
  })

  test('a path containing .tmpl is ignored as a whole', () => {
    const result = resolveChezmoiPath(
      '.chezmoiscripts/run_onchange_after_clear-plugin-cache.sh.tmpl'
    )
    expect(
      result.ignore,
      'the whole path is ignored when it contains a .tmpl segment'
    ).toBe(true)
  })
})
