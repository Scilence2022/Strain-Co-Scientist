import type {
  CalibrationProfile,
  ExperimentalResult,
  InterventionType,
  QuantPrediction,
  StrainDesign
} from '@shared/domain'

/**
 * Prediction calibration — the part of the feedback loop that makes the system
 * measurably learn. Everything here is a pure function of designs + their
 * results: given the structured predictions the agents committed to and what the
 * lab measured, it quantifies systematic bias (over-optimism), error magnitude,
 * rank fidelity, confidence calibration, and per-intervention-class bias. The
 * resulting profile is fed back into agent prompts so next cycle's predictions
 * are discounted where the model has historically been wrong.
 */

/** A matched (predicted, measured) pair for one design. */
interface Pair {
  design: StrainDesign
  predicted: number // signed relative change vs baseline
  measured: number // signed relative change vs baseline
  confidence?: number
  /** Whether the measured change went in the predicted direction (for Brier). */
  hit: number
}

/** Direction-signed predicted relative change, or undefined if not quantified. */
export function signedPrediction(p: QuantPrediction | undefined): number | undefined {
  if (!p || typeof p.relativeChange !== 'number' || !Number.isFinite(p.relativeChange)) return undefined
  const mag = Math.abs(p.relativeChange)
  return p.direction === 'decrease' ? -mag : mag
}

/** Signed measured relative change vs baseline, or undefined if not computable. */
export function signedMeasured(r: ExperimentalResult): number | undefined {
  if (
    typeof r.measuredValue !== 'number' ||
    typeof r.baselineValue !== 'number' ||
    !Number.isFinite(r.measuredValue) ||
    !Number.isFinite(r.baselineValue) ||
    r.baselineValue === 0
  ) {
    return undefined
  }
  return (r.measuredValue - r.baselineValue) / r.baselineValue
}

/** Build the (prediction, measurement) pairs that are actually comparable. */
function buildPairs(designs: StrainDesign[], results: ExperimentalResult[]): Pair[] {
  const pairs: Pair[] = []
  const byId = new Map(designs.map((d) => [d.id, d]))
  // Most-recent recorded result per design that has a computable measured change.
  const latest = new Map<string, ExperimentalResult>()
  for (const r of results) {
    if (r.status !== 'recorded') continue
    if (signedMeasured(r) === undefined) continue
    const prev = latest.get(r.designId)
    if (!prev || r.createdAt >= prev.createdAt) latest.set(r.designId, r)
  }
  for (const [designId, r] of latest) {
    const design = byId.get(designId)
    if (!design) continue
    const predicted = signedPrediction(design.quantPrediction)
    const measured = signedMeasured(r)
    if (predicted === undefined || measured === undefined) continue
    // Skip if the prediction and result clearly measure different phenotypes.
    if (r.metric && design.quantPrediction && r.metric !== design.quantPrediction.metric) continue
    const sameDirection = Math.sign(predicted) === Math.sign(measured) && measured !== 0
    pairs.push({
      design,
      predicted,
      measured,
      confidence: design.quantPrediction?.confidence,
      hit: sameDirection && (r.outcome === 'confirmed' || r.outcome === 'partial') ? 1 : 0
    })
  }
  return pairs
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

/** Fractional (tie-averaged) ranks, 1-based. */
function ranks(xs: number[]): number[] {
  const order = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  const out = new Array<number>(xs.length).fill(0)
  let i = 0
  while (i < order.length) {
    let j = i
    while (j + 1 < order.length && order[j + 1].v === order[i].v) j++
    const avg = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) out[order[k].i] = avg
    i = j + 1
  }
  return out
}

function pearson(x: number[], y: number[]): number {
  const n = x.length
  if (n < 2) return 0
  const mx = mean(x)
  const my = mean(y)
  let num = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my)
    dx += (x[i] - mx) ** 2
    dy += (y[i] - my) ** 2
  }
  const den = Math.sqrt(dx * dy)
  return den === 0 ? 0 : num / den
}

function round(n: number, dp = 3): number {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

/**
 * Compute the calibration profile for a campaign. Returns null when there are no
 * comparable (prediction, measurement) pairs yet — nothing to calibrate against.
 */
export function computeCalibration(
  campaignId: string,
  cycle: number,
  at: number,
  designs: StrainDesign[],
  results: ExperimentalResult[]
): CalibrationProfile | null {
  const pairs = buildPairs(designs, results)
  if (pairs.length === 0) return null

  const errors = pairs.map((p) => p.predicted - p.measured)
  const signedBias = mean(errors)
  const meanAbsError = mean(errors.map(Math.abs))
  const spearman = pearson(
    ranks(pairs.map((p) => p.predicted)),
    ranks(pairs.map((p) => p.measured))
  )

  const withConf = pairs.filter((p) => typeof p.confidence === 'number')
  const brier = withConf.length
    ? mean(withConf.map((p) => ((p.confidence as number) - p.hit) ** 2))
    : undefined

  // Per-intervention-type bias: attribute each design's error to every
  // intervention type it uses, then average within each type.
  const byType = new Map<InterventionType, number[]>()
  for (const p of pairs) {
    const err = p.predicted - p.measured
    const types = new Set(p.design.interventions.map((iv) => iv.type))
    for (const t of types) {
      const arr = byType.get(t) ?? []
      arr.push(err)
      byType.set(t, arr)
    }
  }
  const biasByInterventionType: Partial<Record<InterventionType, number>> = {}
  for (const [t, errs] of byType) biasByInterventionType[t] = round(mean(errs))

  return {
    campaignId,
    cycle,
    at,
    nPairs: pairs.length,
    signedBias: round(signedBias),
    meanAbsError: round(meanAbsError),
    spearman: round(spearman),
    brier: brier === undefined ? undefined : round(brier),
    biasByInterventionType
  }
}

/**
 * A short natural-language calibration note for agent prompts — names the
 * systematic biases the model should correct for. Empty string when there's
 * nothing notable yet.
 */
export function calibrationNote(profile: CalibrationProfile | undefined): string {
  if (!profile || profile.nPairs === 0) return ''
  const lines: string[] = []
  const dir = profile.signedBias > 0 ? 'over-predicting' : 'under-predicting'
  if (Math.abs(profile.signedBias) >= 0.05) {
    lines.push(
      `Across ${profile.nPairs} measured design(s) you have been ${dir} the relative effect by ~${Math.round(
        Math.abs(profile.signedBias) * 100
      )} percentage points on average — adjust predicted magnitudes accordingly.`
    )
  }
  const worst = Object.entries(profile.biasByInterventionType)
    .filter(([, v]) => Math.abs(v as number) >= 0.1)
    .sort((a, b) => Math.abs(b[1] as number) - Math.abs(a[1] as number))
    .slice(0, 3)
  for (const [type, v] of worst) {
    lines.push(
      `${type} interventions are ${
        (v as number) > 0 ? 'over' : 'under'
      }-predicted by ~${Math.round(Math.abs(v as number) * 100)} pts.`
    )
  }
  if (profile.spearman < 0.3 && profile.nPairs >= 3) {
    lines.push(
      `Predicted vs measured ranking correlation is weak (Spearman ${profile.spearman}); your relative ordering of designs is not yet tracking reality.`
    )
  }
  return lines.join(' ')
}
