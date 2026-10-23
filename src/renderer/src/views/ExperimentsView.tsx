import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { Empty, EvidenceBadge } from '../components/ui'
import { RecordResultForm, ResultsList } from '../components/Results'
import { CalibrationScatter, BiasTrend } from '../components/Charts'
import { ExportButton } from '../components/ExportButton'
import { experimentBrief, exportName, hasConflictingResults, resultsCsv } from '@shared/workbench'
import { IconExperiment } from '../components/Icons'
import {
  compareDesigns,
  INTERVENTION_LABELS,
  type ExperimentalResult,
  type InterventionType,
  type StrainDesign
} from '@shared/domain'

function signedPredicted(d: StrainDesign): number | undefined {
  const p = d.quantPrediction
  if (!p || typeof p.relativeChange !== 'number') return undefined
  const mag = Math.abs(p.relativeChange)
  return p.direction === 'decrease' ? -mag : mag
}

function signedMeasured(r: ExperimentalResult): number | undefined {
  if (
    typeof r.measuredValue !== 'number' ||
    typeof r.baselineValue !== 'number' ||
    r.baselineValue === 0
  ) {
    return undefined
  }
  return (r.measuredValue - r.baselineValue) / r.baselineValue
}

export function ExperimentsView(): JSX.Element {
  const { snapshot, refreshSnapshot, openDesign, setView } = useStore()
  const [recordingId, setRecordingId] = useState('')
  const recordRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!recordingId) return
    recordRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    recordRef.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
  }, [recordingId])

  const data = useMemo(() => {
    const designs = snapshot?.designs ?? []
    const results = snapshot?.results ?? []
    const byId = new Map(designs.map((d) => [d.id, d]))

    // Latest recorded, measurable result per design → a calibration scatter point.
    const latest = new Map<string, ExperimentalResult>()
    for (const r of results) {
      if (r.status !== 'recorded' || signedMeasured(r) === undefined) continue
      const prediction = byId.get(r.designId)?.quantPrediction
      if (r.metric && prediction && r.metric !== prediction.metric) continue
      const prev = latest.get(r.designId)
      if (!prev || r.createdAt >= prev.createdAt) latest.set(r.designId, r)
    }
    const points: { predicted: number; measured: number; label: string }[] = []
    for (const [designId, r] of latest) {
      const d = byId.get(designId)
      if (!d) continue
      const predicted = signedPredicted(d)
      const measured = signedMeasured(r)
      if (predicted === undefined || measured === undefined) continue
      points.push({ predicted, measured, label: d.title })
    }

    // Designs that carry any result, best-evidence first.
    const designsWithResults = designs
      .filter((d) => results.some((r) => r.designId === d.id))
      .sort(compareDesigns)

    return { results, points, designsWithResults }
  }, [snapshot?.designs, snapshot?.results])

  if (!snapshot) {
    return (
      <div className="page">
        <Empty icon={<IconExperiment size={36} />} title="No campaign selected" />
      </div>
    )
  }

  const shortlisted = snapshot.designs.filter((d) => d.status === 'flagged').sort(compareDesigns)
  const pending = shortlisted.filter(
    (d) => !snapshot.results.some((r) => r.designId === d.id && r.status === 'recorded')
  )
  const calibration = snapshot.calibration ?? []
  const latestCal = calibration[calibration.length - 1]
  const terminal =
    snapshot.campaign.status === 'completed' ||
    snapshot.campaign.status === 'stopped' ||
    snapshot.campaign.status === 'error'

  const typeBias = latestCal
    ? (Object.entries(latestCal.biasByInterventionType) as [InterventionType, number][])
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .slice(0, 6)
    : []
  const maxBias = Math.max(0.01, ...typeBias.map(([, v]) => Math.abs(v)))

  return (
    <div className="page col gap-lg">
      <div className="row">
        <div>
          <div className="eyebrow">Build → test → learn</div>
          <h1>Experiments &amp; results</h1>
          <div className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
            Plan the next batch, record matched controls and bring the observations into your next
            design round.
          </div>
        </div>
        <span className="spacer" />
        {terminal && (
          <button
            className="btn btn-sm"
            onClick={() => window.api.reopenCampaign(snapshot.campaign.id)}
          >
            Start a results-informed research round
          </button>
        )}
      </div>

      <div className="row wrap gap-sm">
        <ExportButton
          disabled={!shortlisted.length}
          name={exportName(snapshot.campaign, 'experiment-brief.md')}
          contents={() => experimentBrief(snapshot, shortlisted)}
          label={`Export shortlist brief (${shortlisted.length})`}
        />
        <ExportButton
          csv
          disabled={!snapshot.results.length}
          name={exportName(snapshot.campaign, 'results.csv')}
          contents={() => resultsCsv(snapshot)}
          label="Export result records (CSV)"
        />
      </div>
      <section className="card pad-lg">
        <div className="card-head">
          <h2 className="card-title">Your next experimental batch</h2>
          <span className="badge warn">{pending.length} awaiting results</span>
        </div>
        <p className="hint">
          Shortlisted designs are candidates you chose to investigate. Confirm the plan and controls
          before starting work.
        </p>
        {!shortlisted.length ? (
          <Empty
            title="No candidates shortlisted"
            hint="Compare design strategies and choose a small, informative set for your lab."
            action={
              <button className="btn" onClick={() => setView('designs')}>
                Choose candidates →
              </button>
            }
          />
        ) : (
          <div className="col gap-sm">
            {shortlisted.map((d) => (
              <div className="experiment-queue-item" key={d.id}>
                <div>
                  <button className="text-button design-title" onClick={() => openDesign(d.id)}>
                    {d.title}
                  </button>
                  <div className="hint">
                    {d.interventions.length} proposed changes ·{' '}
                    {snapshot.results.some((r) => r.designId === d.id && r.status === 'recorded')
                      ? 'Results recorded; retesting available'
                      : 'Awaiting first result'}
                  </div>
                </div>
                <EvidenceBadge grade={d.evidence} showPredicted />
                <button className="btn btn-sm btn-primary" onClick={() => setRecordingId(d.id)}>
                  Record result
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
      <section ref={recordRef} className="card pad-lg" id="record-result">
        <div className="card-head">
          <h2 className="card-title">Record an experiment</h2>
        </div>
        <p className="hint">
          Record any design, including a failed build or an inconclusive assay. Keep actual batch
          conditions with the data.
        </p>
        <div className="field">
          <label htmlFor="result-design">Design tested</label>
          <select
            id="result-design"
            value={recordingId}
            onChange={(e) => setRecordingId(e.target.value)}
          >
            <option value="">Choose a design…</option>
            {[...snapshot.designs].sort(compareDesigns).map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
                {d.status === 'flagged' ? ' · shortlisted' : ''}
              </option>
            ))}
          </select>
        </div>
        {recordingId && (
          <RecordResultForm
            key={recordingId}
            campaignId={snapshot.campaign.id}
            designId={recordingId}
            onDone={refreshSnapshot}
          />
        )}
      </section>
      <details className="advanced">
        <summary>Prediction accuracy & model calibration</summary>
        <p className="hint">
          Compares latest active measurements with quantified predictions of the same phenotype.
          Relative changes are comparable only when baseline and culture context are appropriate;
          review the underlying batches.
        </p>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="card">
            <div className="card-head">
              <div className="card-title">Predicted vs measured</div>
              {latestCal && <span className="badge">Spearman {latestCal.spearman.toFixed(2)}</span>}
            </div>
            <CalibrationScatter points={data.points} />
          </div>
          <div className="card">
            <div className="card-head">
              <div className="card-title">Calibration over cycles</div>
              {latestCal && (
                <span className="badge">
                  {latestCal.nPairs} pair{latestCal.nPairs === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <BiasTrend profiles={calibration} />
            {typeBias.length > 0 && (
              <div className="col gap-sm" style={{ marginTop: 12 }}>
                <div className="section-title">Bias by intervention type</div>
                {typeBias.map(([t, v]) => (
                  <div key={t} className="row gap-md">
                    <span className="muted" style={{ width: 120, fontSize: 'var(--fs-sm)' }}>
                      {INTERVENTION_LABELS[t]}
                    </span>
                    <div className="bar-mini" style={{ flex: 1 }}>
                      <span
                        style={{
                          width: `${(Math.abs(v) / maxBias) * 100}%`,
                          background: v >= 0 ? 'var(--amber)' : 'var(--blue)'
                        }}
                      />
                    </div>
                    <span className="mono" style={{ width: 48, textAlign: 'right' }}>
                      {v >= 0 ? '+' : ''}
                      {Math.round(v * 100)}
                    </span>
                  </div>
                ))}
                <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                  Points = signed prediction error (predicted − measured). Positive =
                  over-predicted.
                </span>
              </div>
            )}
          </div>
        </div>
      </details>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Recorded results ({data.results.length})</div>
        </div>
        {data.designsWithResults.length === 0 ? (
          <Empty
            title="No experimental results yet"
            hint="Choose a tested design in the form above. Observations from unsuccessful experiments are useful too."
          />
        ) : (
          <div className="col gap-lg">
            {data.designsWithResults.map((d) => (
              <div key={d.id}>
                <div className="row gap-sm" style={{ marginBottom: 8 }}>
                  <button className="text-button design-title" onClick={() => openDesign(d.id)}>
                    {d.title}
                  </button>
                  <EvidenceBadge grade={d.evidence} showPredicted />
                  <span className="spacer" />
                  {hasConflictingResults(snapshot.results.filter((r) => r.designId === d.id)) && (
                    <span className="badge warn">Conflicting outcomes — review conditions</span>
                  )}
                </div>
                <ResultsList
                  results={snapshot.results.filter((r) => r.designId === d.id)}
                  onChanged={refreshSnapshot}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
