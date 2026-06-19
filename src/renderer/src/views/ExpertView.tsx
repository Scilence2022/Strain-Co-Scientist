import { useState } from 'react'
import { useStore } from '../store/useStore'
import { DesignStatusBadge, Empty, EvidenceBadge } from '../components/ui'
import { RecordResultForm } from '../components/Results'
import { IconExpert, IconPlus, IconClose, IconFlag } from '../components/Icons'
import {
  compareDesigns,
  CRITERION_LABELS,
  INTERVENTION_LABELS,
  type CriterionKey,
  type Intervention,
  type InterventionType
} from '@shared/domain'

export function ExpertView(): JSX.Element {
  const { snapshot, refreshSnapshot } = useStore()
  if (!snapshot) return <div className="page"><Empty icon={<IconExpert size={36} />} title="No campaign selected" /></div>
  const campaign = snapshot.campaign
  const active = snapshot.designs.filter((d) => d.status !== 'rejected')
  const flagged = snapshot.designs.filter((d) => d.status === 'flagged')
  const terminal =
    campaign.status === 'completed' || campaign.status === 'stopped' || campaign.status === 'error'

  return (
    <div className="page page-narrow col gap-lg">
      <div>
        <h2 style={{ fontSize: 'var(--fs-xl)', marginBottom: 6 }}>Expert-in-the-loop</h2>
        <div className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
          Steer the system: refine the goal, contribute your own design, review designs, and flag candidates for the wet lab.
        </div>
      </div>

      <RefineGoal campaignId={campaign.id} current={campaign.goal} onDone={refreshSnapshot} />
      <ContributeDesign campaignId={campaign.id} chassisDefault={snapshot.designs[0]?.chassis ?? ''} onDone={refreshSnapshot} />
      <ProvideReview onDone={refreshSnapshot} />
      <RecordResult campaignId={campaign.id} onDone={refreshSnapshot} terminal={terminal} />

      <div className="card">
        <div className="card-head">
          <div className="card-title">Flagged for wet-lab ({flagged.length})</div>
        </div>
        {flagged.length === 0 ? (
          <span className="faint">No designs flagged. Flag promising candidates from the Designs view or here.</span>
        ) : (
          <div className="col gap-sm">
            {flagged.map((d) => (
              <div key={d.id} className="lineage-node row">
                <span style={{ fontWeight: 600 }}>{d.title}</span>
                <EvidenceBadge grade={d.evidence} />
                <span className="badge accent" style={{ marginLeft: 8 }}>Elo {d.elo}</span>
                <span className="spacer" />
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={async () => {
                    await window.api.flagDesign(d.id, false)
                    refreshSnapshot()
                  }}
                >
                  <IconFlag size={13} /> Unflag
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="section-title">Quick-flag a design</div>
        {active.length === 0 ? (
          <span className="faint">No designs yet.</span>
        ) : (
          <div className="col gap-sm" style={{ maxHeight: 240, overflowY: 'auto' }}>
            {[...active].sort((a, b) => b.elo - a.elo).slice(0, 12).map((d) => (
              <div key={d.id} className="row gap-sm">
                <span style={{ flex: 1 }}>{d.title}</span>
                <DesignStatusBadge status={d.status} />
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={async () => {
                    await window.api.flagDesign(d.id, d.status !== 'flagged')
                    refreshSnapshot()
                  }}
                >
                  {d.status === 'flagged' ? 'Unflag' : 'Flag'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function RefineGoal({ campaignId, current, onDone }: { campaignId: string; current: string; onDone: () => void }): JSX.Element {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="card">
      <div className="section-title">Refine the research goal</div>
      <p className="faint" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>
        Add guidance in light of the current results. The Supervisor re-parses the plan on the next run.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="e.g. Prioritise designs that avoid antibiotic markers and focus on the oxidative PPP for NADPH supply."
      />
      <div className="row" style={{ marginTop: 10 }}>
        <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{current.length} chars in current goal</span>
        <span className="spacer" />
        <button
          className="btn btn-primary btn-sm"
          disabled={!text.trim() || busy}
          onClick={async () => {
            setBusy(true)
            await window.api.refineGoal(campaignId, text.trim())
            setText('')
            setBusy(false)
            onDone()
          }}
        >
          Add refinement
        </button>
      </div>
    </div>
  )
}

function RecordResult({
  campaignId,
  onDone,
  terminal
}: {
  campaignId: string
  onDone: () => void
  terminal: boolean
}): JSX.Element {
  const { snapshot } = useStore()
  const active = snapshot?.designs.filter((d) => d.status !== 'rejected') ?? []
  // Flagged designs (queued for the wet lab) float to the top of the picker.
  const ordered = [...active].sort((a, b) => {
    const fa = a.status === 'flagged' ? 0 : 1
    const fb = b.status === 'flagged' ? 0 : 1
    return fa - fb || compareDesigns(a, b)
  })
  const [designId, setDesignId] = useState('')
  const [busy, setBusy] = useState(false)
  const selected = ordered.find((d) => d.id === designId) ?? null

  return (
    <div className="card">
      <div className="section-title">Record an experimental result</div>
      <p className="faint" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>
        Feed wet-lab outcomes back in. Measured results outrank purely-predicted designs and recalibrate the agents.
      </p>
      {terminal && (
        <div className="row gap-sm" style={{ marginBottom: 10 }}>
          <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
            This campaign has ended — re-open it to let the agents act on new data.
          </span>
          <span className="spacer" />
          <button
            className="btn btn-sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await window.api.reopenCampaign(campaignId)
              setBusy(false)
              onDone()
            }}
          >
            Re-open campaign
          </button>
        </div>
      )}
      <div className="field">
        <label>Design</label>
        <select value={designId} onChange={(e) => setDesignId(e.target.value)}>
          <option value="">Select a design…</option>
          {ordered.map((d) => (
            <option key={d.id} value={d.id}>
              {d.status === 'flagged' ? '★ ' : ''}
              {d.title}
            </option>
          ))}
        </select>
      </div>
      {selected ? (
        <RecordResultForm campaignId={campaignId} designId={selected.id} onDone={onDone} />
      ) : (
        <span className="faint">Pick a design to record a result against.</span>
      )}
    </div>
  )
}

const IV_TYPES = Object.keys(INTERVENTION_LABELS) as InterventionType[]

function ContributeDesign({
  campaignId,
  chassisDefault,
  onDone
}: {
  campaignId: string
  chassisDefault: string
  onDone: () => void
}): JSX.Element {
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [chassis, setChassis] = useState(chassisDefault)
  const [mechanism, setMechanism] = useState('')
  const [predictedEffect, setPredictedEffect] = useState('')
  const [interventions, setInterventions] = useState<Intervention[]>([
    { type: 'knockout', targets: [], details: '' }
  ])
  const [busy, setBusy] = useState(false)

  const valid = title.trim() && summary.trim()

  const submit = async () => {
    setBusy(true)
    await window.api.submitExpertDesign({
      campaignId,
      title: title.trim(),
      summary: summary.trim(),
      chassis: chassis.trim(),
      mechanism: mechanism.trim(),
      predictedEffect: predictedEffect.trim(),
      interventions: interventions
        .filter((iv) => iv.details.trim() || iv.targets.length)
        .map((iv) => ({ ...iv, targets: iv.targets }))
    })
    setTitle('')
    setSummary('')
    setMechanism('')
    setPredictedEffect('')
    setInterventions([{ type: 'knockout', targets: [], details: '' }])
    setBusy(false)
    onDone()
  }

  return (
    <div className="card">
      <div className="section-title">Contribute your own design</div>
      <p className="faint" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>
        Your design enters the tournament alongside the system's and can be combined by the Evolution agent.
      </p>
      <div className="field">
        <label>Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label>Summary</label>
        <textarea rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </div>
      <div className="grid grid-2">
        <div className="field">
          <label>Chassis</label>
          <input value={chassis} onChange={(e) => setChassis(e.target.value)} />
        </div>
      </div>

      <label style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Interventions</label>
      <div className="col gap-sm" style={{ margin: '6px 0 12px' }}>
        {interventions.map((iv, i) => (
          <div key={i} className="row gap-sm">
            <select
              value={iv.type}
              style={{ width: 150 }}
              onChange={(e) => updateIv(setInterventions, i, { type: e.target.value as InterventionType })}
            >
              {IV_TYPES.map((t) => (
                <option key={t} value={t}>{INTERVENTION_LABELS[t]}</option>
              ))}
            </select>
            <input
              placeholder="targets (comma-sep)"
              value={iv.targets.join(', ')}
              onChange={(e) => updateIv(setInterventions, i, { targets: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })}
              style={{ width: 150 }}
            />
            <input
              placeholder="details"
              value={iv.details}
              onChange={(e) => updateIv(setInterventions, i, { details: e.target.value })}
            />
            {interventions.length > 1 && (
              <button className="btn btn-icon btn-ghost" onClick={() => setInterventions(interventions.filter((_, k) => k !== i))}>
                <IconClose size={14} />
              </button>
            )}
          </div>
        ))}
        <button
          className="btn btn-sm btn-ghost"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => setInterventions([...interventions, { type: 'overexpression', targets: [], details: '' }])}
        >
          <IconPlus size={13} /> Add intervention
        </button>
      </div>

      <div className="field">
        <label>Mechanism</label>
        <textarea rows={2} value={mechanism} onChange={(e) => setMechanism(e.target.value)} />
      </div>
      <div className="field">
        <label>Predicted effect</label>
        <textarea rows={2} value={predictedEffect} onChange={(e) => setPredictedEffect(e.target.value)} />
      </div>
      <div className="row">
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" disabled={!valid || busy} onClick={submit}>
          Add to tournament
        </button>
      </div>
    </div>
  )
}

function updateIv(
  setter: React.Dispatch<React.SetStateAction<Intervention[]>>,
  index: number,
  patch: Partial<Intervention>
): void {
  setter((prev) => prev.map((iv, i) => (i === index ? { ...iv, ...patch } : iv)))
}

function ProvideReview({ onDone }: { onDone: () => void }): JSX.Element {
  const { snapshot } = useStore()
  const active = snapshot?.designs.filter((d) => d.status !== 'rejected') ?? []
  const [designId, setDesignId] = useState('')
  const [verdict, setVerdict] = useState<'pass' | 'revise' | 'reject'>('pass')
  const [narrative, setNarrative] = useState('')
  const [scores, setScores] = useState<Partial<Record<CriterionKey, number>>>({})
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!designId || !narrative.trim()) return
    setBusy(true)
    await window.api.submitExpertReview({
      campaignId: snapshot!.campaign.id,
      designId,
      verdict,
      narrative: narrative.trim(),
      scores,
      author: 'Scientist'
    })
    setNarrative('')
    setScores({})
    setBusy(false)
    onDone()
  }

  return (
    <div className="card">
      <div className="section-title">Provide a review</div>
      <div className="grid grid-2">
        <div className="field">
          <label>Design</label>
          <select value={designId} onChange={(e) => setDesignId(e.target.value)}>
            <option value="">Select a design…</option>
            {[...active].sort((a, b) => b.elo - a.elo).map((d) => (
              <option key={d.id} value={d.id}>{d.title}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Verdict</label>
          <select value={verdict} onChange={(e) => setVerdict(e.target.value as any)}>
            <option value="pass">Pass</option>
            <option value="revise">Revise</option>
            <option value="reject">Reject</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label>Review</label>
        <textarea rows={3} value={narrative} onChange={(e) => setNarrative(e.target.value)} placeholder="Your assessment and rationale." />
      </div>
      <label style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Scores (optional)</label>
      <div className="row wrap gap-md" style={{ margin: '6px 0 12px' }}>
        {(Object.keys(CRITERION_LABELS) as CriterionKey[]).map((k) => (
          <div key={k} className="col" style={{ width: 110 }}>
            <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{CRITERION_LABELS[k]}</span>
            <input
              type="number"
              min={0}
              max={10}
              value={scores[k] ?? ''}
              placeholder="–"
              onChange={(e) =>
                setScores((s) => ({ ...s, [k]: e.target.value === '' ? undefined : Math.max(0, Math.min(10, +e.target.value)) }))
              }
            />
          </div>
        ))}
      </div>
      <div className="row">
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" disabled={!designId || !narrative.trim() || busy} onClick={submit}>
          Submit review
        </button>
      </div>
    </div>
  )
}
