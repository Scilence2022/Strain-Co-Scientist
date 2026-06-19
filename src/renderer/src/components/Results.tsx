import { useState } from 'react'
import type { ExperimentalResult, QuantPrediction, ResultOutcome } from '@shared/domain'
import { RESULT_OUTCOME_LABELS } from '@shared/domain'
import { OutcomeBadge, timeAgo } from './ui'

const OUTCOMES = Object.keys(RESULT_OUTCOME_LABELS) as ResultOutcome[]
const METRICS: QuantPrediction['metric'][] = ['titer', 'rate', 'yield', 'tolerance', 'other']

/** Signed relative change of a result vs its baseline, as a "+30%" string, or null. */
export function resultDelta(r: ExperimentalResult): string | null {
  if (
    typeof r.measuredValue !== 'number' ||
    typeof r.baselineValue !== 'number' ||
    r.baselineValue === 0
  ) {
    return null
  }
  const pct = Math.round(((r.measuredValue - r.baselineValue) / r.baselineValue) * 100)
  return `${pct >= 0 ? '+' : ''}${pct}%`
}

/**
 * Record a wet-lab result against one design. This is the ingestion point that
 * closes the DBTL loop — on submit the engine re-derives the design's evidence
 * grade and the campaign's calibration.
 */
export function RecordResultForm({
  campaignId,
  designId,
  onDone
}: {
  campaignId: string
  designId: string
  onDone?: () => void
}): JSX.Element {
  const [outcome, setOutcome] = useState<ResultOutcome>('confirmed')
  const [metric, setMetric] = useState<QuantPrediction['metric']>('titer')
  const [measuredValue, setMeasuredValue] = useState('')
  const [baselineValue, setBaselineValue] = useState('')
  const [unit, setUnit] = useState('')
  const [replicates, setReplicates] = useState('')
  const [observations, setObservations] = useState('')
  const [author, setAuthor] = useState('')
  const [busy, setBusy] = useState(false)

  const num = (s: string): number | undefined => {
    const n = Number(s)
    return s.trim() !== '' && Number.isFinite(n) ? n : undefined
  }

  const submit = async (): Promise<void> => {
    if (!observations.trim()) return
    setBusy(true)
    await window.api.recordExperimentalResult({
      campaignId,
      designId,
      outcome,
      metric,
      measuredValue: num(measuredValue),
      baselineValue: num(baselineValue),
      unit: unit.trim() || undefined,
      replicates: num(replicates),
      observations: observations.trim(),
      author: author.trim() || undefined
    })
    setMeasuredValue('')
    setBaselineValue('')
    setUnit('')
    setReplicates('')
    setObservations('')
    setBusy(false)
    onDone?.()
  }

  return (
    <div className="col gap-sm">
      <div className="grid grid-2">
        <div className="field">
          <label>Outcome</label>
          <select value={outcome} onChange={(e) => setOutcome(e.target.value as ResultOutcome)}>
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {RESULT_OUTCOME_LABELS[o]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Metric</label>
          <select value={metric} onChange={(e) => setMetric(e.target.value as QuantPrediction['metric'])}>
            {METRICS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 0.7fr 0.6fr' }}>
        <div className="field">
          <label>Measured</label>
          <input type="number" value={measuredValue} onChange={(e) => setMeasuredValue(e.target.value)} placeholder="e.g. 4.2" />
        </div>
        <div className="field">
          <label>Baseline</label>
          <input type="number" value={baselineValue} onChange={(e) => setBaselineValue(e.target.value)} placeholder="e.g. 3.0" />
        </div>
        <div className="field">
          <label>Unit</label>
          <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="g/L" />
        </div>
        <div className="field">
          <label>n</label>
          <input type="number" value={replicates} onChange={(e) => setReplicates(e.target.value)} placeholder="3" />
        </div>
      </div>
      <div className="field">
        <label>Observations (include failure modes)</label>
        <textarea
          rows={2}
          value={observations}
          onChange={(e) => setObservations(e.target.value)}
          placeholder="What was observed — phenotype, growth, byproducts, failures…"
        />
      </div>
      <div className="row">
        <input
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          placeholder="Reported by (optional)"
          style={{ maxWidth: 200 }}
        />
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" disabled={!observations.trim() || busy} onClick={submit}>
          Record result
        </button>
      </div>
    </div>
  )
}

/** Render a design's recorded results, with an optional dispute/restore control. */
export function ResultsList({
  results,
  onChanged
}: {
  results: ExperimentalResult[]
  onChanged?: () => void
}): JSX.Element {
  if (results.length === 0) return <span className="faint">No results recorded yet.</span>
  return (
    <div className="col gap-sm">
      {[...results]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((r) => {
          const delta = resultDelta(r)
          const disputed = r.status !== 'recorded'
          return (
            <div key={r.id} className="lineage-node" style={{ opacity: disputed ? 0.55 : 1 }}>
              <div className="row gap-sm" style={{ marginBottom: 4 }}>
                <OutcomeBadge outcome={r.outcome} />
                {r.metric && <span className="badge">{r.metric}</span>}
                {delta && (
                  <span className="mono" style={{ color: delta.startsWith('-') ? 'var(--red)' : 'var(--green)' }}>
                    {delta}
                    {typeof r.measuredValue === 'number' && r.unit ? ` (${r.measuredValue}${r.unit})` : ''}
                  </span>
                )}
                {r.replicates ? <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>n={r.replicates}</span> : null}
                {disputed && <span className="badge warn">Disputed</span>}
                <span className="spacer" />
                <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                  {r.author} · {timeAgo(r.createdAt)}
                </span>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={async () => {
                    await window.api.disputeResult(r.campaignId, r.id, !disputed)
                    onChanged?.()
                  }}
                >
                  {disputed ? 'Restore' : 'Dispute'}
                </button>
              </div>
              <div className="muted">{r.observations}</div>
            </div>
          )
        })}
    </div>
  )
}
