import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import {
  DesignStatusBadge,
  Empty,
  EvidenceBadge,
  OriginBadge,
  VerdictBadge
} from '../components/ui'
import { RecordResultForm, ResultsList } from '../components/Results'
import { Drawer } from '../components/Drawer'
import { ExportButton } from '../components/ExportButton'
import {
  compareDesigns,
  CRITERION_LABELS,
  EVOLUTION_STRATEGY_LABELS,
  INTERVENTION_LABELS,
  REVIEW_TYPE_LABELS,
  type CriterionKey,
  type StrainDesign
} from '@shared/domain'
import {
  canShortlist,
  designGaps,
  experimentBrief,
  exportName,
  hasConflictingResults,
  predictionLabel
} from '@shared/workbench'

type Filter = 'active' | 'all' | 'flagged' | 'rejected'

export function ShortlistButton({ design }: { design: StrainDesign }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { refreshSnapshot } = useStore()
  return (
    <div className="col gap-sm">
      <button
        className={`btn btn-sm ${design.status === 'flagged' ? '' : 'btn-primary'}`}
        disabled={busy || !canShortlist(design)}
        title={
          !canShortlist(design)
            ? 'This design needs review before it can be shortlisted.'
            : 'Choose candidates for your lab; this does not approve a protocol.'
        }
        onClick={async () => {
          setBusy(true)
          setError('')
          try {
            await window.api.flagDesign(design.id, design.status !== 'flagged')
            await refreshSnapshot()
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy
          ? 'Saving…'
          : design.status === 'flagged'
            ? 'Remove from shortlist'
            : 'Shortlist for lab'}
      </button>
      {error && (
        <span className="form-error" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}

export function DesignsExplorer(): JSX.Element {
  const { snapshot, selectedDesignId, openDesign } = useStore()
  const [filter, setFilter] = useState<Filter>('active')
  const [search, setSearch] = useState('')
  const [evidence, setEvidence] = useState('all')
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [comparing, setComparing] = useState(false)
  const designs = useMemo(() => {
    let list = snapshot?.designs ?? []
    if (filter === 'active') list = list.filter(canShortlist)
    else if (filter !== 'all') list = list.filter((d) => d.status === filter)
    if (evidence === 'measured')
      list = list.filter((d) => d.evidence && d.evidence !== 'predicted-only')
    if (evidence === 'unmeasured')
      list = list.filter((d) => !d.evidence || d.evidence === 'predicted-only')
    const query = search.trim().toLowerCase()
    if (query)
      list = list.filter((d) =>
        [
          d.title,
          d.summary,
          d.mechanism,
          ...d.interventions.flatMap((iv) => [
            ...iv.targets,
            iv.details,
            INTERVENTION_LABELS[iv.type]
          ])
        ]
          .join(' ')
          .toLowerCase()
          .includes(query)
      )
    return [...list].sort(compareDesigns)
  }, [snapshot?.designs, filter, evidence, search])
  if (!snapshot)
    return (
      <div className="page">
        <Empty title="Select a research project to explore strategies" />
      </div>
    )
  const compared = snapshot.designs.filter((d) => compareIds.includes(d.id))
  return (
    <div className="page col gap-lg">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Design → decide</div>
          <h1>Design strategies</h1>
          <p className="muted">
            Compare the biological rationale and experimental evidence. Choose a manageable set to
            test.
          </p>
        </div>
      </div>
      <div className="strategy-toolbar">
        <input
          aria-label="Search designs, genes or mechanisms"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search genes, pathways, mechanisms…"
        />
        <select
          aria-label="Evidence filter"
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
        >
          <option value="all">All evidence levels</option>
          <option value="measured">With lab support or refutation</option>
          <option value="unmeasured">Predicted only</option>
        </select>
      </div>
      <div className="row wrap gap-sm">
        {(
          [
            ['active', 'Candidate strategies'],
            ['flagged', 'Lab shortlist'],
            ['all', 'All proposals'],
            ['rejected', 'Rejected in review']
          ] as [Filter, string][]
        ).map(([key, label]) => (
          <button
            aria-pressed={filter === key}
            className={`btn btn-sm ${filter === key ? 'btn-primary' : 'btn-ghost'}`}
            key={key}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
        <span className="spacer" />
        <span className="hint">{designs.length} designs</span>
      </div>
      <div className="hint">
        Ordered by lab evidence, then AI comparison rank. “Predicted only” means no decisive active
        lab result. Review status describes proposal review, not experimental validation.
      </div>
      {compared.length > 0 && (
        <div className="compare-bar" role="status">
          <b>{compared.length} of 3 selected</b>
          <span className="muted">Compare changes, predicted effects, risks and evidence.</span>
          <span className="spacer" />
          <button className="btn btn-sm btn-ghost" onClick={() => setCompareIds([])}>
            Clear
          </button>
          <button
            className="btn btn-sm btn-primary"
            disabled={compared.length < 2}
            onClick={() => setComparing(true)}
          >
            Compare selected →
          </button>
        </div>
      )}
      {!designs.length ? (
        <Empty
          title={snapshot.designs.length ? 'No strategies match these filters' : 'No proposals yet'}
          hint={
            snapshot.designs.length
              ? 'Try another gene, clear the search or view all proposals.'
              : 'Start research from the top bar, or contribute a design in Scientist input.'
          }
          action={
            snapshot.designs.length ? (
              <button
                className="btn"
                onClick={() => {
                  setSearch('')
                  setFilter('all')
                  setEvidence('all')
                }}
              >
                Reset filters
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="card table-scroll" style={{ padding: 0 }}>
          <table className="table strategy-table">
            <thead>
              <tr>
                <th>Compare</th>
                <th>Strategy & proposed changes</th>
                <th>Expected effect</th>
                <th>Lab evidence</th>
                <th>Next action</th>
              </tr>
            </thead>
            <tbody>
              {designs.map((d) => {
                const resultCount = snapshot.results.filter(
                  (r) => r.designId === d.id && r.status === 'recorded'
                ).length
                return (
                  <tr key={d.id} className={selectedDesignId === d.id ? 'selected' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Compare ${d.title}`}
                        checked={compareIds.includes(d.id)}
                        disabled={!compareIds.includes(d.id) && compared.length >= 3}
                        onChange={(e) =>
                          setCompareIds((ids) =>
                            e.target.checked ? [...ids, d.id] : ids.filter((id) => id !== d.id)
                          )
                        }
                      />
                    </td>
                    <td>
                      <button className="text-button design-title" onClick={() => openDesign(d.id)}>
                        {d.title}
                      </button>
                      <div className="strategy-summary">{d.summary}</div>
                      <div className="row wrap gap-sm">
                        {d.interventions.map((iv, i) => (
                          <span className="intervention-tag" key={i}>
                            {INTERVENTION_LABELS[iv.type]}
                            {iv.targets.length ? ` · ${iv.targets.join(', ')}` : ''}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <div className="prediction-text">{predictionLabel(d)}</div>
                      <small className="muted">
                        {d.interventions.length} changes · {d.chassis || 'Host not specified'}
                      </small>
                    </td>
                    <td>
                      <EvidenceBadge grade={d.evidence} showPredicted />
                      <div className="hint">
                        {resultCount} active result{resultCount === 1 ? '' : 's'} ·{' '}
                        {d.citations.length} supplied references
                      </div>
                      {hasConflictingResults(
                        snapshot.results.filter((r) => r.designId === d.id)
                      ) && <span className="badge warn">Conflicting results</span>}
                    </td>
                    <td>
                      <div className="col gap-sm">
                        <DesignStatusBadge status={d.status} />
                        <ShortlistButton design={d} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {comparing && <CompareDrawer designs={compared} onClose={() => setComparing(false)} />}
    </div>
  )
}

function CompareDrawer({
  designs,
  onClose
}: {
  designs: StrainDesign[]
  onClose: () => void
}): JSX.Element {
  const { snapshot } = useStore()
  if (!snapshot) return <></>
  const rows: { label: string; render: (d: StrainDesign) => React.ReactNode }[] = [
    {
      label: 'Proposed changes',
      render: (d) => (
        <div className="col gap-sm">
          {d.interventions.map((iv, i) => (
            <div key={i}>
              <b>{iv.targets.join(', ') || 'Target unspecified'}</b>
              <div>
                {INTERVENTION_LABELS[iv.type]} · {iv.details}
              </div>
            </div>
          ))}
        </div>
      )
    },
    { label: 'Mechanism', render: (d) => d.mechanism || 'Not specified' },
    {
      label: 'Expected effect',
      render: (d) => (
        <>
          {predictionLabel(d)}
          <p>{d.predictedEffect}</p>
          <small>Reference: {d.quantPrediction?.baselineNote || 'Not specified'}</small>
        </>
      )
    },
    {
      label: 'Lab evidence',
      render: (d) => (
        <>
          <EvidenceBadge grade={d.evidence} showPredicted />
          <p>
            {snapshot.results.filter((r) => r.designId === d.id && r.status === 'recorded').length}{' '}
            active result records
          </p>
        </>
      )
    },
    { label: 'Risks stated in proposal', render: (d) => d.risks.join('; ') || 'Not specified' },
    {
      label: 'Evidence gaps',
      render: (d) =>
        designGaps(
          d,
          snapshot.results.filter((r) => r.designId === d.id)
        ).join('; ') || 'Review the evidence and assay context with your team.'
    },
    {
      label: 'First proposed test',
      render: (d) =>
        d.experimentalPlan.find((s) => s.phase === 'test')?.description || 'Not specified'
    },
    { label: 'Decision', render: (d) => <ShortlistButton design={d} /> }
  ]
  return (
    <Drawer
      wide
      title="Compare design strategies"
      subtitle="Compare like-for-like conditions and check the evidence before choosing candidates."
      onClose={onClose}
    >
      <div className="drawer-body">
        <ExportButton
          name={exportName(snapshot.campaign, 'strategy-comparison.md')}
          contents={() => experimentBrief(snapshot, designs)}
          label="Export comparison brief"
        />
        <div className="table-scroll">
          <table className="table comparison-table">
            <thead>
              <tr>
                <th>Decision factor</th>
                {designs.map((d) => (
                  <th key={d.id}>{d.title}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <th>{row.label}</th>
                  {designs.map((d) => (
                    <td key={d.id}>
                      {row.render(snapshot.designs.find((item) => item.id === d.id) ?? d)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Drawer>
  )
}

export function DesignDrawer({
  design,
  onClose
}: {
  design: StrainDesign
  onClose: () => void
}): JSX.Element {
  const { snapshot, refreshSnapshot } = useStore()
  const [tab, setTab] = useState<'proposal' | 'evidence' | 'experiment'>('proposal')
  if (!snapshot) return <></>
  const reviews = snapshot.reviews.filter((r) => r.designId === design.id)
  const results = snapshot.results.filter((r) => r.designId === design.id)
  const gaps = designGaps(design, results)
  return (
    <Drawer
      title={design.title}
      subtitle={
        <div className="row wrap gap-sm">
          <EvidenceBadge grade={design.evidence} showPredicted />
          <DesignStatusBadge status={design.status} />
          <OriginBadge origin={design.origin} />
        </div>
      }
      onClose={onClose}
    >
      <div className="detail-tabs" role="tablist" aria-label="Design details">
        {(
          [
            ['proposal', 'Strategy & mechanism'],
            ['evidence', `Evidence & reviews (${reviews.length})`],
            ['experiment', 'Plan & record results']
          ] as const
        ).map(([key, label]) => (
          <button
            id={`tab-${key}`}
            role="tab"
            aria-controls="design-panel"
            aria-selected={tab === key}
            key={key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div id="design-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="drawer-body">
        {tab === 'proposal' && (
          <>
            <div className="detail-block">
              <h3>The strategy</h3>
              <p className="prose">{design.summary}</p>
              <p className="hint">Host: {design.chassis || 'Not specified'}</p>
            </div>
            <div className="detail-block">
              <h3>What changes in the strain</h3>
              <div className="col gap-sm">
                {design.interventions.map((iv, i) => (
                  <div className="lineage-node" key={i}>
                    <div className="row wrap gap-sm">
                      <span className="badge accent">{INTERVENTION_LABELS[iv.type]}</span>
                      <b className="mono">{iv.targets.join(', ')}</b>
                    </div>
                    <p className="prose">{iv.details}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="detail-block">
              <h3>Why it may work</h3>
              <p className="prose">{design.mechanism || 'No mechanistic rationale supplied.'}</p>
            </div>
            <div className="prediction-callout">
              <span className="eyebrow">Model prediction · requires testing</span>
              <h3>{predictionLabel(design)}</h3>
              <p className="prose">{design.predictedEffect || 'No effect described.'}</p>
              <p className="hint">
                Compared with:{' '}
                {design.quantPrediction?.baselineNote ||
                  'Unspecified reference — clarify before comparing results.'}
              </p>
            </div>
            <div className="detail-block">
              <h3>Tradeoffs & failure modes</h3>
              {design.risks.length ? (
                <ul className="list-tight prose">
                  {design.risks.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              ) : (
                <p className="hint">
                  No risks documented in this proposal. This is a gap to review.
                </p>
              )}
            </div>
            {gaps.length > 0 && (
              <div className="evidence-gaps">
                <h3>Check before choosing this design</h3>
                <ul className="list-tight">
                  {gaps.map((gap) => (
                    <li key={gap}>{gap}</li>
                  ))}
                </ul>
              </div>
            )}
            <details className="advanced">
              <summary>AI comparison metrics & design lineage</summary>
              <p>
                AI comparison score (Elo): {design.elo} · {design.wins} wins / {design.losses}{' '}
                losses · Novelty assessment: {design.novelty}/10. These are model assessments, not
                measured performance.
              </p>
              {design.lineage.strategy && (
                <p>Refinement: {EVOLUTION_STRATEGY_LABELS[design.lineage.strategy]}</p>
              )}
              {design.lineage.parentIds.map((id) => (
                <p key={id}>Parent: {snapshot.designs.find((d) => d.id === id)?.title || id}</p>
              ))}
            </details>
          </>
        )}
        {tab === 'evidence' && (
          <>
            <div className="detail-block">
              <h3>Experimental evidence</h3>
              {hasConflictingResults(results) && (
                <p className="evidence-gaps">
                  Recorded results disagree. Compare batch conditions and replicates before
                  interpreting the aggregate evidence label.
                </p>
              )}
              <ResultsList results={results} onChanged={refreshSnapshot} />
            </div>
            <div className="detail-block">
              <h3>References supplied with the proposal ({design.citations.length})</h3>
              <p className="hint">
                A listed reference is a source to inspect. Check the organism, experimental
                conditions and relevance to this intervention.
              </p>
              {design.citations.length ? (
                design.citations.map((c, i) => (
                  <div className="reference-item" key={i}>
                    {c.url ? (
                      <a href={c.url} target="_blank" rel="noreferrer">
                        {c.title} ↗
                      </a>
                    ) : (
                      <b>{c.title}</b>
                    )}
                    {c.note && <p className="prose">{c.note}</p>}
                  </div>
                ))
              ) : (
                <p className="muted">No references supplied.</p>
              )}
            </div>
            <div className="detail-block">
              <h3>Reviews ({reviews.length})</h3>
              <div className="col gap-md">
                {reviews.map((r) => (
                  <div className="lineage-node" key={r.id}>
                    <div className="row wrap gap-sm">
                      <span className="badge">{REVIEW_TYPE_LABELS[r.type]}</span>
                      <VerdictBadge verdict={r.verdict} />
                      <span className="muted">{r.author}</span>
                    </div>
                    <p className="prose">{r.narrative}</p>
                    {r.evidence.length > 0 && (
                      <ul className="list-tight prose">
                        {r.evidence.map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                      </ul>
                    )}
                    <details>
                      <summary>Review scores</summary>
                      {(Object.entries(r.scores) as [CriterionKey, number][]).map(
                        ([key, value]) => (
                          <p key={key}>
                            {CRITERION_LABELS[key]}: {value}/10
                          </p>
                        )
                      )}
                    </details>
                  </div>
                ))}
                {!reviews.length && <p className="muted">No reviews recorded yet.</p>}
              </div>
            </div>
          </>
        )}
        {tab === 'experiment' && (
          <>
            <div className="detail-block">
              <h3>Proposed Design–Build–Test–Learn plan</h3>
              <p className="hint">
                Use this as a planning brief. Confirm controls, reference conditions and your lab's
                construction and assay procedures.
              </p>
              <div className="col gap-sm">
                {design.experimentalPlan.map((s, i) => (
                  <div className="lineage-node" key={i}>
                    <span className="badge blue">{s.phase}</span>
                    <p className="prose">{s.description}</p>
                  </div>
                ))}
                {!design.experimentalPlan.length && <p>No experiment plan supplied.</p>}
              </div>
            </div>
            {design.constructSuggestions.length > 0 && (
              <details className="advanced">
                <summary>
                  Construct & sequence suggestions ({design.constructSuggestions.length})
                </summary>
                {design.constructSuggestions.map((c, i) => (
                  <div className="lineage-node" key={i}>
                    <b>{c.label}</b>
                    <span className="badge">
                      {c.source === 'model' ? 'Model suggestion' : 'CodeXomics output'}
                    </span>
                    <p>{c.detail}</p>
                    {c.sequence && <code style={{ overflowWrap: 'anywhere' }}>{c.sequence}</code>}
                  </div>
                ))}
              </details>
            )}
            <div className="detail-block">
              <h3>Record a measured outcome</h3>
              <RecordResultForm
                key={design.id}
                campaignId={design.campaignId}
                designId={design.id}
                onDone={refreshSnapshot}
              />
            </div>
            <div className="detail-block">
              <h3>Result history</h3>
              <ResultsList results={results} onChanged={refreshSnapshot} />
            </div>
          </>
        )}
      </div>
      <div className="drawer-footer">
        <ShortlistButton design={design} />
        <span className="spacer" />
        <ExportButton
          name={exportName(snapshot.campaign, `${design.id}-brief.md`)}
          contents={() => experimentBrief(snapshot, [design])}
          label="Export design brief"
        />
      </div>
    </Drawer>
  )
}
