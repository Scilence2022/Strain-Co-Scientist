import { useState } from 'react'
import { useStore } from '../store/useStore'
import { Empty } from '../components/ui'
import { IconOverview, IconRefresh } from '../components/Icons'

export function ResearchOverview(): JSX.Element {
  const { snapshot, selectedId, openDesign, setView } = useStore()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!snapshot) return <div className="page"><Empty icon={<IconOverview size={36} />} title="No campaign selected" /></div>

  const latest = snapshot.metaReviews[snapshot.metaReviews.length - 1]
  // A meta-review record can exist with an empty overview (e.g. an LLM parse
  // failure at end-of-run). Treat that as "not generated" so the scientist can
  // retry, rather than showing a blank card.
  const meta = latest && (latest.overview.summary.trim() || latest.overview.areas.length > 0) ? latest : undefined
  const designTitle = (id: string) => snapshot.designs.find((d) => d.id === id)?.title

  const generate = async () => {
    if (!selectedId) return
    setBusy(true)
    setError(null)
    const res = await window.api.regenerateOverview(selectedId)
    setBusy(false)
    if (!res.ok) setError(res.message)
    // On success the new meta-review streams in via the engine event and the
    // view re-renders automatically.
  }

  if (!meta) {
    return (
      <div className="page">
        <Empty
          icon={<IconOverview size={36} />}
          title="No research overview yet"
          hint="The Meta-review agent synthesises a DBTL roadmap from the campaign's reviews and tournament. It runs automatically at the end of a campaign — or generate it now from the current state."
          action={
            <div className="col gap-sm" style={{ alignItems: 'center' }}>
              <button className="btn btn-primary" onClick={generate} disabled={busy}>
                <IconRefresh size={14} /> {busy ? 'Generating…' : 'Generate research overview'}
              </button>
              {error && <div className="badge err">{error}</div>}
            </div>
          }
        />
      </div>
    )
  }

  return (
    <div className="page page-narrow col gap-lg">
      <div className="row">
        <div>
          <h2 style={{ fontSize: 'var(--fs-xl)', marginBottom: 6 }}>Research overview</h2>
          <div className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
            Synthesised by the Meta-review agent · cycle {meta.cycle}
          </div>
        </div>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={generate} disabled={busy} title="Re-synthesise from the current campaign state">
          <IconRefresh size={13} /> {busy ? 'Regenerating…' : 'Regenerate'}
        </button>
      </div>
      {error && <div className="badge err" style={{ alignSelf: 'flex-start' }}>{error}</div>}

      <div className="card pad-lg">
        <div className="section-title">Executive summary</div>
        <p style={{ lineHeight: 1.6, margin: 0 }}>{meta.overview.summary}</p>
      </div>

      <div className="col gap-md">
        <div className="section-title">Engineering roadmap</div>
        {meta.overview.areas.map((area, i) => (
          <div key={i} className="card">
            <div className="card-title" style={{ marginBottom: 8 }}>{area.title}</div>
            <p className="muted" style={{ marginTop: 0, lineHeight: 1.55 }}>{area.justification}</p>
            {area.exampleExperiments.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 12 }}>Example experiments</div>
                <ul className="list-tight" style={{ margin: 0, paddingLeft: 18 }}>
                  {area.exampleExperiments.map((e, k) => (
                    <li key={k}>{e}</li>
                  ))}
                </ul>
              </>
            )}
            {area.relatedDesignIds.length > 0 && (
              <div className="row wrap gap-sm" style={{ marginTop: 12 }}>
                {area.relatedDesignIds.map((id) => (
                  <button
                    key={id}
                    className="badge accent"
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      openDesign(id)
                      setView('designs')
                    }}
                  >
                    {designTitle(id) ?? 'design'}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {meta.critiquePatterns.length > 0 && (
        <div className="card">
          <div className="section-title">Recurring critique patterns</div>
          <ul className="list-tight muted" style={{ margin: 0, paddingLeft: 18 }}>
            {meta.critiquePatterns.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {meta.suggestedExperts.length > 0 && (
        <div className="card">
          <div className="section-title">Suggested collaborators</div>
          <div className="col gap-md">
            {meta.suggestedExperts.map((e, i) => (
              <div key={i}>
                <div style={{ fontWeight: 600 }}>{e.name}</div>
                <div className="faint" style={{ fontSize: 'var(--fs-sm)' }}>{e.expertise}</div>
                <div className="muted" style={{ marginTop: 3 }}>{e.rationale}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
