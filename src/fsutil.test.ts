import fs from 'node:fs/promises'
import * as os from 'node:os'
import path from 'node:path'
import {
  resolveDestinationPath,
  validateDestinationPath,
  walkFiles,
} from './fsutil'

describe('walkFiles safety', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-walk-'))
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('only an explicitly optional missing root is treated as empty', async () => {
    const missing = path.join(tmpDir, 'missing')

    await expect(walkFiles(missing)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(
      walkFiles(missing, { allowMissingRoot: true })
    ).resolves.toEqual([])
  })

  test.each([false, true])(
    'a disappearing descendant aborts traversal with allowMissingRoot=%s',
    async (allowMissingRoot) => {
      await fs.mkdir(path.join(tmpDir, 'child'))
      const readDirectory = fs.readdir
      const error = Object.assign(new Error('child disappeared'), {
        code: 'ENOENT',
      })
      jest
        .spyOn(fs, 'readdir')
        .mockImplementationOnce(readDirectory)
        .mockRejectedValueOnce(error)

      await expect(walkFiles(tmpDir, { allowMissingRoot })).rejects.toBe(error)
    }
  )

  test('an optional root does not hide permission failures', async () => {
    const error = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
    })
    jest.spyOn(fs, 'readdir').mockRejectedValueOnce(error)

    await expect(walkFiles(tmpDir, { allowMissingRoot: true })).rejects.toBe(
      error
    )
  })
})

describe('destination paths', () => {
  let tmpDir: string
  let root: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-containment-'))
    root = path.join(tmpDir, 'dest')
    await fs.mkdir(root)
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test.each([
    '',
    '.',
    '..',
    '../escaped.txt',
    'skills/../../escaped.txt',
    'skills/../escaped.txt',
    'skills/./entry.txt',
    'skills//entry.txt',
    'skills/',
    '/escaped.txt',
    'C:/escaped.txt',
    'C:escaped.txt',
    'skills/C:escaped.txt',
    '\\\\server\\share\\escaped.txt',
    'skills\\..\\escaped.txt',
    'skills/entry\0.txt',
  ])('rejects noncanonical path %j', async (relPath) => {
    await expect(validateDestinationPath(root, relPath)).rejects.toThrow(
      'Invalid destination relative path'
    )
    expect(await fs.readdir(root)).toEqual([])
  })

  test('resolves missing parents without creating them', async () => {
    const absentRoot = path.join(root, 'missing')
    expect(
      await validateDestinationPath(absentRoot, 'skills/nested/entry.txt')
    ).toBe(path.join(absentRoot, 'skills/nested/entry.txt'))
    expect(await fs.readdir(root)).toEqual([])
  })

  test('expands home and relative destination roots', () => {
    expect(resolveDestinationPath('~/dest', 'skills/entry.txt')).toBe(
      path.join(os.homedir(), 'dest/skills/entry.txt')
    )
    expect(resolveDestinationPath('dest', 'skills/entry.txt')).toBe(
      path.resolve('dest/skills/entry.txt')
    )
  })

  test.each(['outside', 'inside', 'missing'])(
    'rejects a parent symlink pointing %s the root',
    async (target) => {
      const targetPath =
        target === 'inside'
          ? path.join(root, target)
          : path.join(tmpDir, target)
      if (target !== 'missing') {
        await fs.mkdir(targetPath)
      }
      await fs.symlink(targetPath, path.join(root, 'skills'))

      await expect(
        validateDestinationPath(root, 'skills/nested/entry.txt')
      ).rejects.toThrow('Destination parent is a symlink')
      expect(await fs.readlink(path.join(root, 'skills'))).toBe(targetPath)
    }
  )

  test('allows the configured root itself to be a symlink', async () => {
    const rootLink = path.join(tmpDir, 'root-link')
    await fs.symlink(root, rootLink)
    expect(await validateDestinationPath(rootLink, 'skills/entry.txt')).toBe(
      path.join(rootLink, 'skills/entry.txt')
    )
  })

  test('does not follow a leaf symlink', async () => {
    await fs.symlink(path.join(tmpDir, 'missing'), path.join(root, 'leaf'))
    expect(await validateDestinationPath(root, 'leaf')).toBe(
      path.join(root, 'leaf')
    )
  })

  test('rejects a regular file used as a parent', async () => {
    await fs.writeFile(path.join(root, 'skills'), 'old')
    await expect(
      validateDestinationPath(root, 'skills/entry.txt')
    ).rejects.toThrow('Destination parent is not a directory')
    expect(await fs.readFile(path.join(root, 'skills'), 'utf8')).toBe('old')
  })

  test('propagates filesystem errors other than ENOENT', async () => {
    const loop = path.join(tmpDir, 'loop')
    await fs.symlink(loop, loop)
    await expect(
      validateDestinationPath(loop, 'skills/entry.txt')
    ).rejects.toMatchObject({ code: 'ELOOP' })
  })
})
