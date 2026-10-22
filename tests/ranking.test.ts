import { describe, expect, it, vi } from 'vitest'
import { RankingAgent } from '../src/main/engine/agents/RankingAgent'
import { ReflectionAgent } from '../src/main/engine/agents/ReflectionAgent'
import { EngineContext } from '../src/main/engine/context'
import { decideMatch, updateElo } from '../src/main/engine/tournament/Elo'
import { campaign, deferred, design } from './fixtures'

function setup(text: string) {
  const ctx = {
    llm: { complete: vi.fn().mockResolvedValue({ text, usage: { inputTokens: 1, outputTokens: 1 } }) },
    store: { getResultsForDesign: () => [] },
    deepResearch: { available: false }, codexomics: { available: false },
    settings: { safety: { enforceBiosafety: true } },
    upsertDesign: vi.fn(), addMatch: vi.fn(), addReview: vi.fn(), log: vi.fn(), newId: () => 'match1'
  }
  return { ctx, context: ctx as unknown as EngineContext }
}

describe('ranking integrity', () => {
  it('records a draw without inventing wins or losses', async () => {
    const { ctx, context } = setup(JSON.stringify({ scoresA: { effectiveness: 8 }, scoresB: { effectiveness: 8 } }))
    const c = campaign()
    c.tournamentConfig.tieHandling = 'draw'
    c.tournamentConfig.randomizeOrder = false
    const a = design('a'), b = design('b')
    const match = await new RankingAgent(context).match(c, a, b, 'single-turn', 1)
    expect(match.winnerId).toBeNull()
    expect(a.wins + a.losses + b.wins + b.losses).toBe(0)
    expect(a.elo).toBe(1200)
    expect(ctx.addMatch).toHaveBeenCalledOnce()
  })

  it('rejects unusable judge output without changing the ladder', async () => {
    const { ctx, context } = setup('unparseable model output')
    const a = design('a'), b = design('b')
    await expect(new RankingAgent(context).match(campaign(), a, b, 'debate', 1)).rejects.toThrow('no usable criterion scores')
    expect(a.elo).toBe(1200)
    expect(ctx.addMatch).not.toHaveBeenCalled()
  })

  it('rejects a participant withdrawn while the judge is running', async () => {
    const { ctx, context } = setup('')
    const pending = deferred<unknown>()
    ctx.llm.complete.mockReturnValueOnce(pending.promise as never)
    const a = design('a'), b = design('b')
    const match = new RankingAgent(context).match(campaign(), a, b, 'debate', 1)
    a.status = 'rejected'
    pending.resolve({ text: JSON.stringify({ scoresA: { effectiveness: 9 }, scoresB: { effectiveness: 7 } }) })
    await expect(match).rejects.toThrow('rejected during review')
    expect(ctx.upsertDesign).not.toHaveBeenCalled()
  })

  it('does not promote malformed review output', async () => {
    const { ctx, context } = setup('Something went wrong')
    await expect(new ReflectionAgent(context).review(campaign(), design(), 'initial')).rejects.toThrow('no usable verdict')
    expect(ctx.addReview).not.toHaveBeenCalled()
  })

  it('honors rejection from a full review', async () => {
    const { context } = setup(JSON.stringify({ verdict: 'reject', scores: { safety: 2 }, narrative: 'Rejected' }))
    const d = design()
    await new ReflectionAgent(context).review(campaign(), d, 'full')
    expect(d.status).toBe('rejected')
  })

  it('uses the same tie policy for live judging and replay', () => {
    expect(decideMatch(10, 10, 1300, 1200, 'draw')).toBe(0.5)
    expect(decideMatch(10, 10, 1300, 1200, 'higher-elo')).toBe(1)
    expect(decideMatch(10, 10, 1100, 1200, 'higher-elo')).toBe(0)
    const update = updateElo(1300, 1200, 0.5)
    expect(update.newA).toBeLessThan(1300)
    expect(update.newB).toBeGreaterThan(1200)
    expect(update.newA + update.newB).toBe(2500)
  })

  it('blocks late model responses and mutations in a cancelled run', async () => {
    const pending = deferred<unknown>()
    const ctx = new EngineContext({} as never, { complete: () => pending.promise as never, ping: async () => '' }, {} as never, {} as never, {} as never, vi.fn())
    const controller = new AbortController()
    const scoped = ctx.forRun(controller.signal)
    const result = scoped.llm.complete({ agent: 'generation', prompt: '', system: '' })
    controller.abort()
    pending.resolve({ text: 'Late result' })
    await expect(result).rejects.toThrow()
    expect(() => scoped.upsertDesign(design())).toThrow()
  })
})
