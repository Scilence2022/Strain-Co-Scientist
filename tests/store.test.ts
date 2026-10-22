import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import { campaign, snapshot, deferred } from './fixtures'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
import { Store } from '../src/main/memory/Store'

const roots: string[] = []
const stores: Store[] = []
async function create() {
  const root = await mkdtemp(join(tmpdir(), 'strain-store-'))
  roots.push(root)
  const store = new Store(root)
  stores.push(store)
  return { store, root }
}
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(stores.splice(0).map((store) => store.flush()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('persistent memory', () => {
  it('serializes overlapping flushes and preserves the latest update', async () => {
    const { store, root } = await create()
    store.upsertCampaign(campaign())
    const original = fs.writeFile.bind(fs)
    const entered = deferred<void>()
    const release = deferred<void>()
    vi.spyOn(fs, 'writeFile').mockImplementationOnce(async (...args: Parameters<typeof fs.writeFile>) => {
      entered.resolve()
      await release.promise
      return original(...args)
    })
    const first = store.flush()
    await entered.promise
    store.upsertCampaign({ ...campaign(), title: 'Newest title' })
    const second = store.flush()
    release.resolve()
    await Promise.all([first, second])
    const dir = join(root, 'campaigns', 'campaign1')
    expect(JSON.parse(await readFile(join(dir, 'snapshot.json'), 'utf8')).campaign.title).toBe('Newest title')
    expect(await readdir(dir)).toEqual(['snapshot.json'])
  })

  it('retains dirty snapshots after a failed write and retries successfully', async () => {
    const { store, root } = await create()
    store.upsertCampaign(campaign())
    vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('Disk full'))
    await expect(store.flush()).rejects.toThrow('Disk full')
    await store.flush()
    expect(JSON.parse(await readFile(join(root, 'campaigns/campaign1/snapshot.json'), 'utf8')).campaign.id).toBe('campaign1')
  })

  it('does not recreate a campaign deleted during a flush', async () => {
    const { store, root } = await create()
    store.upsertCampaign(campaign())
    await Promise.all([store.flush(), store.deleteCampaign('campaign1')])
    expect(await readdir(join(root, 'campaigns'))).toEqual([])
  })

  it('keeps a campaign available when filesystem deletion fails', async () => {
    const { store } = await create()
    store.upsertCampaign(campaign())
    await store.flush()
    vi.spyOn(fs, 'rm').mockRejectedValueOnce(new Error('Permission denied'))
    await expect(store.deleteCampaign('campaign1')).rejects.toThrow('Permission denied')
    expect(store.getSnapshot('campaign1')).not.toBeNull()
  })

  it('serializes settings and returns defensive copies', async () => {
    const { store } = await create()
    const first = store.getSettings()
    first.run.concurrency = 7
    expect(store.getSettings().run.concurrency).toBe(3)
    const second = store.getSettings()
    second.run.concurrency = 2
    await Promise.all([store.saveSettings(first), store.saveSettings(second)])
    expect(store.getSettings().run.concurrency).toBe(2)
    second.run.concurrency = 9
    expect(store.getSettings().run.concurrency).toBe(2)
  })

  it('keeps the previous settings when saving fails', async () => {
    const { store } = await create()
    const settings = store.getSettings()
    settings.run.concurrency = 8
    vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('Read-only disk'))
    await expect(store.saveSettings(settings)).rejects.toThrow()
    expect(store.getSettings().run.concurrency).toBe(3)
  })

  it('recovers interrupted campaigns and old snapshots', async () => {
    const { root } = await create()
    const snap = snapshot()
    snap.campaign.status = 'running'
    snap.tasks.push({ id: 'task1', campaignId: 'campaign1', agent: 'generation', label: 'Interrupted', state: 'running', cycle: 1, createdAt: 1 })
    const { results, calibration, ...legacy } = snap
    await mkdir(join(root, 'campaigns/campaign1'), { recursive: true })
    await writeFile(join(root, 'campaigns/campaign1/snapshot.json'), JSON.stringify(legacy))
    const recovered = new Store(root)
    stores.push(recovered)
    expect(recovered.getSnapshot('campaign1')).toMatchObject({ campaign: { status: 'paused' }, tasks: [{ state: 'cancelled' }], results: [], calibration: [] })
    await recovered.flush()
    expect(JSON.parse(await readFile(join(root, 'campaigns/campaign1/snapshot.json'), 'utf8')).campaign.status).toBe('paused')
  })

  it('rejects identifiers that could escape the data directory', async () => {
    const { store } = await create()
    expect(() => store.upsertCampaign(campaign('../escape'))).toThrow('Invalid campaign id')
    await expect(store.deleteCampaign('../escape')).rejects.toThrow('Invalid campaign id')
  })
})
