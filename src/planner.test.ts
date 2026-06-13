import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import path from 'node:path'
import { StageConfig } from './config'
import { planStage } from './planner'

/**
 * テスト用にファイルを書き込む (親ディレクトリを自動作成する)。
 * @param filePath 書き込み先の絶対パス
 * @param content 書き込む内容
 */
async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content)
}

describe('planStage', () => {
  let tmpDir: string
  let sourceDir: string
  let destDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-claude-folder-'))
    sourceDir = path.join(tmpDir, 'source')
    destDir = path.join(tmpDir, 'dest')
    await fs.mkdir(sourceDir, { recursive: true })
    await fs.mkdir(destDir, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  function buildStage(overrides: Partial<StageConfig> = {}): StageConfig {
    return {
      name: 'test-stage',
      source: sourceDir,
      dest: destDir,
      chezmoiNaming: true,
      mirror: true,
      managed: ['hooks/**', 'settings.json'],
      ignore: [],
      protected: ['hooks/protected.sh'],
      transforms: [
        {
          path: 'settings.json',
          type: 'json',
          ops: [{ op: 'remove', pointer: '/hooks' }],
        },
      ],
      ...overrides,
    }
  }

  test('新規ファイルは create と判定される', async () => {
    await writeFile(
      path.join(sourceDir, 'hooks', 'executable_foo.sh'),
      'echo hi\n'
    )

    const plan = await planStage(buildStage())
    const item = plan.items.find((i) => i.relPath === 'hooks/foo.sh')

    expect(item, 'hooks/foo.sh の項目が存在すること').toBeDefined()
    expect(item?.action, '新規ファイルは create であること').toBe('create')
    expect(item?.attrs?.executable, 'executable_ 属性が解決されること').toBe(
      true
    )
    expect(item?.content?.toString()).toBe('echo hi\n')
  })

  test('内容が一致するファイルは skip と判定される', async () => {
    await writeFile(path.join(sourceDir, 'hooks', 'bar.sh'), 'echo bar\n')
    await writeFile(path.join(destDir, 'hooks', 'bar.sh'), 'echo bar\n')

    const plan = await planStage(buildStage())
    const item = plan.items.find((i) => i.relPath === 'hooks/bar.sh')

    expect(item?.action, '内容が一致する場合は skip であること').toBe('skip')
  })

  test('内容が異なるファイルは update と判定される', async () => {
    await writeFile(path.join(sourceDir, 'hooks', 'bar.sh'), 'echo new\n')
    await writeFile(path.join(destDir, 'hooks', 'bar.sh'), 'echo old\n')

    const plan = await planStage(buildStage())
    const item = plan.items.find((i) => i.relPath === 'hooks/bar.sh')

    expect(item?.action, '内容が異なる場合は update であること').toBe('update')
  })

  test('transform 適用後の内容で比較・生成される', async () => {
    await writeFile(
      path.join(sourceDir, 'private_settings.json'),
      JSON.stringify({ hooks: { Stop: [] }, theme: 'light' })
    )

    const plan = await planStage(buildStage())
    const item = plan.items.find((i) => i.relPath === 'settings.json')

    expect(item?.action, 'dest に無いため create であること').toBe('create')
    expect(item?.attrs?.private, 'private_ 属性が解決されること').toBe(true)
    expect(
      JSON.parse(item?.content?.toString() ?? '{}'),
      'hooks が remove されていること'
    ).toEqual({
      theme: 'light',
    })
  })

  test('mirror: managed 範囲内でソースに無い実名ファイルは delete と判定される', async () => {
    await writeFile(path.join(destDir, 'hooks', 'old.sh'), 'echo old\n')

    const plan = await planStage(buildStage())
    const item = plan.items.find((i) => i.relPath === 'hooks/old.sh')

    expect(item?.action, 'mirror により delete と判定されること').toBe('delete')
  })

  test('protected はソースに有無を問わず create/update/delete から除外される', async () => {
    // dest にのみ存在する protected ファイル -> mirror 対象でも削除されない
    await writeFile(
      path.join(destDir, 'hooks', 'protected.sh'),
      'echo protected\n'
    )
    // source にも同名ファイルがあるが、protected のため create/update もされない
    await writeFile(
      path.join(sourceDir, 'hooks', 'protected.sh'),
      'echo from source\n'
    )

    const plan = await planStage(buildStage())
    const item = plan.items.find((i) => i.relPath === 'hooks/protected.sh')

    expect(item, 'protected ファイルはプランに含まれないこと').toBeUndefined()
  })

  test('managed に一致しない実名ファイルは削除されない', async () => {
    await writeFile(path.join(destDir, 'unmanaged.txt'), 'keep me\n')

    const plan = await planStage(buildStage())
    const item = plan.items.find((i) => i.relPath === 'unmanaged.txt')

    expect(
      item,
      'managed 範囲外のファイルはプランに含まれないこと'
    ).toBeUndefined()
  })

  test('ignore に一致するソースファイルは対象外になる', async () => {
    await writeFile(
      path.join(sourceDir, 'hooks', 'executable_foo.sh'),
      'echo hi\n'
    )
    await writeFile(
      path.join(sourceDir, 'hooks', 'executable_foo.sh.tmpl'),
      'echo tmpl\n'
    )

    const plan = await planStage(buildStage({ ignore: ['**/*.tmpl'] }))

    expect(
      plan.items.find((i) => i.relPath === 'hooks/foo.sh.tmpl')
    ).toBeUndefined()
    expect(plan.items.find((i) => i.relPath === 'hooks/foo.sh')).toBeDefined()
  })
})
