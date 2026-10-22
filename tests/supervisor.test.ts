import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { campaign, deferred, design } from './fixtures'
import { DEFAULT_SETTINGS } from '../src/shared/domain'
import type { LLMRequest, LLMResponse } from '../src/main/llm/types'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
import { Store } from '../src/main/memory/Store'
import { Supervisor } from '../src/main/engine/Supervisor'
import { EngineContext } from '../src/main/engine/context'

const active: { store: Store; root: string }[] = []
async function setup(complete: (request: LLMRequest) => Promise<LLMResponse>) {
  const root = await mkdtemp(join(tmpdir(), 'strain-supervisor-'))
  const store = new Store(root)
  active.push({ store, root })
  const c = campaign()
  c.status = 'running'
  c.researchPlan = { restatedGoal: c.goal, focusAreas: [], derivedConstraints: [], evaluationRubric: '', parsedAt: 1 }
  store.upsertCampaign(c)
  const ctx = new EngineContext(store, { complete, ping: async () => '' }, { available: false } as never, { available: false } as never, structuredClone(DEFAULT_SETTINGS), vi.fn())
  return { store, campaign: c, supervisor: new Supervisor(ctx, c.id) }
}
const response = (text: string): LLMResponse => ({ text, model: 'test', usage: { inputTokens: 1, outputTokens: 1 } })
afterEach(async () => {
  for (const { store, root } of active.splice(0)) {
    await store.flush()
    await rm(root, { recursive: true, force: true })
  }
})

describe('supervisor orchestration', () => {
  it('halts a failed seed cycle instead of spending the entire budget', async () => {
    const complete = vi.fn(async () => response('[]'))
    const { supervisor, store } = await setup(complete)
    await expect(supervisor.run()).rejects.toThrow('All tasks in the cycle failed')
    expect(complete).toHaveBeenCalledOnce()
    expect(store.getSnapshot('campaign1')?.tasks[0].state).toBe('failed')
  })

  it('does not overwrite a refined goal with an older in-flight research plan', async () => {
    const pending = deferred<LLMResponse>()
    const { supervisor, campaign: c } = await setup(() => pending.promise)
    c.researchPlan = undefined
    const parsing = supervisor.parseGoal(c)
    c.goal = 'A newly refined goal'
    pending.resolve(response('{"restatedGoal":"The old goal"}'))
    await parsing
    expect(c.researchPlan).toBeUndefined()
  })

  it('records one statistics point per completed cycle', async () => {
    const { supervisor, store, campaign: c } = await setup(async (req) => {
      if (req.agent === 'generation') return response('[{"title":"Generated test design"}]')
      return response('{"overview":{"summary":"Test overview","areas":[]}}')
    })
    c.computeBudget.maxCycles = 1
    await expect(supervisor.run()).resolves.toBe('completed')
    expect(store.getSnapshot(c.id)?.statistics).toHaveLength(1)
    expect(store.getSnapshot(c.id)?.metaReviews).toHaveLength(1)
  })

  it('does not schedule the same tournament pair twice in one cycle', async () => {
    const { supervisor, store, campaign: c } = await setup(async (req) => {
      if (req.agent === 'ranking') return response('{"scoresA":{"effectiveness":8},"scoresB":{"effectiveness":6}}')
      if (req.agent === 'reflection') return response('{"verdict":"pass","scores":{"safety":9}}')
      return response('{"overview":{"summary":"Test overview","areas":[]}}')
    })
    store.upsertDesign(design('a'))
    store.upsertDesign(design('b'))
    c.computeBudget.maxCycles = 1
    await supervisor.run()
    expect(store.getSnapshot(c.id)?.matches).toHaveLength(1)
  })
})
