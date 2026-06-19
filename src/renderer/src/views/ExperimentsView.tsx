import { useMemo } from 'react'
import { useStore } from '../store/useStore'
import { Empty, EvidenceBadge } from '../components/ui'
import { ResultsList } from '../components/Results'
import { CalibrationScatter, BiasTrend } from '../components/Charts'
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
  if (typeof r.measuredValue !== 'number' || typeof r.baselineValue !== 'number' || r.baselineValue === 0) {
    return undefined
  }
  return (r.measuredValue - r.baselineValue) / r.baselineValue
}

export function ExperimentsView(): JSX.Element {
  const { snapshot, refreshSnapshot } = useStore()

  const data = useMemo(() => {
    const designs = snapshot?.designs ?? []
    const results = snapshot?.results ?? []
    const byId = new Map(designs.map((d) => [d.id, d]))

    // Latest recorded, measurable result per design → a calibration scatter point.
    const latest = new Map<string, ExperimentalResult>()
    for (const r of results) {
      if (r.status !== 'recorded' || signedMeasured(r) === undefined) continue
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
          <h2 style={{ fontSize: 'var(--fs-xl)', marginBottom: 6 }}>Experiments &amp; learning</h2>
          <div className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
            Wet-lab results close the DBTL loop: they outrank predicted designs and recalibrate the agents.
          </div>
        </div>
        <span className="spacer" />
        {terminal && (
          <button className="btn btn-sm" onClick={() => window.api.reopenCampaign(snapshot.campaign.id)}>
            Re-open campaign
          </button>
        )}
      </div>

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
              <span className="badge">{latestCal.nPairs} pair{latestCal.nPairs === 1 ? '' : 's'}</span>
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
                Points = signed prediction error (predicted − measured). Positive = over-predicted.
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Recorded results ({data.results.length})</div>
        </div>
        {data.designsWithResults.length === 0 ? (
          <Empty
            title="No experimental results yet"
            hint="Record wet-lab outcomes from the Designs drawer or the Expert-in-the-loop view to close the loop."
          />
        ) : (
          <div className="col gap-lg">
            {data.designsWithResults.map((d) => (
              <div key={d.id}>
                <div className="row gap-sm" style={{ marginBottom: 8 }}>
                  <span style={{ fontWeight: 600 }}>{d.title}</span>
                  <EvidenceBadge grade={d.evidence} showPredicted />
                  <span className="spacer" />
                  <span className="badge accent">Elo {d.elo}</span>
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
