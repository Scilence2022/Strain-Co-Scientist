import { useState } from 'react'
import { LabReferenceEditor } from '../components/LabReferenceEditor'
import { useStore } from '../store/useStore'
import { compareDesigns } from '@shared/domain'
import { hostDisplayName } from '@shared/hosts'
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
            Describe your strain, process and success criteria. Compare proposed changes, choose
            candidates, and bring experimental results into the next design round.
          </p>
          <button className="btn btn-primary" onClick={() => setView('campaigns')}>
            Define a research project →
          </button>
        </div>
        <div className="workflow-grid">
          {[
            [
              '01',
              'Define the problem',
              'Product, strain background, baseline and process conditions.'
            ],
            ['02', 'Choose a strategy', 'Compare mechanisms, expected effects and evidence gaps.'],
            [
              '03',
              'Test & learn',
              'Keep batch context and feed measured outcomes into new designs.'
            ]
          ].map(([n, title, text]) => (
            <div className="card" key={n}>
              <span className="step-number">{n}</span>
              <h3>{title}</h3>
              <p className="muted">{text}</p>
            </div>
          ))}
        </div>
      </div>
    )
  const { campaign, results } = snapshot
  const candidates = snapshot.designs
    .filter((d) => d.status === 'active' || d.status === 'flagged')
    .sort(compareDesigns)
  const shortlist = candidates.filter((d) => d.status === 'flagged')
  const awaiting = shortlist.filter(
    (d) => !results.some((r) => r.designId === d.id && r.status === 'recorded')
  )
  const recorded = results.filter((r) => r.status === 'recorded')
  const tested = new Set(recorded.map((r) => r.designId)).size
  const supported = candidates.filter(
    (d) => d.evidence === 'measured-confirmed' || d.evidence === 'measured-partial'
  ).length
  const latest = snapshot.metaReviews.at(-1)
  const lab = campaign.labContext
  const next = awaiting.length
    ? {
        title: `${awaiting.length} shortlisted candidate${awaiting.length === 1 ? '' : 's'} awaiting results`,
        text: 'Review the proposed test plan, run your controls and record the measured outcome with its batch conditions.',
        action: 'Open experiments',
        view: 'experiments' as const
      }
    : shortlist.length
      ? {
          title: 'Turn your latest observations into the next design',
          text: 'Review recorded outcomes and refine the goal with what you learned. Resume or re-open research when ready.',
          action: 'Review results',
          view: 'experiments' as const
        }
      : candidates.length
        ? {
            title: 'Choose a small set of candidates to test',
            text: 'Compare the mechanism, number of changes and evidence gaps. Shortlist the designs that fit your lab.',
            action: 'Compare strategies',
            view: 'designs' as const
          }
        : {
            title:
              campaign.status === 'running'
                ? 'Research is in progress'
                : 'Your research brief is ready',
            text:
              campaign.status === 'running'
                ? 'Proposals appear as they are generated and reviewed. You can refine the brief while research continues.'
                : 'Check the brief below, configure a research provider if needed, then start research from the top bar.',
            action: 'Refine the brief',
            view: 'expert' as const
          }
  return (
    <div className="page workbench col gap-lg">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            Research workbench · {hostDisplayName(campaign.host.preset, campaign.host.customName)}
          </div>
          <h1>{campaign.title}</h1>
          <p className="muted">
            {campaign.host.strainBackground || 'Strain background not specified'} ·{' '}
            {campaign.productTarget}
          </p>
        </div>
        <CampaignStatusPill status={campaign.status} />
      </div>
      <div className="workflow-strip">
        {[
          {
            n: '01',
            label: 'Research brief',
            value: 'Goal & conditions',
            view: 'campaigns' as const
          },
          {
            n: '02',
            label: 'Design strategies',
            value: `${candidates.length} candidate strategies`,
            view: 'designs' as const
          },
          {
            n: '03',
            label: 'Build & test',
            value: `${shortlist.length} shortlisted · ${awaiting.length} awaiting data`,
            view: 'experiments' as const
          },
          {
            n: '04',
            label: 'Learn & refine',
            value: `${tested} designs tested`,
            view: 'overview' as const
          }
        ].map((step) => (
          <button key={step.n} className="workflow-step" onClick={() => setView(step.view)}>
            <span>{step.n}</span>
            <div>
              <b>{step.label}</b>
              <small>{step.value}</small>
            </div>
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
              <h2 className="card-title">Candidates to discuss at the bench</h2>
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
                {candidates.slice(0, 3).map((d, i) => (
                  <button className="candidate-card" key={d.id} onClick={() => openDesign(d.id)}>
                    <div className="row gap-sm">
                      <span className="candidate-index">0{i + 1}</span>
                      <b>{d.title}</b>
                    </div>
                    <p>{d.summary}</p>
                    <div className="row wrap gap-sm">
                      <EvidenceBadge grade={d.evidence} showPredicted />
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
              {recorded.length} active result records across {tested} designs. Review controls,
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
