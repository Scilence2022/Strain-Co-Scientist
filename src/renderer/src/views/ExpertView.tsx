import { useId, useState } from 'react'
import {
  COFACTORS, effectiveHost, engineeringScope, formatHost, METABOLIC_TARGET_CATEGORIES, METABOLIC_TARGET_LABELS,
  type MetabolicTargetDraft
} from '@shared/engineering'
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
  const scope = engineeringScope(campaign)
  const chassisDefault = formatHost(effectiveHost(campaign))
  const active = snapshot.designs.filter((d) => d.status === 'active' || d.status === 'flagged')
  const flagged = snapshot.designs.filter((d) => d.status === 'flagged')
  const terminal =
    campaign.status === 'completed' || campaign.status === 'stopped' || campaign.status === 'error'

  return (
    <div className="page page-narrow col gap-lg">
      <div>
        <h2 style={{ fontSize: 'var(--fs-xl)', marginBottom: 6 }}>Scientist input</h2>
        <div className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
          Steer the system: refine the goal, contribute your own design, review designs, and flag candidates for the wet lab.
        </div>
      </div>

      <RefineGoal campaignId={campaign.id} current={campaign.goal} onDone={refreshSnapshot} />
      <ContributeDesign key={scope?.id ?? 'project'} campaignId={campaign.id}
        chassisDefault={chassisDefault} fixedHost={!!scope} onDone={refreshSnapshot} />
      <ProvideReview onDone={refreshSnapshot} />
      <RecordResult campaignId={campaign.id} onDone={refreshSnapshot} terminal={terminal} />

      <div className="card">
        <div className="card-head">
          <div className="card-title">Lab shortlist ({flagged.length})</div>
        </div>
        {flagged.length === 0 ? (
          <span className="faint">No candidates shortlisted. Compare designs in Metabolic targets and choose candidates for your lab.</span>
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
                  <IconFlag size={13} /> Remove from shortlist
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="section-title">Add a candidate to your lab shortlist</div>
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
                  {d.status === 'flagged' ? 'Remove from shortlist' : 'Shortlist'}
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
  const active = snapshot?.designs.filter((d) => d.status === 'active' || d.status === 'flagged') ?? []
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
        <RecordResultForm key={selected.id} campaignId={campaignId} designId={selected.id} onDone={onDone} />
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
  fixedHost,
  onDone
}: {
  campaignId: string
  chassisDefault: string
  fixedHost: boolean
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
  const [error, setError] = useState('')
  const [target, setTarget] = useState<MetabolicTargetDraft>()
  const targetValid = !target || [target.name, target.hypothesis, target.readout, target.limitation].every((s) => s.trim())
  const valid = title.trim() && summary.trim() && targetValid

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      await window.api.submitExpertDesign({
        campaignId,
        title: title.trim(),
        summary: summary.trim(),
        chassis: chassis.trim(),
        mechanism: mechanism.trim(),
        predictedEffect: predictedEffect.trim(),
        interventions: interventions.filter((iv) => iv.details.trim() || iv.targets.length),
        metabolicTargets: target ? [target] : undefined
      })
      setTitle('')
      setSummary('')
      setMechanism('')
      setPredictedEffect('')
      setInterventions([{ type: 'knockout', targets: [], details: '' }])
      setTarget(undefined)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
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
          <input value={chassis} readOnly={fixedHost} onChange={(e) => setChassis(e.target.value)} />
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
      {target ? (
        <TargetEditor target={target} onChange={setTarget} onRemove={() => setTarget(undefined)} />
      ) : (
        <button className="btn btn-sm" onClick={() =>
          setTarget({ name: '', category: 'rate-limiting-step', hypothesis: '', readout: '', limitation: '' })
        }>Add target hypothesis</button>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="row">
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" disabled={!valid || busy} onClick={submit}>
          Save design
        </button>
      </div>
    </div>
  )
}

function TargetEditor({ target, onChange, onRemove }: {
  target: MetabolicTargetDraft; onChange: (target: MetabolicTargetDraft) => void; onRemove: () => void
}): JSX.Element {
  const id = useId()
  return (
    <fieldset className="card col gap-sm">
      <legend>Target hypothesis</legend>
      <div className="field">
        <label htmlFor={`${id}-category`}>Target category</label>
        <select id={`${id}-category`} value={target.category} onChange={(e) =>
          onChange({ ...target, category: e.target.value as MetabolicTargetDraft['category'] })
        }>
          {METABOLIC_TARGET_CATEGORIES.map((category) =>
            <option key={category} value={category}>{METABOLIC_TARGET_LABELS[category]}</option>
          )}
        </select>
      </div>
      {([
        ['name', 'Target name'],
        ['hypothesis', 'Expected causal effect'],
        ['readout', 'Measurement and control'],
        ['limitation', 'Principal uncertainty']
      ] as const).map(([field, label]) => (
        <div className="field" key={field}>
          <label htmlFor={`${id}-${field}`}>{label}</label>
          <input id={`${id}-${field}`} value={target[field]} onChange={(e) => onChange({ ...target, [field]: e.target.value })} />
        </div>
      ))}
      <div className="row wrap gap-sm" aria-label="Relevant cofactors">
        {COFACTORS.map((cofactor) => (
          <label className="checkbox-row" key={cofactor}>
            <input type="checkbox" checked={target.cofactors?.includes(cofactor) ?? false} onChange={(e) => {
              const current = target.cofactors ?? []
              onChange({ ...target, cofactors: e.target.checked ? [...current, cofactor] : current.filter((c) => c !== cofactor) })
            }} />
            {cofactor}
          </label>
        ))}
      </div>
      <div><button className="btn btn-sm btn-ghost" onClick={onRemove}>Remove hypothesis</button></div>
    </fieldset>
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
  const active = snapshot?.designs.filter((d) => d.status === 'active' || d.status === 'flagged') ?? []
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
