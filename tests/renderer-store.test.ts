import { describe, expect, it, vi } from 'vitest'
import { createAppStore } from '../src/renderer/src/store/useStore'
import { DEFAULT_SETTINGS } from '../src/shared/domain'
import type { EngineEvent, PreloadBridge } from '../src/shared/ipc'
import { campaign, deferred, design, snapshot } from './fixtures'

function setup() {
  let listener!: (event: EngineEvent) => void
  const unsubscribe = vi.fn()
  const api = {
    getSettings: vi.fn().mockResolvedValue(structuredClone(DEFAULT_SETTINGS)),
    listCampaigns: vi.fn().mockResolvedValue([campaign()]),
    getSnapshot: vi.fn().mockResolvedValue(snapshot()),
    onEngineEvent: vi.fn((handler) => { listener = handler; return unsubscribe })
  }
  const store = createAppStore(() => api as unknown as PreloadBridge)
  return { store, api, unsubscribe, emit: (event: EngineEvent) => listener(event) }
}

describe('renderer synchronization', () => {
  it('initializes once and has one subscription under StrictMode', async () => {
    const { store, api, unsubscribe } = setup()
    await Promise.all([store.getState().init(), store.getState().init()])
    expect(api.onEngineEvent).toHaveBeenCalledTimes(1)
    expect(api.getSettings).toHaveBeenCalledTimes(1)
    store.getState().dispose()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('ignores late snapshots when switching campaigns quickly', async () => {
    const { store, api } = setup()
    const a = deferred<ReturnType<typeof snapshot>>()
    const b = deferred<ReturnType<typeof snapshot>>()
    api.getSnapshot.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    const first = store.getState().selectCampaign('a')
    const second = store.getState().selectCampaign('b')
    b.resolve(snapshot('b'))
    await second
    a.resolve(snapshot('a'))
    await first
    expect(store.getState().snapshot?.campaign.id).toBe('b')
    expect(store.getState().selectedId).toBe('b')
  })

  it('clears the previous campaign while loading and when deselected', async () => {
    const { store, api } = setup()
    await store.getState().init()
    const pending = deferred<ReturnType<typeof snapshot>>()
    api.getSnapshot.mockReturnValueOnce(pending.promise)
    const selecting = store.getState().selectCampaign('b')
    expect(store.getState().snapshot).toBeNull()
    await store.getState().selectCampaign(null)
    pending.resolve(snapshot('b'))
    await selecting
    expect(store.getState().snapshot).toBeNull()
  })

  it('replays events arriving during a snapshot refresh without duplicates', async () => {
    const { store, api, emit } = setup()
    await store.getState().init()
    const pending = deferred<ReturnType<typeof snapshot>>()
    api.getSnapshot.mockReturnValueOnce(pending.promise)
    const refresh = store.getState().refreshSnapshot()
    const item = design()
    emit({ kind: 'design-upsert', campaignId: 'campaign1', design: item })
    const snap = snapshot()
    snap.designs = [item]
    pending.resolve(snap)
    await refresh
    expect(store.getState().snapshot?.designs).toEqual([item])
  })

  it('keeps events received during initial loading', async () => {
    const { store, api, emit } = setup()
    const loading = deferred<ReturnType<typeof snapshot>>()
    api.getSnapshot.mockReturnValueOnce(loading.promise)
    const init = store.getState().init()
    emit({ kind: 'design-upsert', campaignId: 'campaign1', design: design() })
    loading.resolve(snapshot())
    await init
    expect(store.getState().snapshot?.designs).toHaveLength(1)
  })

  it('shows initialization errors and allows retrying', async () => {
    const { store, api } = setup()
    api.getSettings.mockRejectedValueOnce(new Error('Bridge unavailable'))
    await store.getState().init()
    expect(store.getState().error).toContain('Bridge unavailable')
    expect(store.getState().ready).toBe(false)
    await store.getState().init()
    expect(store.getState().ready).toBe(true)
    expect(store.getState().error).toBeNull()
  })

  it('updates campaign metadata across the list and selected snapshot', async () => {
    const { store, emit } = setup()
    await store.getState().init()
    const updated = { ...campaign(), title: 'New goal', status: 'running' as const }
    emit({ kind: 'campaign-upsert', campaignId: 'campaign1', campaign: updated })
    expect(store.getState().campaigns[0]).toEqual(updated)
    expect(store.getState().snapshot?.campaign).toEqual(updated)
  })
})
