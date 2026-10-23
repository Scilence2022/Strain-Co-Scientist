import { useState } from 'react'
import { useStore } from '../store/useStore'
import { CampaignStatusPill, Empty, timeAgo } from '../components/ui'
import { IconPlus, IconTrash, IconCampaigns, IconPlay } from '../components/Icons'
import { HOST_PRESET_LIST, hostDisplayName } from '@shared/hosts'
import {
  DEFAULT_TOURNAMENT_CONFIG,
  type EngineeringObjective,
  type HostPresetId,
  type TournamentConfig,
  type LabContext
} from '@shared/domain'
import type { CreateCampaignInput } from '@shared/ipc'
import { TournamentConfigEditor } from '../components/TournamentConfigEditor'
import { Drawer } from '../components/Drawer'
import { METRIC_LABELS, METRIC_UNITS } from '@shared/workbench'
import { campaignInputSchema } from '@shared/validation'

const OBJECTIVES: { value: EngineeringObjective; label: string }[] = [
  { value: 'increase-titer', label: 'Increase titer' },
  { value: 'increase-rate', label: 'Increase production rate' },
  { value: 'increase-yield', label: 'Increase yield' },
  { value: 'broaden-substrate', label: 'Broaden substrate range' },
  { value: 'improve-tolerance', label: 'Improve tolerance/robustness' },
  { value: 'reduce-byproduct', label: 'Reduce byproduct' },
  { value: 'improve-stability', label: 'Improve stability' },
  { value: 'other', label: 'Other' }
]

export function Campaigns(): JSX.Element {
  const { campaigns, refreshCampaigns, selectCampaign, setView } = useStore()
  const [creating, setCreating] = useState(false)

  const onDelete = async (id: string, title: string) => {
    if (!confirm(`Delete campaign "${title}"? This removes all its designs and history.`)) return
    await window.api.deleteCampaign(id)
    await refreshCampaigns()
    await selectCampaign(useStore.getState().campaigns[0]?.id ?? null)
  }

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 'var(--fs-xl)' }}>Research projects</h2>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <IconPlus size={15} /> New project
        </button>
      </div>

      {campaigns.length === 0 ? (
        <Empty
          icon={<IconCampaigns size={36} />}
          title="Start with a production problem"
          hint="Define your product, strain background, current performance and what success would look like. You can save a brief before configuring research services."
        />
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Host</th>
                <th>Objective</th>
                <th>Reference → target</th>
                <th>Status</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr
                  key={c.id}
                  className="clickable"
                  onClick={async () => {
                    await selectCampaign(c.id)
                    setView('dashboard')
                  }}
                >
                  <td>
                    <div style={{ fontWeight: 600 }}>{c.title}</div>
                    <div className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                      {c.productTarget}
                    </div>
                  </td>
                  <td className="muted">{hostDisplayName(c.host.preset, c.host.customName)}</td>
                  <td className="muted">
                    {OBJECTIVES.find((o) => o.value === c.objective)?.label}
                  </td>
                  <td>
                    {c.labContext ? (
                      `${c.labContext.baselineValue ?? '?'} → ${c.labContext.targetValue ?? '?'} ${c.labContext.unit ?? ''}`
                    ) : (
                      <span className="faint">Not specified</span>
                    )}
                  </td>
                  <td>
                    <CampaignStatusPill status={c.status} />
                  </td>
                  <td className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                    {timeAgo(c.updatedAt)}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="row gap-sm">
                      {c.status !== 'running' && (
                        <button
                          className="btn btn-icon btn-ghost"
                          title="Open research project"
                          onClick={async () => {
                            await selectCampaign(c.id)
                            setView('dashboard')
                          }}
                        >
                          <IconPlay size={14} />
                        </button>
                      )}
                      <button
                        className="btn btn-icon btn-ghost"
                        title="Delete"
                        onClick={() => onDelete(c.id, c.title)}
                      >
                        <IconTrash size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <CampaignForm onClose={() => setCreating(false)} />}
    </div>
  )
}

const DEPTHS = [
  {
    label: 'Focused screen',
    hint: 'A small set of distinct strategies for an initial discussion.',
    budget: { initialGeneration: 3, targetDesigns: 8, maxCycles: 6 }
  },
  {
    label: 'Balanced exploration',
    hint: 'Broader strategy coverage with iterative review and refinement.',
    budget: { initialGeneration: 6, targetDesigns: 24, maxCycles: 30 }
  },
  {
    label: 'Extended exploration',
    hint: 'More alternatives and refinement; uses more model calls.',
    budget: { initialGeneration: 8, targetDesigns: 48, maxCycles: 60 }
  }
]

