import { describe, expect, it } from 'vitest'
import { campaign, design, snapshot } from './fixtures'
import type { ExperimentalResult } from '../src/shared/domain'
import {
  canShortlist,
  designGaps,
  experimentBrief,
  hasConflictingResults,
  labContextLines,
  predictionLabel,
  resultsCsv
} from '../src/shared/workbench'
import { campaignInputSchema, ipcArguments } from '../src/shared/validation'
import { pathwayLeaders, type PathwayOption } from '../src/shared/engineering'
import { suggestEngineeringOptions } from '../src/main/engine/EngineeringPlanning'
import { goalContext, generationPrompt, resultsToText } from '../src/main/engine/prompts'

const result = (
  outcome: ExperimentalResult['outcome'],
  status: ExperimentalResult['status'] = 'recorded'
): ExperimentalResult => ({
  id: outcome,
  campaignId: 'campaign1',
  designId: 'design1',
  createdAt: 1,
  outcome,
  status,
  author: 'Scientist',
  observations: 'Batch observation'
})

describe('scientist workbench', () => {
  it('keeps reference conditions through validation and includes them in research prompts', () => {
    const c = campaign()
    c.labContext = {
      metric: 'yield',
      baselineValue: 0,
      targetValue: 0.4,
      unit: 'g/g glucose',
      baselineStrain: 'Parent A',
      carbonSource: 'glucose',
      cultureMode: 'Shake flask',
      medium: 'Defined',
      conditions: 'Matched aerobic controls',
      assay: 'Product and residual glucose',
      bottlenecks: 'Previous edit reduced growth'
    }
    const parsed = campaignInputSchema.parse(c)
    expect(parsed.labContext).toEqual(c.labContext)
    expect(goalContext(c)).toContain('Baseline: 0 g/g glucose')
    expect(goalContext(c)).toContain('Reference strain: Parent A')
    expect(generationPrompt(c, 'literature', { count: 2 })).toContain(
      'Previous edit reduced growth'
    )
    expect(
      campaignInputSchema.safeParse({
        ...c,
        labContext: { ...c.labContext, targetValue: Infinity }
      }).success
    ).toBe(false)
  })

  it('handles existing projects without inventing baseline data', () => {
    expect(labContextLines()).toEqual([])
    expect(goalContext(campaign())).toContain('Not supplied')
    expect(experimentBrief(snapshot(), [design()])).toContain('No measurements recorded')
    expect(predictionLabel(design())).toBe('No quantified prediction')
  })

  it.each(['draft', 'reviewing', 'rejected'] as const)(
    'does not shortlist a %s proposal',
    (status) => {
      expect(canShortlist({ ...design(), status })).toBe(false)
    }
  )

  it('surfaces conflicting conclusions and ignores excluded results', () => {
    expect(hasConflictingResults([result('confirmed'), result('refuted')])).toBe(true)
    expect(hasConflictingResults([result('partial'), result('refuted', 'disputed')])).toBe(false)
    expect(designGaps(design(), [result('confirmed'), result('refuted')])).toContain(
      'Conflicting results — compare conditions and replicates'
    )
  })

  it('preserves batch traceability at the IPC boundary and in agent feedback', () => {
    const r = {
      ...result('partial'),
      runLabel: 'Batch-12',
      strainLabel: 'S-04',
      conditions: 'Changed medium; matched parent control'
    }
    expect(ipcArguments.recordExperimentalResult.parse([r])[0]).toMatchObject({
      runLabel: 'Batch-12',
      strainLabel: 'S-04',
      conditions: r.conditions
    })
    expect(resultsToText([r])).toContain(
      '[run: Batch-12] [strain: S-04] [conditions: Changed medium; matched parent control]'
    )
  })

  it('exports proposed changes, evidence gaps, reviews, reference notes and excluded results honestly', () => {
    const snap = snapshot()
    const d = design()
    d.citations = [
      {
        title: 'Reference',
        url: 'https://example.org/paper',
        note: 'Different host; verify applicability'
      }
    ]
    d.quantPrediction = { metric: 'titer', direction: 'increase', relativeChange: 0.3 }
    snap.designs = [d]
    snap.results = [result('confirmed', 'disputed')]
    snap.reviews = [
      {
        id: 'review1',
        campaignId: 'campaign1',
        designId: d.id,
        createdAt: 1,
        type: 'expert',
        verdict: 'revise',
        narrative: 'Add a parent control',
        evidence: ['Batch mismatch'],
        author: 'Scientist',
        scores: {}
      }
    ]
    const brief = experimentBrief(snap, [d])
    expect(brief).toContain('+30% titer (predicted)')
    expect(brief).toContain('[disputed] Confirmed')
    expect(brief).toContain('Prediction baseline not specified')
    expect(brief).toContain('Different host; verify applicability')
    expect(brief).toContain('Add a parent control')
  })

  it('exports complete CSV records, quotes embedded newlines and neutralizes spreadsheet formulas', () => {
    const snap = snapshot()
    snap.designs = [design()]
    snap.results = [
      {
        ...result('refuted'),
        observations: '=HYPERLINK("bad")\nsecond line',
        runLabel: '@batch',
        measuredValue: -2,
        baselineValue: 0,
        conditions: 'A, B'
      }
    ]
    const csv = resultsCsv(snap)
    expect(csv).toContain('"\'=HYPERLINK(""bad"")\nsecond line"')
    expect(csv).toContain('"\'@batch"')
    expect(csv).toContain('"-2","0"')
    expect(csv).toContain('"A, B"')
  })
})

