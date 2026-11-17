import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import path from 'node:path'
import { StageConfig } from './config'
import { planStage } from './planner'

/**
 * Writes a file for tests (creating parent directories).
 * @param filePath Absolute path to write to
 * @param content Content to write
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

  test.each([true, false])(
    'a missing source aborts planning when mirror is %s',
    async (mirror) => {
      await fs.rm(sourceDir, { recursive: true })
      await writeFile(path.join(destDir, 'keep.txt'), 'keep me')

      await expect(
        planStage(buildStage({ mirror, managed: ['**'] }))
      ).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await fs.readFile(path.join(destDir, 'keep.txt'), 'utf8')).toBe(
        'keep me'
      )
    }
  )

  test('a non-directory source aborts planning', async () => {
    await fs.rm(sourceDir, { recursive: true })
    await fs.writeFile(sourceDir, 'not a directory')

    await expect(planStage(buildStage())).rejects.toMatchObject({
      code: 'ENOTDIR',
    })
  })

  test('a missing destination still permits creating source files', async () => {
    await fs.rm(destDir, { recursive: true })
    await writeFile(path.join(sourceDir, 'hooks', 'new.sh'), 'new')

    const plan = await planStage(buildStage())

    expect(
      plan.items.map(({ relPath, action }) => ({ relPath, action }))
    ).toEqual([{ relPath: 'hooks/new.sh', action: 'create' }])
  })

  test.each([
    ['file', 'skills/token.txt'],
    ['symlink', 'skills/token.txt'],
    ['file', 'skills/**/token.*'],
    ['symlink', '**/token.*'],
  ])(
    'a %s cannot replace a directory containing a protected entry matched by %s',
    async (type, pattern) => {
      await writeFile(path.join(destDir, 'skills', 'token.txt'), 'secret')
      if (type === 'symlink') {
        await fs.symlink('replacement-target', path.join(sourceDir, 'skills'))
      } else {
        await writeFile(path.join(sourceDir, 'skills'), 'replacement')
      }

      await expect(
        planStage(
          buildStage({
            chezmoiNaming: false,
            managed: ['skills'],
            protected: [pattern],
          })
        )
      ).rejects.toThrow(
        'Cannot replace directory "skills": protected entry "skills/token.txt" would be removed'
      )
    }
  )

  test('a protected empty directory blocks replacement of its ancestor', async () => {
    await fs.mkdir(path.join(destDir, 'skills', 'private'), { recursive: true })
    await writeFile(path.join(sourceDir, 'skills'), 'replacement')

    await expect(
      planStage(
        buildStage({ managed: ['skills'], protected: ['skills/private'] })
      )
    ).rejects.toThrow('protected entry "skills/private" would be removed')
  })

  test('a protected dangling symlink blocks replacement of its ancestor', async () => {
    await fs.mkdir(path.join(destDir, 'skills'))
    await fs.symlink(
      'missing-target',
      path.join(destDir, 'skills', 'token.txt')
    )
    await writeFile(path.join(sourceDir, 'skills'), 'replacement')

    await expect(
      planStage(
        buildStage({ managed: ['skills'], protected: ['skills/token.txt'] })
      )
    ).rejects.toThrow('protected entry "skills/token.txt" would be removed')
  })

  test('unprotected directories can still be replaced', async () => {
    await writeFile(path.join(destDir, 'skills', 'old.txt'), 'old')
    await writeFile(path.join(sourceDir, 'skills'), 'replacement')

    const plan = await planStage(
      buildStage({ managed: ['skills'], protected: ['skills/token.txt'] })
    )

    expect(
      plan.items.map(({ relPath, action }) => ({ relPath, action }))
    ).toEqual([{ relPath: 'skills', action: 'update' }])
  })

  test.each([
    'skills/literal_../literal_../escaped.txt',
    'skills/literal_../escaped.txt',
    'skills/literal_./entry.txt',
    'skills/literal_/entry.txt',
    'skills/literal_..',
  ])(
    'rejects unsafe mapped path %s before glob matching',
    async (sourcePath) => {
      await writeFile(path.join(sourceDir, sourcePath), 'new')
      await writeFile(path.join(tmpDir, 'escaped.txt'), 'outside-old')
      await writeFile(path.join(destDir, 'escaped.txt'), 'protected-old')

      await expect(
        planStage(
          buildStage({ managed: ['skills/**'], protected: ['escaped.txt'] })
        )
      ).rejects.toThrow('Invalid destination relative path')

      expect(await fs.readFile(path.join(tmpDir, 'escaped.txt'), 'utf8')).toBe(
        'outside-old'
      )
      expect(await fs.readFile(path.join(destDir, 'escaped.txt'), 'utf8')).toBe(
        'protected-old'
      )
    }
  )

  test('rejects a destination parent symlink before comparing outside files', async () => {
    const outside = path.join(tmpDir, 'dest-outside')
    await writeFile(path.join(sourceDir, 'skills/entry.txt'), 'new')
    await writeFile(path.join(outside, 'entry.txt'), 'outside-old')
    await fs.symlink(outside, path.join(destDir, 'skills'))

    await expect(
      planStage(buildStage({ managed: ['skills/**'] }))
    ).rejects.toThrow('Destination parent is a symlink')
    expect(await fs.readFile(path.join(outside, 'entry.txt'), 'utf8')).toBe(
      'outside-old'
    )
  })

  test('a new file is planned as create', async () => {
    await writeFile(
      path.join(sourceDir, 'hooks', 'executable_foo.sh'),
      'echo hi\n'
    )

    const plan = await planStage(buildStage())
    const item = plan.items.find((i) => i.relPath === 'hooks/foo.sh')

    expect(item, 'an item for hooks/foo.sh exists').toBeDefined()
    expect(item?.action, 'a new file is create').toBe('create')
    expect(
      item?.attrs?.executable,
      'the executable_ attribute is resolved'
    ).toBe(true)
    expect(item?.content?.toString()).toBe('echo hi\n')
  })

  test('a file with identical content is planned as skip', async () => {
    await writeFile(path.join(sourceDir, 'hooks', 'bar.sh'), 'echo bar\n')
    await writeFile(path.join(destDir, 'hooks', 'bar.sh'), 'echo bar\n')

    const plan = await planStage(buildStage())
    const item = plan.items.find((i) => i.relPath === 'hooks/bar.sh')

    expect(item?.action, 'identical content is skip').toBe('skip')
  })

  test('a file with different content is planned as update', async () => {
    await writeFile(path.join(sourceDir, 'hooks', 'bar.sh'), 'echo new\n')
    await writeFile(path.join(destDir, 'hooks', 'bar.sh'), 'echo old\n')

    const plan = await planStage(buildStage())
    const item = plan.items.find((i) => i.relPath === 'hooks/bar.sh')

    expect(item?.action, 'different content is update').toBe('update')
  })

  test('comparison and generation use the content after transforms', async () => {
    await writeFile(
      path.join(sourceDir, 'private_settings.json'),
      JSON.stringify({ hooks: { Stop: [] }, theme: 'light' })
    )

    const plan = await planStage(buildStage())
    const item = plan.items.find((i) => i.relPath === 'settings.json')

    expect(item?.action, 'create because it is missing from dest').toBe(
      'create'
    )
    expect(item?.attrs?.private, 'the private_ attribute is resolved').toBe(
      true
    )
    expect(
      JSON.parse(item?.content?.toString() ?? '{}'),
      'hooks is removed'
    ).toEqual({
      theme: 'light',
    })
  })

  test('mirror: a real-name file within managed that is not in the source is planned as delete', async () => {
    await writeFile(path.join(destDir, 'hooks', 'old.sh'), 'echo old\n')

    const plan = await planStage(buildStage())
    const item = plan.items.find((i) => i.relPath === 'hooks/old.sh')

    expect(item?.action, 'delete because of mirror').toBe('delete')
  })

  test('protected is excluded from create/update/delete whether or not it exists in the source', async () => {
    // A protected file only in dest is not deleted even though mirror applies
    await writeFile(
      path.join(destDir, 'hooks', 'protected.sh'),
      'echo protected\n'
    )
    // A same-named file also exists in source, but protected prevents create/update
    await writeFile(
      path.join(sourceDir, 'hooks', 'protected.sh'),
      'echo from source\n'
    )

    const plan = await planStage(buildStage())
    const item = plan.items.find((i) => i.relPath === 'hooks/protected.sh')

    expect(item, 'protected files are not in the plan').toBeUndefined()
  })

  test('real-name files not matching managed are not deleted', async () => {
    await writeFile(path.join(destDir, 'unmanaged.txt'), 'keep me\n')

    const plan = await planStage(buildStage())
    const item = plan.items.find((i) => i.relPath === 'unmanaged.txt')

    expect(item, 'files outside managed are not in the plan').toBeUndefined()
  })

  test('with mirror: false, files only in dest are not deleted', async () => {
    await writeFile(path.join(destDir, 'hooks', 'old.sh'), 'echo old\n')

    const plan = await planStage(buildStage({ mirror: false }))
    const item = plan.items.find((i) => i.relPath === 'hooks/old.sh')

    expect(
      item,
      'with mirror: false, extra files are not deleted even within managed'
    ).toBeUndefined()
  })

  test('source files matching ignore are excluded', async () => {
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
