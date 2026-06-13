import { resolveChezmoiName, resolveChezmoiPath } from './chezmoi-name'

describe('resolveChezmoiName', () => {
  test('executable_ プレフィックスは除去され、実行属性が付与される', () => {
    const result = resolveChezmoiName('executable_statusline.sh')
    expect(result, 'name は executable_ が除去された名前であること').toEqual({
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

  test('readonly_dot_ は readonly 属性と dot_ 変換が両方適用される', () => {
    const result = resolveChezmoiName('readonly_dot_rtk-hook.sha256')
    expect(result, 'readonly かつ dot_ 変換が適用されること').toEqual({
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

  test('private_ プレフィックスは除去され、private 属性が付与される', () => {
    const result = resolveChezmoiName('private_settings.json')
    expect(result, 'private_ が除去され private 属性が付与されること').toEqual({
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

  test('dot_ プレフィックスは . に変換される', () => {
    const result = resolveChezmoiName('dot_env')
    expect(result.name, 'dot_ が . に変換されること').toBe('.env')
    expect(result.ignore, '通常ファイルは ignore されないこと').toBe(false)
  })

  test('プレフィックスの無い通常名はそのまま返る', () => {
    const result = resolveChezmoiName('CLAUDE.md')
    expect(result, '通常名はそのまま返ること').toEqual({
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

  test('symlink_literal_executable_ は symlink 型で literal 部分が実名になる', () => {
    const result = resolveChezmoiName('symlink_literal_executable_foo.sh')
    expect(result.type, 'symlink_ により symlink 型になること').toBe('symlink')
    expect(
      result.name,
      'literal_ 以降は dot_ 変換等を行わず literal 名になること'
    ).toBe('executable_foo.sh')
    expect(
      result.ignore,
      'chezmoi-name 単体では ignore とせず、config の ignore glob に委ねること'
    ).toBe(false)
  })

  test('.tmpl で終わる名前は ignore される', () => {
    const result = resolveChezmoiName(
      'run_onchange_after_clear-plugin-cache.sh.tmpl'
    )
    expect(result.ignore, '.tmpl は非対応のため ignore されること').toBe(true)
  })

  test('run_once_ プレフィックスは ignore される', () => {
    const result = resolveChezmoiName('run_once_before_test.sh')
    expect(result.ignore, 'run_ プレフィックスは ignore されること').toBe(true)
  })
})

describe('resolveChezmoiPath', () => {
  test('ディレクトリを含むパス全体に dot_ 変換が適用される', () => {
    const result = resolveChezmoiPath('scripts/completion-notify/dot_env')
    expect(result.targetPath, '各セグメントが変換されて結合されること').toBe(
      'scripts/completion-notify/.env'
    )
    expect(result.type).toBe('file')
    expect(result.ignore).toBe(false)
  })

  test('readonly_dot_ を含むパスは末端の属性が反映される', () => {
    const result = resolveChezmoiPath('hooks/readonly_dot_rtk-hook.sha256')
    expect(result.targetPath).toBe('hooks/.rtk-hook.sha256')
    expect(
      result.attrs.readonly,
      '末端セグメントの readonly 属性が反映されること'
    ).toBe(true)
  })

  test('.tmpl を含むパスは全体が ignore される', () => {
    const result = resolveChezmoiPath(
      '.chezmoiscripts/run_onchange_after_clear-plugin-cache.sh.tmpl'
    )
    expect(
      result.ignore,
      '.tmpl セグメントを含む場合は全体が ignore されること'
    ).toBe(true)
  })
})
