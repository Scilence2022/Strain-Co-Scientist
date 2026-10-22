import { describe, expect, it } from 'vitest'
import { computeCalibration, signedMeasured } from '../src/main/engine/learn/Calibration'
import type { ExperimentalResult } from '../src/shared/domain'
import { design } from './fixtures'

function result(id: string, metric: 'titer' | 'yield', at: number): ExperimentalResult {
  return { id, campaignId: 'campaign1', designId: 'design1', createdAt: at, outcome: 'confirmed', metric, measuredValue: 15, baselineValue: 10, observations: 'Test observation', author: 'Test', status: 'recorded' }
}
describe('prediction calibration', () => {
  it('uses the latest comparable result when a newer result measures another metric', () => {
    const d = design()
    d.quantPrediction = { metric: 'titer', direction: 'increase', relativeChange: 0.5, confidence: 0.8 }
    const profile = computeCalibration('campaign1', 1, 10, [d], [result('r1', 'titer', 1), result('r2', 'yield', 2)])
    expect(profile).toMatchObject({ nPairs: 1, signedBias: 0, meanAbsError: 0, brier: 0.04 })
  })

  it('excludes disputed and nonfinite measurements', () => {
    const d = design()
    d.quantPrediction = { metric: 'titer', direction: 'increase', relativeChange: 0.5 }
    const r = result('r1', 'titer', 1)
    r.status = 'disputed'
    expect(computeCalibration('campaign1', 1, 10, [d], [r])).toBeNull()
    expect(signedMeasured({ ...r, measuredValue: Infinity })).toBeUndefined()
    expect(signedMeasured({ ...r, baselineValue: 0 })).toBeUndefined()
  })
})
