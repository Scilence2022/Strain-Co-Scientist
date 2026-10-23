import { useId, useState } from 'react'
import { useStore } from '../store/useStore'
import { METRIC_LABELS, METRIC_UNITS, predictionLabel } from '@shared/workbench'
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
  const { snapshot } = useStore()
  const design = snapshot?.designs.find((d) => d.id === designId)
  const lab = snapshot?.campaign.labContext
  const initialMetric = design?.quantPrediction?.metric ?? lab?.metric ?? 'titer'
  const prefix = useId()
  const [outcome, setOutcome] = useState<ResultOutcome | ''>('')
  const [metric, setMetric] = useState<QuantPrediction['metric']>(initialMetric)
  const [measuredValue, setMeasuredValue] = useState('')
  const [baselineValue, setBaselineValue] = useState('')
  const [unit, setUnit] = useState(
    lab?.metric === initialMetric ? (lab.unit ?? '') : METRIC_UNITS[initialMetric]
  )
  const [replicates, setReplicates] = useState('')
  const [observations, setObservations] = useState('')
  const [author, setAuthor] = useState('')
  const [runLabel, setRunLabel] = useState('')
  const [strainLabel, setStrainLabel] = useState('')
  const [conditions, setConditions] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const num = (s: string): number | undefined =>
    s.trim() && Number.isFinite(Number(s)) ? Number(s) : undefined
  const hasValues = measuredValue.trim() !== '' || baselineValue.trim() !== ''
  const validValues =
    !hasValues ||
    (num(measuredValue) !== undefined && num(baselineValue) !== undefined && !!unit.trim())
  const validReplicates =
    !replicates.trim() ||
    (Number.isInteger(Number(replicates)) &&
      Number(replicates) >= 1 &&
      Number(replicates) <= 1000000)
  const valid = !!outcome && !!observations.trim() && validValues && validReplicates
  const measured = num(measuredValue),
    baseline = num(baselineValue)
  const delta =
    measured !== undefined && baseline !== undefined && baseline !== 0
      ? ((measured - baseline) / baseline) * 100
      : undefined

  const submit = async (): Promise<void> => {
    if (!valid || !outcome || busy) return
    setBusy(true)
    setError('')
    setSaved(false)
    try {
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
        author: author.trim() || undefined,
        runLabel: runLabel.trim() || undefined,
        strainLabel: strainLabel.trim() || undefined,
        conditions: conditions.trim() || undefined
      })
      setMeasuredValue('')
      setBaselineValue('')
      setReplicates('')
      setObservations('')
      setRunLabel('')
      setStrainLabel('')
      setConditions('')
      setOutcome('')
      setSaved(true)
      onDone?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="col gap-md">
      {design && (
        <div className="brief-summary">
          <b>{predictionLabel(design)}</b>
          <div className="hint">
            Prediction reference: {design.quantPrediction?.baselineNote || 'Not specified'}. Choose
            the conclusion from your experiment; the model does not assign it for you.
          </div>
        </div>
      )}
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor={`${prefix}-run`}>Experiment / batch ID</label>
          <input
            id={`${prefix}-run`}
            value={runLabel}
            onChange={(e) => setRunLabel(e.target.value)}
            placeholder="Lab notebook reference"
          />
        </div>
        <div className="field">
          <label htmlFor={`${prefix}-strain`}>Tested strain ID</label>
          <input
            id={`${prefix}-strain`}
            value={strainLabel}
            onChange={(e) => setStrainLabel(e.target.value)}
            placeholder="Your strain collection identifier"
          />
        </div>
      </div>
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor={`${prefix}-outcome`}>Experimental conclusion *</label>
          <select
            id={`${prefix}-outcome`}
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as ResultOutcome)}
          >
            <option value="">Select after reviewing the data…</option>
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {RESULT_OUTCOME_LABELS[o]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${prefix}-metric`}>Measured phenotype</label>
          <select
            id={`${prefix}-metric`}
            value={metric}
            onChange={(e) => {
              const next = e.target.value as QuantPrediction['metric']
              setMetric(next)
              setUnit(lab?.metric === next ? (lab.unit ?? '') : METRIC_UNITS[next])
              setMeasuredValue('')
              setBaselineValue('')
            }}
          >
            {METRICS.map((m) => (
              <option key={m} value={m}>
                {METRIC_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="hint">
        Confirmed = meets the predicted improvement; Partial = some support; Refuted = contradicts
        it. Use Inconclusive for uncertain assays and Build failed for construction failures. These
        conclusions update evidence ranking.
      </div>
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor={`${prefix}-measured`}>Engineered strain value</label>
          <input
            id={`${prefix}-measured`}
            type="number"
            step="any"
            value={measuredValue}
            onChange={(e) => setMeasuredValue(e.target.value)}
            placeholder="Measured value"
          />
        </div>
        <div className="field">
          <label htmlFor={`${prefix}-baseline`}>Reference strain value (same conditions)</label>
          <input
            id={`${prefix}-baseline`}
            type="number"
            step="any"
            value={baselineValue}
            onChange={(e) => setBaselineValue(e.target.value)}
            placeholder={
              lab?.metric === metric && lab.baselineValue !== undefined
                ? `Project baseline: ${lab.baselineValue}; enter actual control`
                : 'Measured control / parental strain'
            }
          />
        </div>
        <div className="field">
          <label htmlFor={`${prefix}-unit`}>Shared unit</label>
          <input id={`${prefix}-unit`} value={unit} onChange={(e) => setUnit(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${prefix}-replicates`}>Biological replicates (n)</label>
          <input
            id={`${prefix}-replicates`}
            type="number"
            min={1}
            step={1}
            value={replicates}
            onChange={(e) => setReplicates(e.target.value)}
            placeholder="Leave blank if unknown"
          />
        </div>
      </div>
      {hasValues && !validValues && (
        <p className="form-error">
          Enter both measured values and a shared unit, or leave both values blank for a qualitative
          observation.
        </p>
      )}
      {!validReplicates && (
        <p className="form-error">Replicates must be a positive whole number.</p>
      )}
      {baseline === 0 && (
        <p className="hint">
          A zero reference is retained; a relative percentage cannot be calculated.
        </p>
      )}
      {delta !== undefined && (
        <div className="measurement-preview">
          Observed change:{' '}
          <b>
            {delta >= 0 ? '+' : ''}
            {delta.toFixed(1)}%
          </b>{' '}
          vs this control. Interpret direction against your objective.
        </div>
      )}
      <div className="field">
        <label htmlFor={`${prefix}-conditions`}>
          Actual conditions & differences from the project reference
        </label>
        <textarea
          id={`${prefix}-conditions`}
          rows={2}
          value={conditions}
          onChange={(e) => setConditions(e.target.value)}
          placeholder="Medium, substrate, scale, time point, aeration; state if conditions match the project reference."
        />
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-observations`}>Observations & interpretation *</label>
        <textarea
          id={`${prefix}-observations`}
          rows={3}
          value={observations}
          onChange={(e) => setObservations(e.target.value)}
          placeholder="Product, growth, substrate uptake, byproducts, variability and failure modes. What should the next design preserve or change?"
        />
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-author`}>Reported by</label>
        <input
          id={`${prefix}-author`}
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          placeholder="Name / lab (optional)"
        />
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error} Your entries are preserved. Retry when ready.
        </div>
      )}
      {saved && (
        <div className="measurement-preview" role="status">
          Result saved. Evidence ranking has been updated. Resume or re-open research to incorporate
          it into new proposals.
        </div>
      )}
      <div className="row">
        <span className="hint">Qualitative and failed experiments are useful evidence too.</span>
        <span className="spacer" />
        <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void submit()}>
          {busy ? 'Saving result…' : 'Save experimental result'}
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
                  <span className="mono" style={{ color: 'var(--text)' }}>
                    {delta}
                    {typeof r.measuredValue === 'number' && r.unit
                      ? ` (${r.measuredValue}${r.unit})`
                      : ''}
                  </span>
                )}
                {r.replicates ? (
                  <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                    n={r.replicates}
                  </span>
                ) : null}
                {disputed && (
                  <span className="badge warn">
                    {r.status === 'superseded' ? 'Superseded' : 'Disputed'}
                  </span>
                )}
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
                  {disputed ? 'Restore to evidence' : 'Exclude from evidence'}
                </button>
              </div>
              <div className="muted prose">{r.observations}</div>
              {(r.runLabel || r.strainLabel) && (
                <div className="hint">
                  Batch: {r.runLabel || 'unspecified'} · Strain: {r.strainLabel || 'unspecified'}
                </div>
              )}
              {(r.measuredValue !== undefined || r.baselineValue !== undefined) && (
                <div className="hint">
                  Measured: {r.measuredValue ?? '—'} vs reference {r.baselineValue ?? '—'} {r.unit}
                </div>
              )}
              <div className="hint">Conditions: {r.conditions || 'Not recorded'}</div>
            </div>
          )
        })}
    </div>
  )
}
