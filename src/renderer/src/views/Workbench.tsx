import { useState } from 'react'
import { LabReferenceEditor } from '../components/LabReferenceEditor'
import { useStore } from '../store/useStore'
import { compareDesigns } from '@shared/domain'
import { effectiveHost, engineeringScope, engineeringScopeId, formatHost, hostKey, inEngineeringScope,
  PATHWAY_EVIDENCE_LABELS } from '@shared/engineering'
import {
  designGaps,
  experimentBrief,
  exportName,
  labContextLines,
  predictionLabel
} from '@shared/workbench'
import { Empty, EvidenceBadge, CampaignStatusPill } from '../components/ui'
import { ExportButton } from '../components/ExportButton'

export function Workbench(): JSX.Element {
  const { snapshot, settings, setView, openDesign } = useStore()
  const [editingReference, setEditingReference] = useState(false)
  if (!snapshot)
    return (
      <div className="page workbench col gap-lg">
        <div className="welcome">
          <div className="eyebrow">Your strain engineering workspace</div>
          <h1>
            From a production bottleneck
            <br />
            to your next experiment.
          </h1>
          <p>
            Choose a host and pathway, identify what limits production, and test the resulting
            hypotheses against your experimental reference.
          </p>
          <button className="btn btn-primary" onClick={() => setView('campaigns')}>
            Define a research project →
          </button>
        </div>
        <div className="workflow-grid">
          {[
            ['Choose a host', 'Compare chassis fit, strain background and available tools.'],
            ['Compare pathways', 'Weigh validation time, yield, reaction count and novelty.'],
            ['Analyze targets', 'Identify bottlenecks and choose measurements that test each hypothesis.'],
            ['Learn from results', 'Use measured outcomes and controls to refine the next round.']
          ].map(([title, description]) => (
            <div className="card" key={title}>
              <h3>{title}</h3>
              <p className="muted">{description}</p>
            </div>
          ))}
        </div>
      </div>
    )
  const { campaign } = snapshot
  const host = effectiveHost(campaign)
  const pathway = engineeringScope(campaign)?.pathway
  const currentDesigns = snapshot.designs.filter((design) => inEngineeringScope(campaign, design))
  const currentIds = new Set(currentDesigns.map((design) => design.id))
  const results = snapshot.results.filter((result) => currentIds.has(result.designId))
  const candidates = currentDesigns
    .filter((d) => d.status === 'active' || d.status === 'flagged')
    .sort(compareDesigns)
  const shortlist = candidates.filter((d) => d.status === 'flagged')
  const awaiting = shortlist.filter(
    (d) => !results.some((r) => r.designId === d.id && r.status === 'recorded' && !r.targetId)
  )
  const recorded = results.filter((r) => r.status === 'recorded')
  const tested = new Set(recorded.map((r) => r.designId)).size
  const supported = candidates.filter(
    (d) => d.evidence === 'measured-confirmed' || d.evidence === 'measured-partial'
  ).length
  const targetFeedback = recorded.filter((r) => r.targetId).length
  const latest = snapshot.metaReviews.filter((meta) => meta.engineeringScopeId === engineeringScopeId(campaign)).at(-1)
  const lab = campaign.labContext
  const next = host.preset === 'agnostic' && !candidates.length
    ? { title: 'Choose a host for this goal', text: 'Compare candidate chassis or specify the organism and strain you already use.', action: 'Review hosts', view: 'hosts' as const }
    : !pathway && !candidates.length && campaign.status !== 'running'
      ? { title: 'Compare pathways in your host', text: 'Select a route to focus the target analysis on its likely production bottlenecks.', action: 'Review pathways', view: 'pathways' as const }
      : awaiting.length
        ? { title: `${awaiting.length} shortlisted design${awaiting.length === 1 ? '' : 's'} awaiting whole-design results`, text: 'Record the control, batch conditions and any target-specific observations.', action: 'Open experiments', view: 'experiments' as const }
        : recorded.length
          ? { title: 'Use measured results to refine the targets', text: 'Review support, refutation and unresolved observations, then resume or restart research.', action: 'Review feedback', view: 'experiments' as const }
          : candidates.length
            ? { title: 'Choose target hypotheses to test', text: 'Compare the expected effect, readout and main uncertainty for each proposal.', action: 'Compare targets', view: 'designs' as const }
            : { title: campaign.status === 'running' ? 'Target analysis is in progress' : 'Your engineering plan is ready', text: 'Review the experimental reference and use the top bar to run target analysis.', action: 'Review the plan', view: 'pathways' as const }
  return (
    <div className="page workbench col gap-lg">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            Research workbench · {formatHost(host)}
          </div>
          <h1>{campaign.title}</h1>
          <p className="muted">
            {campaign.productTarget}
            {pathway && ` · ${pathway.title} · ${PATHWAY_EVIDENCE_LABELS[pathway.evidence]}`}
          </p>
        </div>
        <CampaignStatusPill status={campaign.status} />
      </div>
      <div className="workflow-strip">
        {([
          { label: 'Host selection', value: host.preset === 'agnostic' ? 'Choose a chassis' : formatHost(host), view: 'hosts' },
          { label: 'Metabolic pathways', value: pathway?.title ?? 'Compare candidate routes', view: 'pathways' },
          { label: 'Metabolic targets', value: `${candidates.length} designs · ${shortlist.length} shortlisted`, view: 'designs' },
          { label: 'Target feedback', value: `${tested} design${tested === 1 ? '' : 's'} with results · ${targetFeedback} target record${targetFeedback === 1 ? '' : 's'}`, view: 'experiments' }
        ] as const).map((step) => (
          <button key={step.view} className="workflow-step" onClick={() => setView(step.view)}>
            <div><b>{step.label}</b><small>{step.value}</small></div>
          </button>
        ))}
      </div>
      <div className="next-action">
        <div>
          <div className="eyebrow">Suggested next step</div>
          <h2>{next.title}</h2>
          <p>{next.text}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setView(next.view)}>
          {next.action} →
        </button>
      </div>
      <div className="workbench-columns">
        <div className="col gap-lg">
          <section className="card pad-lg">
            <div className="card-head">
              <h2 className="card-title">Candidate target designs</h2>
              <button className="btn btn-sm btn-ghost" onClick={() => setView('designs')}>
                View all →
              </button>
            </div>
            <p className="hint">
              Lab evidence first, then AI comparison rank. Rank is a prioritization aid; it does not
              estimate success probability.
            </p>
            {candidates.length ? (
              <div className="col gap-md">
                {candidates.slice(0, 3).map((d) => (
                  <button className="candidate-card" key={d.id} onClick={() => openDesign(d.id)}>
                    <div className="row gap-sm">
                      <b>{d.title}</b>
                    </div>
                    <p>{d.summary}</p>
                    <div className="row wrap gap-sm">
                      <EvidenceBadge grade={d.evidence} showPredicted />
                      {!!d.metabolicTargets?.length && <span className="badge">{d.metabolicTargets.length} target hypotheses</span>}
                      <span className="badge">{d.interventions.length} proposed changes</span>
                      {d.status === 'flagged' && <span className="badge warn">Shortlisted</span>}
                    </div>
                    <div className="prediction-text">{predictionLabel(d)}</div>
                    {designGaps(
                      d,
                      results.filter((r) => r.designId === d.id)
                    ).length > 0 && (
                      <small className="muted">
                        Check:{' '}
                        {
                          designGaps(
                            d,
                            results.filter((r) => r.designId === d.id)
                          )[0]
                        }
                      </small>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <Empty
                title="No candidate strategies yet"
                hint="Start research to generate proposals, or contribute a strategy from Scientist input."
              />
            )}
          </section>
          {latest && (
            <section className="card pad-lg">
              <div className="eyebrow">Latest research synthesis</div>
              <h2 className="card-title">What to explore next</h2>
              <p className="prose">{latest.overview.summary}</p>
              <button className="btn btn-sm" onClick={() => setView('overview')}>
                Read the engineering roadmap →
              </button>
            </section>
          )}
        </div>
        <div className="col gap-lg">
          <section className="card pad-lg">
            <div className="eyebrow">Success criteria</div>
            <div className="card-head">
              <h2 className="card-title">Your experimental reference</h2>
              <button className="btn btn-sm btn-ghost" onClick={() => setEditingReference(true)}>
                Edit
              </button>
            </div>
            <p className="prose">{campaign.goal}</p>
            {lab && hostKey(host) !== hostKey(campaign.host) && (
              <p className="hint">The selected host differs from the project brief. Check the reference strain and conditions before running target analysis.</p>
            )}
            {lab ? (
              <dl className="brief-facts">
                {labContextLines(lab).map((line) => {
                  const i = line.indexOf(':')
                  return (
                    <div key={line}>
                      <dt>{line.slice(0, i)}</dt>
                      <dd>{line.slice(i + 1)}</dd>
                    </div>
                  )
                })}
              </dl>
            ) : (
              <p className="hint">
                No structured reference conditions were supplied. Choose Edit to add baseline values
                and process conditions.
              </p>
            )}
          </section>
          <section className="card pad-lg">
            <h2 className="card-title">Evidence from your lab</h2>
            <div className="evidence-total">
              {supported}
              <span> supported candidates</span>
            </div>
            <p className="muted">
              {recorded.length} active result records across {tested} designs, including {targetFeedback} target-specific records. Review controls,
              replicates and conditions before drawing conclusions.
            </p>
            <button className="btn btn-sm" onClick={() => setView('experiments')}>
              Record or review results →
            </button>
          </section>
          <section className="card pad-lg">
            <h2 className="card-title">Take the shortlist to your lab</h2>
            <p className="muted">
              Export proposed changes, DBTL plans, references, reviews and results for your team.
            </p>
            <ExportButton
              disabled={!shortlist.length}
              name={exportName(campaign, 'experiment-brief.md')}
              contents={() => experimentBrief(snapshot, shortlist)}
              label={`Export experiment brief (${shortlist.length})`}
            />
          </section>
          <button className="btn btn-ghost" onClick={() => setView('settings')}>
            Research services{' '}
            {settings?.mcp.deepResearch.enabled
              ? '· literature enabled'
              : '· configure evidence sources'}{' '}
            →
          </button>
        </div>
      </div>
      {editingReference && (
        <LabReferenceEditor campaign={campaign} onClose={() => setEditingReference(false)} />
      )}
    </div>
  )
}
