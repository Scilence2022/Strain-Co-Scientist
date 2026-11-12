import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { snapshot, design } from './fixtures'
import { evidenceGradeFor, type StrainDesign } from '../src/shared/domain'
import { availablePathways } from '../src/shared/engineering'
import { experimentBrief, resultsCsv } from '../src/shared/workbench'
import type { EngineEvent, RecordResultInput } from '../src/shared/ipc'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
import { Engine } from '../src/main/engine/Engine'

const active: { engine: Engine; root: string }[] = []
async function setup(status: StrainDesign['status'] = 'active') {
  const root = await mkdtemp(join(tmpdir(), 'strain-data-'))
  const snap = snapshot()
  snap.designs = [design('a'), design('b')]
  snap.designs[0].status = status
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

  it('preserves experiment traceability across a store reload and prevents shortlisting an unreviewed design', async () => {
    const { engine } = await setup('reviewing')
    const input: RecordResultInput = { campaignId: 'campaign1', designId: 'a', outcome: 'inconclusive', observations: 'Assay variability', runLabel: 'Batch-12', strainLabel: 'Strain-03', conditions: 'Different carbon source' }
    const recorded = await engine.recordExperimentalResult(input)
    expect(recorded).toMatchObject(input)
    const saved = active[active.length - 1]
    await engine.shutdown()
    const reloaded = new Engine(() => {}, saved.root)
    saved.engine = reloaded
    expect(reloaded.getSnapshot('campaign1')!.results[0]).toMatchObject(input)
    expect(() => reloaded.flagDesign('a', true)).toThrow('Only reviewed, active designs')
  })

  it('updates legacy project reference conditions without rewriting old results or predictions', async () => {
    const { engine, events } = await setup()
    const before = engine.getSnapshot('campaign1')!
    const reference = { metric: 'yield' as const, baselineValue: 0.2, targetValue: 0.4, unit: 'g/g glucose', conditions: 'New reference conditions' }
    await engine.updateLabContext('campaign1', reference)
    const current = engine.getSnapshot('campaign1')!
    expect(current.campaign.labContext).toEqual(reference)
    expect(current.designs[0].quantPrediction).toEqual(before.designs[0].quantPrediction)
    expect(events.some((e) => e.kind === 'campaign-upsert' && e.campaign.labContext?.metric === 'yield')).toBe(true)
    const saved = active[active.length - 1]
    await engine.shutdown()
    const reloaded = new Engine(() => {}, saved.root)
    saved.engine = reloaded
    expect(reloaded.getSnapshot('campaign1')!.campaign.labContext).toEqual(reference)
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
  it('persists scoped designs and target results across host changes and store reload', async () => {
    const { engine } = await setup()
    const campaignId = 'campaign1'
    await engine.updateEngineeringPlan(campaignId, {
      action: 'set-host', host: { preset: 'scerevisiae', strainBackground: 'Reference yeast' }
    })
    await engine.updateEngineeringPlan(campaignId, {
      action: 'add-pathway',
      pathway: { title: 'Candidate route', evidence: 'hypothetical', summary: 'Route concept', limitations: 'Unverified' }
    })
    const pathway = availablePathways(engine.getSnapshot(campaignId)!.campaign)[0]
    await engine.updateEngineeringPlan(campaignId, { action: 'select-pathway', optionId: pathway.id })
    const scoped = engine.submitExpertDesign({
      campaignId, title: 'Scoped design', summary: 'Target analysis', chassis: '', interventions: [],
      mechanism: '', predictedEffect: '',
      metabolicTargets: [{ name: 'NADPH balance', category: 'redox-balance', cofactors: ['NADPH'],
        hypothesis: 'Named causal assumption', readout: 'Compare matched controls', limitation: 'Possible batch effects' }]
    })
    expect(scoped.engineeringScope?.pathway?.id).toBe(pathway.id)
    const targetId = scoped.metabolicTargets![0].id
    const input: RecordResultInput = {
      campaignId, designId: scoped.id, targetId, metric: 'titer', outcome: 'confirmed',
      observations: 'Supported by this batch', measuredValue: 2, baselineValue: 1
    }
    await expect(engine.recordExperimentalResult({ ...input, designId: 'a' })).rejects.toThrow('does not belong')
    const recorded = await engine.recordExperimentalResult(input)
    const snapshot = engine.getSnapshot(campaignId)!
    expect(snapshot.calibration).toHaveLength(0)
    expect(evidenceGradeFor(snapshot.results)).toBe('predicted-only')
    expect(evidenceGradeFor(snapshot.results, targetId)).toBe('measured-confirmed')
    expect(experimentBrief(snapshot, [scoped])).toContain('Target: NADPH balance')
    expect(resultsCsv(snapshot)).toContain('Candidate route')
    await engine.disputeResult(campaignId, recorded.id, true)
    expect(evidenceGradeFor(engine.getSnapshot(campaignId)!.results, targetId)).toBe('predicted-only')
    await engine.disputeResult(campaignId, recorded.id, false)

    await engine.updateEngineeringPlan(campaignId, { action: 'set-host', host: { preset: 'cglutamicum' } })
    await expect(engine.updateEngineeringPlan(campaignId, { action: 'select-pathway', optionId: pathway.id }))
      .rejects.toThrow('does not belong')
    const saved = active.at(-1)!
    await engine.shutdown()
    const reloaded = saved.engine = new Engine(() => {}, saved.root)
    const reloadedSnapshot = reloaded.getSnapshot(campaignId)!
    expect(reloadedSnapshot.campaign.engineering?.selectedPathwayId).toBeUndefined()
    expect(reloadedSnapshot.designs.find((entry) => entry.id === scoped.id)?.engineeringScope?.pathway?.id).toBe(pathway.id)
    expect(reloadedSnapshot.results[0]).toMatchObject({ targetId, status: 'recorded' })
  })

})