describe('engineering pathway comparison', () => {
  const a: PathwayOption = {
    id: 'a', hostKey: 'host', title: 'Route A', source: 'scientist', summary: 'Concept A',
    limitations: 'Unknown host transfer', evidence: 'hypothetical',
    timeToValidation: { days: 9, basis: 'Starting from the same strain' },
    yield: { value: 0.3, unit: 'g/g', basis: 'glucose', kind: 'theoretical' },
    steps: { count: 4, basis: 'glucose to product, no transport' }
  }
  const b: PathwayOption = {
    ...a, id: 'b', title: 'Route B',
    timeToValidation: { days: 12, basis: '  starting from  the same strain ' },
    yield: { value: 0.5, unit: 'g/g', basis: 'glucose', kind: 'theoretical' },
    steps: { count: 2, basis: 'glucose to product, no transport' }
  }

  it('highlights a different route for each comparable metric and handles unknown values', () => {
    const leaders = pathwayLeaders([a, b, { ...a, id: 'c', steps: undefined, yield: undefined, timeToValidation: undefined }])
    expect([...leaders.time]).toEqual(['a'])
    expect([...leaders.yield]).toEqual(['b'])
    expect([...leaders.steps]).toEqual(['b'])
  })

  it('withholds comparisons across different evidence types, units and reaction boundaries', () => {
    const incompatible: PathwayOption = {
      ...b,
      yield: { ...b.yield!, kind: 'reported' },
      steps: { count: 1, basis: 'intermediate to product, includes transport' }
    }
    const leaders = pathwayLeaders([a, incompatible])
    expect(leaders.yield.size).toBe(0)
    expect(leaders.steps.size).toBe(0)
    expect(pathwayLeaders([a, { ...b, yield: { ...b.yield!, unit: 'mol/mol' } }]).yield.size).toBe(0)
  })

  it('keeps model suggestions unselected, rejects invalid claims and deduplicates the response', async () => {
    const c = campaign()
    c.host = { preset: 'scerevisiae', strainBackground: 'Reference strain' }
    const valid = { title: 'Hypothetical route', evidence: 'hypothetical', summary: 'Planning description', limitations: 'Unconfirmed' }
    const mock = {
      newId: () => 'new-route',
      llm: {
        complete: async () => ({
          text: JSON.stringify([
            { ...valid, title: 'Uncited report', evidence: 'reported-in-host' },
            valid, { ...valid, title: 'HYPOTHETICAL ROUTE' }
          ]),
          usage: { inputTokens: 1, outputTokens: 1 }, model: 'fixture'
        }),
        ping: async () => ''
      }
    }
    const proposal = await suggestEngineeringOptions(mock, c, 'pathways')
    expect(proposal.pathways).toHaveLength(1)
    expect(proposal.pathways[0]).toMatchObject({ id: 'new-route', source: 'model', evidence: 'hypothetical' })
    expect(proposal.selectedPathwayId).toBeUndefined()
    expect(c.engineering).toBeUndefined()
  })

  it('treats conflicting feedback as a conflict only within the same scope', () => {
    const support = { ...result('confirmed'), targetId: 'one' }
    expect(hasConflictingResults([support, { ...result('refuted'), targetId: 'two' }])).toBe(false)
    expect(hasConflictingResults([support, { ...result('refuted'), targetId: 'one' }])).toBe(true)
    expect(hasConflictingResults([support, result('refuted')])).toBe(false)
  })
})