function CampaignForm({ onClose }: { onClose: () => void }): JSX.Element {
  const { refreshCampaigns, selectCampaign, setView } = useStore()
  const [step, setStep] = useState(0)
  const [preset, setPreset] = useState<HostPresetId>('ecoli')
  const [customName, setCustomName] = useState('')
  const [strainBackground, setStrainBackground] = useState('')
  const [productTarget, setProductTarget] = useState('')
  const [title, setTitle] = useState('')
  const [objective, setObjective] = useState<EngineeringObjective>('increase-titer')
  const [goal, setGoal] = useState('')
  const [tools, setTools] = useState('')
  const [forbidden, setForbidden] = useState('')
  const [biosafety, setBiosafety] = useState<'BSL-1' | 'BSL-2' | 'unspecified'>('unspecified')
  const [onlyNovel, setOnlyNovel] = useState(false)
  const [preferences, setPreferences] = useState('')
  const [lab, setLab] = useState<LabContext>({ metric: 'titer', unit: 'g/L' })
  const [baseline, setBaseline] = useState('')
  const [target, setTarget] = useState('')
  const [depth, setDepth] = useState(1)
  const [budget, setBudget] = useState(DEPTHS[1].budget)
  const [tournamentConfig, setTournamentConfig] =
    useState<TournamentConfig>(DEFAULT_TOURNAMENT_CONFIG)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const setContext = (key: keyof LabContext, value: string) =>
    setLab((l) => ({ ...l, [key]: value }))
  const validGoal =
    !!productTarget.trim() && !!goal.trim() && (preset !== 'custom' || !!customName.trim())
  const validReference =
    (!baseline.trim() || Number.isFinite(Number(baseline))) &&
    (!target.trim() || Number.isFinite(Number(target))) &&
    (!(baseline.trim() || target.trim()) || !!lab.unit?.trim())

  const submit = async () => {
    if (!validGoal || !validReference || submitting) return
    const input: CreateCampaignInput = {
      title: title.trim(),
      productTarget: productTarget.trim(),
      objective,
      goal: goal.trim(),
      host: {
        preset,
        customName: preset === 'custom' ? customName.trim() : undefined,
        strainBackground: strainBackground.trim() || undefined
      },
      labContext: {
        ...lab,
        baselineValue: baseline.trim() ? Number(baseline) : undefined,
        targetValue: target.trim() ? Number(target) : undefined
      },
      constraints: {
        availableTools: splitList(tools),
        forbiddenInterventions: splitList(forbidden),
        biosafety,
        onlyNovel
      },
      preferences: preferences.trim(),
      tournamentConfig,
      computeBudget: budget
    }
    const validation = campaignInputSchema.safeParse(input)
    if (!validation.success) {
      setError(validation.error.issues.map((i) => i.message).join('. '))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const campaign = await window.api.createCampaign(input)
      await refreshCampaigns()
      await selectCampaign(campaign.id)
      setView('dashboard')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <Drawer
      title="Define a research project"
      subtitle="Start with what you know. Missing experimental details can be supplied later."
      onClose={() => {
        if (!submitting) onClose()
      }}
    >
      <div className="wizard-steps">
        {['Goal & strain', 'Experimental reference', 'Lab constraints'].map((label, i) => (
          <button
            key={label}
            aria-current={step === i ? 'step' : undefined}
            disabled={submitting || (i > 0 && !validGoal) || (i > 1 && !validReference)}
            onClick={() => setStep(i)}
            className={step === i ? 'current' : ''}
          >
            <span>{i + 1}</span>
            {label}
          </button>
        ))}
      </div>
      <div className="drawer-body">
        {step === 0 && (
          <div className="col gap-md">
            <div className="section-intro">
              <h3>What would make this strain better?</h3>
              <p>
                Describe the production problem in your own words. You do not need a computational
                model.
              </p>
            </div>
            <div className="field">
              <label htmlFor="project-product">Product or phenotype *</label>
              <input
                id="project-product"
                value={productTarget}
                onChange={(e) => setProductTarget(e.target.value)}
                placeholder="e.g. L-lysine, mevalonate, secreted amylase"
              />
            </div>
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="project-host">Host organism</label>
                <select
                  id="project-host"
                  value={preset}
                  onChange={(e) => setPreset(e.target.value as HostPresetId)}
                >
                  {HOST_PRESET_LIST.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="project-strain">Strain background</label>
                <input
                  id="project-strain"
                  value={strainBackground}
                  onChange={(e) => setStrainBackground(e.target.value)}
                  placeholder="Strain name and existing modifications"
                />
              </div>
            </div>
            {preset === 'custom' && (
              <div className="field">
                <label htmlFor="project-custom">Organism name *</label>
                <input
                  id="project-custom"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                />
              </div>
            )}
            <div className="field">
              <label htmlFor="project-objective">Main improvement</label>
              <select
                id="project-objective"
                value={objective}
                onChange={(e) => {
                  const value = e.target.value as EngineeringObjective
                  const metric: LabContext['metric'] =
                    value === 'increase-yield'
                      ? 'yield'
                      : value === 'increase-rate'
                        ? 'rate'
                        : value === 'improve-tolerance'
                          ? 'tolerance'
                          : value === 'increase-titer' || value === 'reduce-byproduct'
                            ? 'titer'
                            : 'other'
                  setObjective(value)
                  setLab((l) => ({ ...l, metric, unit: METRIC_UNITS[metric] }))
                  setBaseline('')
                  setTarget('')
                }}
              >
                {OBJECTIVES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="project-goal">Research goal *</label>
              <textarea
                id="project-goal"
                rows={4}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="What limits production today? What improvement matters, and what must be preserved (growth, stability, process compatibility)?"
              />
            </div>
            <div className="field">
              <label htmlFor="project-title">Project name (optional)</label>
              <input
                id="project-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Defaults to product + host"
              />
            </div>
          </div>
        )}
        {step === 1 && (
          <div className="col gap-md">
            <div className="section-intro">
              <h3>What is the comparison based on?</h3>
              <p>
                Keep baseline and target in the same unit and culture context. Leave unknown values
                blank; they will remain explicitly unspecified.
              </p>
            </div>
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="project-metric">Primary measurement</label>
                <select
                  id="project-metric"
                  value={lab.metric}
                  onChange={(e) => {
                    const metric = e.target.value as LabContext['metric']
                    setLab((l) => ({ ...l, metric, unit: METRIC_UNITS[metric] }))
                    setBaseline('')
                    setTarget('')
                  }}
                >
                  {Object.entries(METRIC_LABELS).map(([v, label]) => (
                    <option value={v} key={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="project-unit">
                  Measurement unit{baseline || target ? ' *' : ''}
                </label>
                <input
                  id="project-unit"
                  value={lab.unit ?? ''}
                  onChange={(e) => setContext('unit', e.target.value)}
                  placeholder="e.g. g/L, g/g glucose"
                />
              </div>
            </div>
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="project-baseline">Current baseline</label>
                <input
                  id="project-baseline"
                  type="number"
                  step="any"
                  value={baseline}
                  onChange={(e) => setBaseline(e.target.value)}
                  placeholder="Unknown is OK"
                />
              </div>
              <div className="field">
                <label htmlFor="project-target">Success target</label>
                <input
                  id="project-target"
                  type="number"
                  step="any"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder="Your experimental decision threshold"
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="project-reference">Reference / parental strain</label>
              <input
                id="project-reference"
                value={lab.baselineStrain ?? ''}
                onChange={(e) => setContext('baselineStrain', e.target.value)}
                placeholder="Which strain produced the baseline?"
              />
            </div>
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="project-carbon">Carbon source</label>
                <input
                  id="project-carbon"
                  value={lab.carbonSource ?? ''}
                  onChange={(e) => setContext('carbonSource', e.target.value)}
                  placeholder="Substrate and concentration if known"
                />
              </div>
              <div className="field">
                <label htmlFor="project-culture">Culture format</label>
                <select
                  id="project-culture"
                  value={lab.cultureMode ?? ''}
                  onChange={(e) => setContext('cultureMode', e.target.value)}
                >
                  {[
                    '',
                    'Microplate',
                    'Shake flask',
                    'Batch bioreactor',
                    'Fed-batch bioreactor',
                    'Continuous culture',
                    'Other'
                  ].map((v) => (
                    <option key={v} value={v}>
                      {v || 'Not specified'}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="project-medium">Medium</label>
              <input
                id="project-medium"
                value={lab.medium ?? ''}
                onChange={(e) => setContext('medium', e.target.value)}
                placeholder="Defined / complex medium, key supplements"
              />
            </div>
            <div className="field">
              <label htmlFor="project-conditions">Culture conditions</label>
              <input
                id="project-conditions"
                value={lab.conditions ?? ''}
                onChange={(e) => setContext('conditions', e.target.value)}
                placeholder="Temperature, pH, aeration, induction, sampling time…"
              />
            </div>
            <div className="field">
              <label htmlFor="project-assay">Available measurements</label>
              <input
                id="project-assay"
                value={lab.assay ?? ''}
                onChange={(e) => setContext('assay', e.target.value)}
                placeholder="Product assay, substrate consumption, growth, byproducts…"
              />
            </div>
            <div className="field">
              <label htmlFor="project-bottlenecks">Known bottlenecks & previous attempts</label>
              <textarea
                id="project-bottlenecks"
                rows={3}
                value={lab.bottlenecks ?? ''}
                onChange={(e) => setContext('bottlenecks', e.target.value)}
                placeholder="What has already worked or failed? Include context and measurements when available."
              />
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="col gap-md">
            <div className="section-intro">
              <h3>Fit the proposals to your lab</h3>
              <p>
                These constraints steer the research. Saving a project does not start paid model
                calls.
              </p>
            </div>
            <div className="field">
              <label htmlFor="project-tools">Available engineering methods</label>
              <input
                id="project-tools"
                value={tools}
                onChange={(e) => setTools(e.target.value)}
                placeholder="e.g. CRISPRi, genome integration, plasmid expression"
              />
              <span className="hint">
                Separate methods with commas. Leave blank if not yet decided.
              </span>
            </div>
            <div className="field">
              <label htmlFor="project-forbidden">Exclude from proposals</label>
              <input
                id="project-forbidden"
                value={forbidden}
                onChange={(e) => setForbidden(e.target.value)}
                placeholder="e.g. antibiotic markers, plasmids, changes to essential genes"
              />
            </div>
            <div className="field">
              <label htmlFor="project-preferences">Practical requirements</label>
              <textarea
                id="project-preferences"
                rows={2}
                value={preferences}
                onChange={(e) => setPreferences(e.target.value)}
                placeholder="Max edits per strain, available screening capacity, marker-free production, timeline…"
              />
            </div>
            <div className="field">
              <label htmlFor="project-biosafety">Lab biosafety context</label>
              <select
                id="project-biosafety"
                value={biosafety}
                onChange={(e) => setBiosafety(e.target.value as typeof biosafety)}
              >
                <option value="unspecified">Not specified</option>
                <option value="BSL-1">BSL-1</option>
                <option value="BSL-2">BSL-2</option>
              </select>
            </div>
            <div className="section-title">How broadly should research explore?</div>
            <div className="col gap-sm">
              {DEPTHS.map((d, i) => (
                <button
                  key={d.label}
                  aria-pressed={depth === i}
                  className={`depth-option ${depth === i ? 'selected' : ''}`}
                  onClick={() => {
                    setDepth(i)
                    setBudget(d.budget)
                  }}
                >
                  <b>{d.label}</b>
                  <span>{d.hint}</span>
                  <small>
                    Up to {d.budget.targetDesigns} designs · {d.budget.maxCycles} research rounds
                  </small>
                </button>
              ))}
            </div>
            <details className="advanced">
              <summary>Advanced research & comparison settings</summary>
              <div className="grid grid-3">
                {(['initialGeneration', 'targetDesigns', 'maxCycles'] as const).map((key, i) => (
                  <div className="field" key={key}>
                    <label htmlFor={`budget-${key}`}>
                      {['Initial proposals', 'Target designs', 'Max rounds'][i]}
                    </label>
                    <input
                      id={`budget-${key}`}
                      type="number"
                      min={1}
                      max={key === 'initialGeneration' ? 20 : 120}
                      value={budget[key]}
                      onChange={(e) => {
                        setDepth(-1)
                        setBudget((b) => ({ ...b, [key]: Number(e.target.value) }))
                      }}
                    />
                  </div>
                ))}
              </div>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={onlyNovel}
                  onChange={(e) => setOnlyNovel(e.target.checked)}
                />{' '}
                Restrict proposals to novel strategies
              </label>
              <TournamentConfigEditor value={tournamentConfig} onChange={setTournamentConfig} />
            </details>
            <div className="brief-summary">
              <b>
                {productTarget} · {hostDisplayName(preset, customName)}
              </b>
              <p>{goal}</p>
              <span className="muted">
                Reference: {baseline || 'unspecified'} → target {target || 'unspecified'} {lab.unit}{' '}
                · {lab.cultureMode || 'culture format unspecified'}
              </span>
            </div>
          </div>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
      </div>
      <div className="drawer-footer">
        <span className="hint">Step {step + 1} of 3</span>
        <span className="spacer" />
        {step > 0 && (
          <button className="btn" disabled={submitting} onClick={() => setStep(step - 1)}>
            Back
          </button>
        )}
        {step < 2 ? (
          <button
            className="btn btn-primary"
            disabled={step === 0 ? !validGoal : !validReference}
            onClick={() => setStep(step + 1)}
          >
            Continue →
          </button>
        ) : (
          <button
            className="btn btn-primary"
            disabled={!validGoal || !validReference || submitting}
            onClick={() => void submit()}
          >
            {submitting ? 'Saving…' : 'Save research brief'}
          </button>
        )}
      </div>
    </Drawer>
  )
}

function splitList(s: string): string[] {
  return s
    .split(/[,，\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
}
