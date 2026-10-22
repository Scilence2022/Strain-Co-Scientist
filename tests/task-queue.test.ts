import { describe, expect, it, vi } from 'vitest'
import { TaskQueue, type AgentTask } from '../src/main/engine/TaskQueue'
import type { EngineContext } from '../src/main/engine/context'
import type { TaskRecord } from '../src/shared/domain'
import { deferred } from './fixtures'

function setup(concurrency = 2) {
  const records = new Map<string, TaskRecord>()
  let next = 0
  const ctx = {
    settings: { run: { concurrency } }, newId: () => String(++next),
    upsertTask: (record: TaskRecord) => records.set(record.id, { ...record }), log: vi.fn(),
    store: { getSnapshot: () => ({ tasks: [...records.values()] }) }
  }
  return { queue: new TaskQueue(ctx as unknown as EngineContext, 'campaign1'), records, ctx }
}
function task(run: AgentTask['run']): AgentTask { return { agent: 'generation', label: 'Test', cycle: 1, run } }

describe('worker queue', () => {
  it('honors bounded concurrency', async () => {
    const { queue, records } = setup()
    const gate = deferred<void>()
    let running = 0
    let peak = 0
    const run = async () => { running++; peak = Math.max(peak, running); await gate.promise; running-- }
    const batch = queue.runBatch(Array.from({ length: 5 }, () => task(run)))
    expect(peak).toBe(2)
    gate.resolve()
    await batch
    expect([...records.values()].every((r) => r.state === 'done')).toBe(true)
    expect(peak).toBe(2)
  })

  it('marks interrupted and pending tasks cancelled', async () => {
    const { queue, records, ctx } = setup(1)
    const gate = deferred<void>()
    const never = vi.fn()
    const batch = queue.runBatch([task(async () => { await gate.promise; throw new Error('Aborted') }), task(never)])
    queue.cancel()
    gate.resolve()
    await batch
    expect([...records.values()].map((r) => r.state)).toEqual(['cancelled', 'cancelled'])
    expect(never).not.toHaveBeenCalled()
    expect(ctx.log).not.toHaveBeenCalled()
  })

  it.each([NaN, Infinity, 0, -1])('uses a working fallback for invalid concurrency %s', async (value) => {
    const { queue, records } = setup(value)
    await queue.runBatch([task(async () => ['design1'])])
    expect([...records.values()][0]).toMatchObject({ state: 'done', resultDesignIds: ['design1'] })
  })

  it('isolates a failed task while continuing the batch', async () => {
    const { queue, records } = setup(1)
    await queue.runBatch([task(async () => { throw new Error('Provider offline') }), task(async () => [])])
    expect([...records.values()].map((r) => r.state)).toEqual(['failed', 'done'])
  })
})
