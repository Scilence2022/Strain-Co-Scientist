import { useState } from 'react'
import { useStore } from '../store/useStore'
import { CampaignStatusPill, Empty, timeAgo } from '../components/ui'
import { IconPlus, IconClose, IconTrash, IconCampaigns, IconPlay } from '../components/Icons'
import { HOST_PRESET_LIST, hostDisplayName } from '@shared/hosts'
import {
  DEFAULT_COMPUTE_BUDGET,
  DEFAULT_TOURNAMENT_CONFIG,
  type EngineeringObjective,
  type HostPresetId,
  type TournamentConfig
} from '@shared/domain'
import type { CreateCampaignInput } from '@shared/ipc'
import { TournamentConfigEditor } from '../components/TournamentConfigEditor'

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
        <h2 style={{ fontSize: 'var(--fs-xl)' }}>Campaigns</h2>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <IconPlus size={15} /> New campaign
        </button>
      </div>

      {campaigns.length === 0 ? (
        <Empty
          icon={<IconCampaigns size={36} />}
          title="No campaigns yet"
          hint="A campaign is a strain-engineering goal: a product target, a host, and constraints. The multi-agent engine then generates, reviews, and ranks designs toward it."
        />
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Host</th>
                <th>Objective</th>
                <th className="num">Designs</th>
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
                    <div className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{c.productTarget}</div>
                  </td>
                  <td className="muted">{hostDisplayName(c.host.preset, c.host.customName)}</td>
                  <td className="muted">{OBJECTIVES.find((o) => o.value === c.objective)?.label}</td>
                  <td className="num">—</td>
                  <td>
                    <CampaignStatusPill status={c.status} />
                  </td>
                  <td className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{timeAgo(c.updatedAt)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="row gap-sm">
                      {c.status !== 'running' && (
                        <button
                          className="btn btn-icon btn-ghost"
                          title="Run"
                          onClick={() => window.api.startCampaign(c.id)}
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

function CampaignForm({ onClose }: { onClose: () => void }): JSX.Element {
  const { refreshCampaigns, selectCampaign, setView } = useStore()
  const [preset, setPreset] = useState<HostPresetId>('ecoli')
  const [customName, setCustomName] = useState('')
  const [strainBackground, setStrainBackground] = useState('')
  const [hostNotes, setHostNotes] = useState('')
  const [productTarget, setProductTarget] = useState('')
  const [title, setTitle] = useState('')
  const [objective, setObjective] = useState<EngineeringObjective>('increase-titer')
  const [goal, setGoal] = useState('')
  const [tools, setTools] = useState('CRISPR-Cas9, plasmid overexpression, RBS tuning')
  const [forbidden, setForbidden] = useState('')
  const [biosafety, setBiosafety] = useState<'BSL-1' | 'BSL-2' | 'unspecified'>('unspecified')
  const [onlyNovel, setOnlyNovel] = useState(false)
  const [preferences, setPreferences] = useState('')
  const [initialGeneration, setInitialGeneration] = useState(DEFAULT_COMPUTE_BUDGET.initialGeneration)
  const [targetDesigns, setTargetDesigns] = useState(DEFAULT_COMPUTE_BUDGET.targetDesigns)
  const [maxCycles, setMaxCycles] = useState(DEFAULT_COMPUTE_BUDGET.maxCycles)
  const [tournamentConfig, setTournamentConfig] = useState<TournamentConfig>(DEFAULT_TOURNAMENT_CONFIG)
  const [submitting, setSubmitting] = useState(false)

  const valid = productTarget.trim() && goal.trim()

  const submit = async () => {
    if (!valid) return
    setSubmitting(true)
    const input: CreateCampaignInput = {
      title: title.trim(),
      productTarget: productTarget.trim(),
      host: {
        preset,
        customName: preset === 'custom' ? customName.trim() : undefined,
        strainBackground: strainBackground.trim() || undefined,
        notes: hostNotes.trim() || undefined
      },
      objective,
      goal: goal.trim(),
      constraints: {
        availableTools: splitList(tools),
        forbiddenInterventions: splitList(forbidden),
        biosafety,
        onlyNovel
      },
      preferences: preferences.trim(),
      tournamentConfig,
      computeBudget: { initialGeneration, targetDesigns, maxCycles }
    }
    const campaign = await window.api.createCampaign(input)
    await refreshCampaigns()
    await selectCampaign(campaign.id)
    setView('dashboard')
    onClose()
  }

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-head">
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 'var(--fs-lg)' }}>New campaign</h3>
            <div className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
              Define the strain-engineering goal, host, and constraints.
            </div>
          </div>
          <button className="btn btn-icon btn-ghost" onClick={onClose}>
            <IconClose size={16} />
          </button>
        </div>
        <div className="drawer-body">
          <div className="field">
            <label>Product target *</label>
            <input
              value={productTarget}
              onChange={(e) => setProductTarget(e.target.value)}
              placeholder="e.g. mevalonate, L-lysine, secreted amylase"
            />
          </div>

          <div className="grid grid-2">
            <div className="field">
              <label>Host / chassis</label>
              <select value={preset} onChange={(e) => setPreset(e.target.value as HostPresetId)}>
                {HOST_PRESET_LIST.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.shortName} — {h.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Objective</label>
              <select value={objective} onChange={(e) => setObjective(e.target.value as EngineeringObjective)}>
                {OBJECTIVES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {preset === 'custom' && (
            <div className="field">
              <label>Custom host name</label>
              <input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="e.g. Yarrowia lipolytica" />
            </div>
          )}

          <div className="grid grid-2">
            <div className="field">
              <label>Strain background</label>
              <input value={strainBackground} onChange={(e) => setStrainBackground(e.target.value)} placeholder="e.g. BL21(DE3), CEN.PK" />
            </div>
            <div className="field">
              <label>Host notes (optional)</label>
              <input value={hostNotes} onChange={(e) => setHostNotes(e.target.value)} placeholder="extra context for the agents" />
            </div>
          </div>

          <div className="field">
            <label>Research goal *</label>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={4}
              placeholder="Describe the goal in natural language: what to improve, by how much, known bottlenecks, prior attempts, and any data the agents should consider."
            />
          </div>

          <div className="field">
            <label>Desirable attributes / preferences</label>
            <textarea
              value={preferences}
              onChange={(e) => setPreferences(e.target.value)}
              rows={2}
              placeholder="e.g. prefer genome-integrated edits, minimal antibiotic markers, scalable to fed-batch"
            />
          </div>

          <div className="divider" />
          <div className="section-title">Constraints</div>
          <div className="field">
            <label>Available genetic tools</label>
            <input value={tools} onChange={(e) => setTools(e.target.value)} />
            <span className="hint">Comma-separated.</span>
          </div>
          <div className="field">
            <label>Forbidden interventions</label>
            <input value={forbidden} onChange={(e) => setForbidden(e.target.value)} placeholder="e.g. antibiotic-resistance markers" />
            <span className="hint">Comma-separated; leave blank for none.</span>
          </div>
          <div className="grid grid-2">
            <div className="field">
              <label>Biosafety level</label>
              <select value={biosafety} onChange={(e) => setBiosafety(e.target.value as any)}>
                <option value="BSL-1">BSL-1</option>
                <option value="BSL-2">BSL-2</option>
                <option value="unspecified">Unspecified</option>
              </select>
            </div>
            <div className="field" style={{ justifyContent: 'flex-end' }}>
              <label className="checkbox-row">
                <input type="checkbox" checked={onlyNovel} onChange={(e) => setOnlyNovel(e.target.checked)} />
                Only propose novel designs
              </label>
            </div>
          </div>

          <div className="divider" />
          <div className="section-title">Compute budget (test-time scaling)</div>
          <div className="grid grid-3">
            <div className="field">
              <label>Initial generation</label>
              <input type="number" min={2} max={20} value={initialGeneration} onChange={(e) => setInitialGeneration(+e.target.value)} />
            </div>
            <div className="field">
              <label>Target designs</label>
              <input type="number" min={6} max={120} value={targetDesigns} onChange={(e) => setTargetDesigns(+e.target.value)} />
            </div>
            <div className="field">
              <label>Max cycles</label>
              <input type="number" min={4} max={120} value={maxCycles} onChange={(e) => setMaxCycles(+e.target.value)} />
            </div>
          </div>

          <div className="divider" />
          <div className="section-title">Tournament scoring</div>
          <TournamentConfigEditor value={tournamentConfig} onChange={setTournamentConfig} />

          <div className="field">
            <label>Campaign title (optional)</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="auto-generated if blank" />
          </div>

          <div className="row" style={{ marginTop: 8 }}>
            <span className="spacer" />
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={!valid || submitting} onClick={submit}>
              Create campaign
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function splitList(s: string): string[] {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
}
