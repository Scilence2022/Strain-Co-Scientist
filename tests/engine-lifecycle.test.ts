import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { campaign } from './fixtures'
import type { EngineEvent } from '../src/shared/ipc'

const state = vi.hoisted(() => ({ runs: [] as { cancelled: boolean; resolve: (result: 'paused' | 'completed' | 'stopped') => void }[] }))
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
vi.mock('../src/main/engine/Supervisor', () => ({
  Supervisor: class {
    job: (typeof state.runs)[number] | undefined
    cancelled = false
    run() {
      return new Promise<'completed' | 'paused' | 'stopped'>((resolve) => {
        this.job = { cancelled: this.cancelled, resolve }
        state.runs.push(this.job)
      })
    }
    cancel() { this.cancelled = true; if (this.job) this.job.cancelled = true }
  }
}))
import { Engine } from '../src/main/engine/Engine'

const active: { engine: Engine; root: string }[] = []
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'strain-engine-'))
  const events: EngineEvent[] = []
  const engine = new Engine((event) => events.push(structuredClone(event)), root)
  active.push({ engine, root })
  const { id: _, createdAt, updatedAt, status, ...input } = campaign()
  const created = engine.createCampaign(input)
  return { engine, id: created.id, events }
}
afterEach(async () => {
  for (const job of state.runs) job.resolve('paused')
  for (const { engine, root } of active.splice(0)) {
    await engine.shutdown()
    await rm(root, { recursive: true, force: true })
  }
  state.runs.length = 0
})

describe('campaign lifecycle', () => {
  it('waits for a paused worker before immediately resuming', async () => {
    const { engine, id } = await setup()
    await engine.startCampaign(id)
    expect(state.runs).toHaveLength(1)
    const pausing = engine.pauseCampaign(id)
    const resuming = engine.resumeCampaign(id)
    expect(state.runs[0].cancelled).toBe(true)
    expect(state.runs).toHaveLength(1)
    state.runs[0].resolve('paused')
    await Promise.all([pausing, resuming])
    expect(state.runs).toHaveLength(2)
    expect(engine.getSnapshot(id)?.campaign.status).toBe('running')
  })

  it('does not launch duplicate workers for repeated Run clicks', async () => {
    const { engine, id } = await setup()
    await Promise.all([engine.startCampaign(id), engine.startCampaign(id), engine.resumeCampaign(id)])
    expect(state.runs).toHaveLength(1)
  })

  it('never overwrites a stop requested during finalization with completed', async () => {
    const { engine, id } = await setup()
    await engine.startCampaign(id)
    const stopping = engine.stopCampaign(id)
    state.runs[0].resolve('completed')
    await stopping
    expect(engine.getSnapshot(id)?.campaign.status).toBe('stopped')
  })

  it('drains cancelled work before deleting its campaign', async () => {
    const { engine, id } = await setup()
    await engine.startCampaign(id)
    const deleting = engine.deleteCampaign(id)
    expect(engine.getSnapshot(id)).not.toBeNull()
    state.runs[0].resolve('stopped')
    await deleting
    expect(engine.getSnapshot(id)).toBeNull()
  })

  it('lets a later Stop override a queued Resume', async () => {
    const { engine, id } = await setup()
    await engine.startCampaign(id)
    const pausing = engine.pauseCampaign(id)
    const resuming = engine.resumeCampaign(id)
    const stopping = engine.stopCampaign(id)
    state.runs[0].resolve('paused')
    await Promise.all([pausing, resuming, stopping])
    expect(state.runs).toHaveLength(1)
    expect(engine.getSnapshot(id)?.campaign.status).toBe('stopped')
  })

  it('prevents resume from launching work while deleting a campaign', async () => {
    const { engine, id } = await setup()
    await engine.startCampaign(id)
    const pausing = engine.pauseCampaign(id)
    const resuming = engine.resumeCampaign(id)
    const deleting = engine.deleteCampaign(id)
    state.runs[0].resolve('paused')
    await Promise.all([pausing, resuming, deleting])
    expect(state.runs).toHaveLength(1)
    expect(engine.getSnapshot(id)).toBeNull()
  })

  it('waits for workers and saves a resumable campaign on shutdown', async () => {
    const { engine, id } = await setup()
    await engine.startCampaign(id)
    let closed = false
    const closing = engine.shutdown().then(() => { closed = true })
    await Promise.resolve()
    expect(closed).toBe(false)
    expect(state.runs[0].cancelled).toBe(true)
    state.runs[0].resolve('completed')
    await closing
    expect(engine.getSnapshot(id)?.campaign.status).toBe('paused')
    await expect(engine.startCampaign(id)).rejects.toThrow('shutting down')
  })
})
