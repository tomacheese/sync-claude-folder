import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import path from 'node:path'
import { applyStagePlan } from './apply'
import { StageConfig } from './config'
import { PlanItem, StagePlan } from './planner'

const TIMESTAMP = '20260101T000000'

describe('applyStagePlan backups', () => {
  let tmpDir: string
  let backupRoot: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-apply-'))
    backupRoot = path.join(tmpDir, 'backup')
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  /**
   * Builds a StagePlan for tests.
   * @param name Stage name
   * @param items Plan items
   * @returns StagePlan
   */
  function buildPlan(name: string, items: PlanItem[]): StagePlan {
    const stage: StageConfig = {
      name,
      source: path.join(tmpDir, 'source'),
      dest: path.join(tmpDir, name),
      chezmoiNaming: false,
      mirror: false,
      managed: ['**'],
      ignore: [],
      protected: [],
      transforms: [],
    }
    return { stage, items }
  }

  /**
   * Builds an update item for a regular file.
   * @param name Stage name
   * @param relPath Path relative to dest
   * @param content Content to write
   * @returns Plan item
   */
  function updateItem(
    name: string,
    relPath: string,
    content: string
  ): PlanItem {
    return {
      relPath,
      action: 'update',
      type: 'file',
      destPath: path.join(tmpDir, name, relPath),
      content: Buffer.from(content),
      reason: 'test',
    }
  }

  /**
   * Creates a file on the dest side.
   * @param name Stage name
   * @param relPath Path relative to dest
   * @param content File content
   */
  async function writeDest(
    name: string,
    relPath: string,
    content: string
  ): Promise<void> {
    const filePath = path.join(tmpDir, name, relPath)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content)
  }

  const options = (): {
    apply: boolean
    backupRoot: string
    timestamp: string
  } => ({
    apply: true,
    backupRoot,
    timestamp: TIMESTAMP,
  })

  test('backups are separated per stage when multiple stages update the same relPath', async () => {
    await writeDest('stage-a', 'settings.json', 'old-a')
    await writeDest('stage-b', 'settings.json', 'old-b')

    await applyStagePlan(
      buildPlan('stage-a', [updateItem('stage-a', 'settings.json', 'new-a')]),
      options()
    )
    await applyStagePlan(
      buildPlan('stage-b', [updateItem('stage-b', 'settings.json', 'new-b')]),
      options()
    )

    const base = path.join(backupRoot, TIMESTAMP)
    expect(
      await fs.readFile(path.join(base, 'stage-a', 'settings.json'), 'utf8')
    ).toBe('old-a')
    expect(
      await fs.readFile(path.join(base, 'stage-b', 'settings.json'), 'utf8')
    ).toBe('old-b')
    await expect(fs.lstat(path.join(base, 'settings.json'))).rejects.toThrow()
    expect(
      await fs.readFile(path.join(tmpDir, 'stage-a', 'settings.json'), 'utf8')
    ).toBe('new-a')
    expect(
      await fs.readFile(path.join(tmpDir, 'stage-b', 'settings.json'), 'utf8')
    ).toBe('new-b')
  })

  test('backups are separated per stage on delete as well', async () => {
    await writeDest('stage-a', 'settings.json', 'old-a')
    await writeDest('stage-b', 'settings.json', 'old-b')
    const deleteItem = (name: string): PlanItem => ({
      relPath: 'settings.json',
      action: 'delete',
      type: 'file',
      destPath: path.join(tmpDir, name, 'settings.json'),
      reason: 'test',
    })

    await applyStagePlan(
      buildPlan('stage-a', [deleteItem('stage-a')]),
      options()
    )
    await applyStagePlan(
      buildPlan('stage-b', [deleteItem('stage-b')]),
      options()
    )

    const base = path.join(backupRoot, TIMESTAMP)
    expect(
      await fs.readFile(path.join(base, 'stage-a', 'settings.json'), 'utf8')
    ).toBe('old-a')
    expect(
      await fs.readFile(path.join(base, 'stage-b', 'settings.json'), 'utf8')
    ).toBe('old-b')
    await expect(
      fs.lstat(path.join(tmpDir, 'stage-a', 'settings.json'))
    ).rejects.toThrow()
  })

  test('link targets are saved per stage when multiple stages update a same-named relPath whose dest is a symlink', async () => {
    for (const name of ['stage-a', 'stage-b']) {
      await fs.mkdir(path.join(tmpDir, name), { recursive: true })
      await fs.symlink(
        `old-target-${name}`,
        path.join(tmpDir, name, 'link.json')
      )
    }

    for (const name of ['stage-a', 'stage-b']) {
      await applyStagePlan(
        buildPlan(name, [
          {
            relPath: 'link.json',
            action: 'update',
            type: 'symlink',
            destPath: path.join(tmpDir, name, 'link.json'),
            symlinkTarget: `new-target-${name}`,
            reason: 'test',
          },
        ]),
        options()
      )
    }

    const base = path.join(backupRoot, TIMESTAMP)
    expect(await fs.readlink(path.join(base, 'stage-a', 'link.json'))).toBe(
      'old-target-stage-a'
    )
    expect(await fs.readlink(path.join(base, 'stage-b', 'link.json'))).toBe(
      'old-target-stage-b'
    )
    expect(await fs.readlink(path.join(tmpDir, 'stage-a', 'link.json'))).toBe(
      'new-target-stage-a'
    )
  })

  describe('aborts without overwriting when a backup already exists', () => {
    const backupFile = (): string =>
      path.join(backupRoot, TIMESTAMP, 'stage-a', 'settings.json')

    /**
     * Places a regular file at the existing backup location.
     */
    async function seedBackupFile(): Promise<void> {
      await fs.mkdir(path.dirname(backupFile()), { recursive: true })
      await fs.writeFile(backupFile(), 'existing-backup')
    }

    test('dest is a regular file', async () => {
      await writeDest('stage-a', 'settings.json', 'old-a')
      await seedBackupFile()

      await expect(
        applyStagePlan(
          buildPlan('stage-a', [
            updateItem('stage-a', 'settings.json', 'new-a'),
          ]),
          options()
        )
      ).rejects.toThrow(`Backup destination already exists: ${backupFile()}`)

      expect(await fs.readFile(backupFile(), 'utf8')).toBe('existing-backup')
      expect(
        await fs.readFile(path.join(tmpDir, 'stage-a', 'settings.json'), 'utf8')
      ).toBe('old-a')
    })

    test('dest is a directory', async () => {
      await writeDest('stage-a', 'settings.json/inner.txt', 'inner')
      await seedBackupFile()

      await expect(
        applyStagePlan(
          buildPlan('stage-a', [
            updateItem('stage-a', 'settings.json', 'new-a'),
          ]),
          options()
        )
      ).rejects.toThrow(`Backup destination already exists: ${backupFile()}`)

      expect(await fs.readFile(backupFile(), 'utf8')).toBe('existing-backup')
      expect(
        await fs.readFile(
          path.join(tmpDir, 'stage-a', 'settings.json', 'inner.txt'),
          'utf8'
        )
      ).toBe('inner')
    })

    test('dest is a directory and the existing backup is an empty directory', async () => {
      await writeDest('stage-a', 'settings.json/inner.txt', 'inner')
      await fs.mkdir(backupFile(), { recursive: true })

      await expect(
        applyStagePlan(
          buildPlan('stage-a', [
            updateItem('stage-a', 'settings.json', 'new-a'),
          ]),
          options()
        )
      ).rejects.toThrow(`Backup destination already exists: ${backupFile()}`)

      expect(await fs.readdir(backupFile())).toEqual([])
      expect(
        await fs.readFile(
          path.join(tmpDir, 'stage-a', 'settings.json', 'inner.txt'),
          'utf8'
        )
      ).toBe('inner')
    })

    test('dest is a symlink', async () => {
      await fs.mkdir(path.join(tmpDir, 'stage-a'), { recursive: true })
      await fs.symlink(
        'old-target',
        path.join(tmpDir, 'stage-a', 'settings.json')
      )
      await seedBackupFile()

      await expect(
        applyStagePlan(
          buildPlan('stage-a', [
            updateItem('stage-a', 'settings.json', 'new-a'),
          ]),
          options()
        )
      ).rejects.toThrow(`Backup destination already exists: ${backupFile()}`)

      expect(await fs.readFile(backupFile(), 'utf8')).toBe('existing-backup')
      expect(
        await fs.readlink(path.join(tmpDir, 'stage-a', 'settings.json'))
      ).toBe('old-target')
    })

    test('the existing backup is a dangling symlink', async () => {
      await writeDest('stage-a', 'settings.json', 'old-a')
      await fs.mkdir(path.dirname(backupFile()), { recursive: true })
      await fs.symlink('missing-target', backupFile())

      await expect(
        applyStagePlan(
          buildPlan('stage-a', [
            updateItem('stage-a', 'settings.json', 'new-a'),
          ]),
          options()
        )
      ).rejects.toThrow(`Backup destination already exists: ${backupFile()}`)

      expect(await fs.readlink(backupFile())).toBe('missing-target')
      expect(
        await fs.readFile(path.join(tmpDir, 'stage-a', 'settings.json'), 'utf8')
      ).toBe('old-a')
    })
  })

  test('no backup is created when creating a new file (dest does not exist)', async () => {
    const item: PlanItem = {
      ...updateItem('stage-a', 'settings.json', 'new-a'),
      action: 'create',
    }

    await applyStagePlan(buildPlan('stage-a', [item]), options())

    await expect(fs.lstat(backupRoot)).rejects.toThrow()
    expect(
      await fs.readFile(path.join(tmpDir, 'stage-a', 'settings.json'), 'utf8')
    ).toBe('new-a')
  })

  test('neither backup nor dest changes happen when apply is false', async () => {
    await writeDest('stage-a', 'settings.json', 'old-a')

    await applyStagePlan(
      buildPlan('stage-a', [updateItem('stage-a', 'settings.json', 'new-a')]),
      { ...options(), apply: false }
    )

    await expect(fs.lstat(backupRoot)).rejects.toThrow()
    expect(
      await fs.readFile(path.join(tmpDir, 'stage-a', 'settings.json'), 'utf8')
    ).toBe('old-a')
  })
})
