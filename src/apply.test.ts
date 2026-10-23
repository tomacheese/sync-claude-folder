import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import path from 'node:path'
import { applyStagePlan } from './apply'
import { StageConfig } from './config'
import { PlanItem, StagePlan } from './planner'

const TIMESTAMP = '20260101T000000'

describe('applyStagePlan のバックアップ', () => {
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
   * テスト用の StagePlan を組み立てる。
   * @param name stage 名
   * @param items プラン項目
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
   * 通常ファイルの update 項目を組み立てる。
   * @param name stage 名
   * @param relPath dest からの相対パス
   * @param content 書き込む内容
   * @returns プラン項目
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
   * dest 側にファイルを作成する。
   * @param name stage 名
   * @param relPath dest からの相対パス
   * @param content ファイルの内容
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

  test('複数 stage が同名 relPath を更新しても stage ごとにバックアップが分離される', async () => {
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

  test('delete でも stage ごとにバックアップが分離される', async () => {
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

  test('dest が symlink の同名 relPath を複数 stage が更新しても stage ごとにリンク先が保存される', async () => {
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

  describe('既存のバックアップがある場合は上書きせず中断する', () => {
    const backupFile = (): string =>
      path.join(backupRoot, TIMESTAMP, 'stage-a', 'settings.json')

    /**
     * 既存バックアップの位置に通常ファイルを置く。
     */
    async function seedBackupFile(): Promise<void> {
      await fs.mkdir(path.dirname(backupFile()), { recursive: true })
      await fs.writeFile(backupFile(), 'existing-backup')
    }

    test('dest が通常ファイルの場合', async () => {
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

    test('dest がディレクトリの場合', async () => {
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

    test('dest がディレクトリで既存バックアップが空ディレクトリの場合', async () => {
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

    test('dest が symlink の場合', async () => {
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

    test('既存バックアップがリンク切れ symlink の場合', async () => {
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

  test('dest が存在しない新規作成ではバックアップを作らない', async () => {
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

  test('apply が false の場合はバックアップも dest の変更も行わない', async () => {
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
