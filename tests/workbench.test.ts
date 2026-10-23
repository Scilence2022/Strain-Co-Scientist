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
