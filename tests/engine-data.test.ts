import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { snapshot, design } from './fixtures'
import type { EngineEvent, RecordResultInput } from '../src/shared/ipc'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
import { Engine } from '../src/main/engine/Engine'

const active: { engine: Engine; root: string }[] = []
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'strain-data-'))
  const snap = snapshot()
  snap.designs = [design('a'), design('b')]
  snap.designs[0].quantPrediction = { metric: 'titer', direction: 'increase', relativeChange: 0.5 }
  snap.matches = [{ id: 'match1', campaignId: 'campaign1', cycle: 1, createdAt: 2, designAId: 'a', designBId: 'b', winnerId: 'a', mode: 'single-turn', transcript: '', rationale: '', eloDelta: 16, scoresA: { effectiveness: 8 }, scoresB: { effectiveness: 8 } }]
  await mkdir(join(root, 'campaigns/campaign1'), { recursive: true })
  await writeFile(join(root, 'campaigns/campaign1/snapshot.json'), JSON.stringify(snap))
  const events: EngineEvent[] = []
  const engine = new Engine((e) => events.push(structuredClone(e)), root)
  active.push({ engine, root })
  return { engine, events, snap }
}
afterEach(async () => {
  for (const { engine, root } of active.splice(0)) {
    await engine.shutdown()
    await rm(root, { recursive: true, force: true })
  }
})

describe('campaign data consistency', () => {
  it('replays drawn matches without assigning a winner and pushes the corrected match', async () => {
    const { engine, events, snap } = await setup()
    snap.campaign.tournamentConfig.tieHandling = 'draw'
    await engine.updateTournamentConfig('campaign1', snap.campaign.tournamentConfig)
    const current = engine.getSnapshot('campaign1')!
    expect(current.matches[0].winnerId).toBeNull()
    expect(current.designs.every((d) => d.elo === 1200 && d.wins === 0 && d.losses === 0)).toBe(true)
    expect(events.some((e) => e.kind === 'match-added' && e.match.winnerId === null)).toBe(true)
    await engine.updateTournamentConfig('campaign1', snap.campaign.tournamentConfig)
    expect(engine.getSnapshot('campaign1')!.designs).toEqual(current.designs)
  })

  it('clears stale calibration when the last comparable result is disputed', async () => {
    const { engine } = await setup()
    const input: RecordResultInput = { campaignId: 'campaign1', designId: 'a', outcome: 'confirmed', metric: 'titer', measuredValue: 15, baselineValue: 10, observations: 'Test observation' }
    const result = await engine.recordExperimentalResult(input)
    expect(engine.getSnapshot('campaign1')!.calibration.at(-1)?.nPairs).toBe(1)
    await engine.disputeResult('campaign1', result.id, true)
    const snap = engine.getSnapshot('campaign1')!
    expect(snap.calibration.at(-1)?.nPairs).toBe(0)
    expect(snap.designs[0].evidence).toBe('predicted-only')
    await engine.disputeResult('campaign1', result.id, false)
    expect(engine.getSnapshot('campaign1')!.calibration.at(-1)?.nPairs).toBe(1)
  })
})
