import { useState } from 'react'
import type { Campaign, Citation, HostContext } from '@shared/domain'
import {
  availablePathways, effectiveHost, formatHost, PATHWAY_EVIDENCE, PATHWAY_EVIDENCE_LABELS,
  pathwayLeaders, selectedHost, YIELD_KINDS,
  type EngineeringDecision, type PathwayDraft, type PathwayOption, type PlanningStage
} from '@shared/engineering'
import { HOST_PRESET_LIST, HOST_PRESETS } from '@shared/hosts'
import { pathwayDraftSchema } from '@shared/validation'
import { useStore } from '../store/useStore'
import { Empty } from '../components/ui'

export function EngineeringPlanning({ stage }: { stage: PlanningStage }): JSX.Element {
  const { snapshot, setView } = useStore()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [unvalidatedOnly, setUnvalidatedOnly] = useState(false)
  const campaign = snapshot?.campaign
  if (!campaign) return <div className="page"><Empty title="Choose a research project" /></div>

  const host = effectiveHost(campaign)
  const hostOption = selectedHost(campaign)
  const hosts = campaign.engineering?.hosts ?? []
  const pathways = availablePathways(campaign)
  const pathwayId = campaign.engineering?.selectedPathwayId
  const visiblePathways = unvalidatedOnly ? pathways.filter((p) => p.evidence === 'hypothetical') : pathways
  const editingDisabled = busy || campaign.status === 'running'

  const run = async (action: () => Promise<Campaign>): Promise<boolean> => {
    if (editingDisabled) return false
    setBusy(true)
    setError('')
    try {
      await action()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setBusy(false)
    }
  }
  const decide = (decision: EngineeringDecision) => run(() => window.api.updateEngineeringPlan(campaign.id, decision))

  return (
    <div className="page col gap-lg engineering-planning">
      <div className="page-heading">
        <div>
          <div className="eyebrow">{campaign.title} · {campaign.productTarget}</div>
          <h1>{stage === 'hosts' ? 'Choose a host' : 'Compare metabolic pathways'}</h1>
          <p className="muted">
            {stage === 'hosts'
              ? 'Compare host fit, strain background and practical tradeoffs for your production goal.'
              : `Host: ${formatHost(host)}. Compare time to first validation, yield, reaction count and evidence.`}
          </p>
        </div>
        <div className="row wrap gap-sm">
          <button className="btn" onClick={() => setView(stage === 'hosts' ? 'pathways' : 'hosts')}>
            {stage === 'hosts' ? 'Compare pathways →' : 'Change host'}
          </button>
          {stage === 'pathways' && pathwayId &&
            <button className="btn btn-primary" onClick={() => setView('designs')}>Open target analysis →</button>}
        </div>
      </div>

      {error && <div className="form-error" role="alert">{error}</div>}
      {busy && <div className="hint" role="status">Updating the plan…</div>}
      {campaign.status === 'running' && <p className="hint">Pause research to change the host or pathway for the next round.</p>}

      {stage === 'hosts' ? (
        <>
          <section className="card pad-lg">
            <div className="card-head row wrap gap-sm">
              <h2 className="card-title">Host options</h2>
              <button className="btn btn-primary" disabled={editingDisabled}
                onClick={() => void run(() => window.api.suggestEngineeringOptions(campaign.id, 'hosts'))}>
                Suggest hosts
              </button>
            </div>
            <p className="hint">Project brief: {formatHost(campaign.host)}. {host.preset !== 'agnostic' && `Current host: ${formatHost(host)}.`}</p>
            {hosts.length === 0 && <p className="muted">Add a host yourself or generate options with your configured model.</p>}
            <div className="planning-hosts">
              {hosts.map((option) => (
                <article className="card col gap-sm" key={option.id}>
                  <div className="row wrap gap-sm">
                    <h3>{formatHost(option.host)}</h3>
                    <span className={option.id === hostOption?.id ? 'badge accent' : 'badge'}>
                      {option.id === hostOption?.id ? 'Selected' : option.source === 'model' ? 'Model suggestion' : 'Scientist entry'}
                    </span>
                  </div>
                  {option.rationale && <p className="prose">{option.rationale}</p>}
                  {option.limitations && <p className="hint">{option.limitations}</p>}
                  <References citations={option.citations} />
                  <div>
                    <button className="btn btn-sm" disabled={editingDisabled || option.id === hostOption?.id}
                      onClick={() => void decide({ action: 'select-host', optionId: option.id })}>
                      {option.id === hostOption?.id ? 'Host selected' : 'Use this host'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
          <HostEditor key={hostOption?.id ?? 'brief'} host={host} disabled={editingDisabled} onSave={decide} />
        </>
      ) : host.preset === 'agnostic' ? (
        <Empty title="Choose a host to compare pathways"
          action={<button className="btn btn-primary" onClick={() => setView('hosts')}>Choose host</button>} />
      ) : (
        <>
          <section className="card pad-lg col gap-md">
            <div className="card-head row wrap gap-sm">
              <h2 className="card-title">Pathway options</h2>
              <div className="row wrap gap-sm">
                {pathwayId && <button className="btn" disabled={editingDisabled}
                  onClick={() => void decide({ action: 'clear-pathway' })}>Clear pathway selection</button>}
                <button className="btn btn-primary" disabled={editingDisabled}
                  onClick={() => void run(() => window.api.suggestEngineeringOptions(campaign.id, 'pathways'))}>
                  Suggest pathways
                </button>
              </div>
            </div>
            {pathways.length > 0 ? (
              <>
                <label className="checkbox-row">
                  <input type="checkbox" checked={unvalidatedOnly} onChange={(e) => setUnvalidatedOnly(e.target.checked)} />
                  Show only unvalidated hypotheses
                </label>
                <p className="hint">Highlights compare available values on a shared basis. Reported evidence from model suggestions requires source review.</p>
                <PathwayTable pathways={visiblePathways} selectedId={pathwayId} disabled={editingDisabled}
                  onSelect={(optionId) => void decide({ action: 'select-pathway', optionId })} />
              </>
            ) : (
              <Empty title="No pathways listed for this host" hint="Add a pathway or request model suggestions for this project." />
            )}
          </section>
          <PathwayEditor key={formatHost(host)} disabled={editingDisabled} onSave={decide} />
        </>
      )}
    </div>
  )
}

function References({ citations }: { citations?: Citation[] }): JSX.Element | null {
  if (!citations?.length) return null
  return (
    <details>
      <summary>Supplied references ({citations.length})</summary>
      <ul className="list-tight">
        {citations.map((c, index) => (
          <li key={index}>
            {c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.title}</a> : c.title}
            {c.note && <div className="hint">{c.note}</div>}
          </li>
        ))}
      </ul>
    </details>
  )
}

function HostEditor({ host, disabled, onSave }: {
  host: HostContext; disabled: boolean; onSave: (decision: EngineeringDecision) => Promise<boolean>
}): JSX.Element {
  const [draft, setDraft] = useState({ ...host, preset: host.preset === 'agnostic' ? 'ecoli' as const : host.preset })
  return (
    <details className="card advanced">
      <summary>Specify a host manually</summary>
      <form className="col gap-md" onSubmit={(e) => {
        e.preventDefault()
        void onSave({ action: 'set-host', host: {
          preset: draft.preset,
          customName: draft.preset === 'custom' ? draft.customName?.trim() : undefined,
          strainBackground: draft.strainBackground?.trim(),
          notes: draft.notes?.trim()
        } })
      }}>
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="plan-host-preset">Host</label>
            <select id="plan-host-preset" value={draft.preset}
              onChange={(e) => setDraft({ preset: e.target.value as typeof draft.preset })}>
              {HOST_PRESET_LIST.filter((preset) => preset.id !== 'agnostic').map((preset) => (
                <option value={preset.id} key={preset.id}>{preset.name}</option>
              ))}
            </select>
          </div>
          {draft.preset === 'custom' && <div className="field">
            <label htmlFor="plan-host-name">Organism name</label>
            <input id="plan-host-name" required value={draft.customName ?? ''} onChange={(e) => setDraft({ ...draft, customName: e.target.value })} />
          </div>}
          <div className="field">
            <label htmlFor="plan-host-strain">Strain background</label>
            <input id="plan-host-strain" value={draft.strainBackground ?? ''} onChange={(e) => setDraft({ ...draft, strainBackground: e.target.value })} />
          </div>
        </div>
        <p className="hint">{HOST_PRESETS[draft.preset].strengths}</p>
        <div className="field">
          <label htmlFor="plan-host-notes">Selection rationale and host notes</label>
          <textarea id="plan-host-notes" rows={2} value={draft.notes ?? ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
        </div>
        <div><button className="btn btn-primary" type="submit" disabled={disabled}>Save host selection</button></div>
      </form>
    </details>
  )
}

function PathwayTable({ pathways, selectedId, disabled, onSelect }: {
  pathways: PathwayOption[]; selectedId?: string; disabled: boolean; onSelect: (id: string) => void
}): JSX.Element {
  const leaders = pathwayLeaders(pathways)
  if (!pathways.length) return <Empty title="No unvalidated hypotheses in this list" />
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Pathway comparison">
      <table className="table pathway-table">
        <thead><tr>
          <th scope="col">Pathway and evidence</th>
          <th scope="col">Time to first validation</th>
          <th scope="col">Yield</th>
          <th scope="col">Reaction steps</th>
          <th scope="col">Selection</th>
        </tr></thead>
        <tbody>
          {pathways.map((p) => (
            <tr key={p.id} className={selectedId === p.id ? 'pathway-selected' : undefined}>
              <th scope="row">
                <h3>{p.title}</h3>
                <div className="row wrap gap-sm">
                  <span className={p.evidence === 'hypothetical' ? 'badge warn' : 'badge'}>{PATHWAY_EVIDENCE_LABELS[p.evidence]}</span>
                  <span className="hint">{p.source === 'model' ? 'Model suggestion' : 'Scientist entry'}</span>
                </div>
                <p className="prose">{p.summary}</p>
                <p className="hint">{p.limitations}</p>
                <References citations={p.citations} />
              </th>
              <td><Metric value={p.timeToValidation && `${p.timeToValidation.days} days (estimated)`}
                basis={p.timeToValidation?.basis} leader={leaders.time.has(p.id) ? 'Shortest estimate' : undefined} /></td>
              <td><Metric value={p.yield && `${p.yield.value} ${p.yield.unit} (${p.yield.kind})`}
                basis={p.yield?.basis} leader={leaders.yield.has(p.id) ? 'Highest comparable yield' : undefined} /></td>
              <td><Metric value={p.steps && String(p.steps.count)} basis={p.steps?.basis}
                leader={leaders.steps.has(p.id) ? 'Fewest steps' : undefined} /></td>
              <td><button className={selectedId === p.id ? 'btn btn-sm' : 'btn btn-primary btn-sm'}
                disabled={disabled || selectedId === p.id} onClick={() => onSelect(p.id)}>
                {selectedId === p.id ? 'Selected' : 'Use pathway'}
              </button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Metric({ value, basis, leader }: { value?: string; basis?: string; leader?: string }): JSX.Element {
  if (!value) return <span className="hint">Unknown</span>
  return <div className="col gap-sm">
    <b>{value}</b>
    <span className="hint">{basis}</span>
    {leader && <span className="badge accent">{leader}</span>}
  </div>
}

function PathwayEditor({ disabled, onSave }: {
  disabled: boolean; onSave: (decision: EngineeringDecision) => Promise<boolean>
}): JSX.Element {
  const [evidence, setEvidence] = useState<PathwayDraft['evidence']>('unknown')
  const [error, setError] = useState('')
  return (
    <details className="card advanced">
      <summary>Add a pathway manually</summary>
      <form className="col gap-md" onSubmit={async (event) => {
        event.preventDefault()
        const form = event.currentTarget
        const fields = new FormData(form)
        const read = (name: string) => String(fields.get(name) ?? '').trim()
        const reference = read('reference')
        const url = read('referenceUrl')
        const parsed = pathwayDraftSchema.safeParse({
          title: read('title'), summary: read('summary'), evidence, limitations: read('limitations'),
          citations: reference || url ? [{ title: reference || url, url: url || undefined }] : undefined,
          timeToValidation: read('days') ? { days: Number(read('days')), basis: read('timeBasis') } : undefined,
          yield: read('yield') ? { value: Number(read('yield')), unit: read('yieldUnit'), basis: read('yieldBasis'), kind: read('yieldKind') } : undefined,
          steps: read('steps') ? { count: Number(read('steps')), basis: read('stepBasis') } : undefined
        })
        if (!parsed.success) {
          setError(parsed.error.issues.map((issue) => `${issue.path.join(' · ')} — ${issue.message}`).join('. '))
          return
        }
        setError('')
        if (await onSave({ action: 'add-pathway', pathway: parsed.data })) {
          form.reset()
          setEvidence('unknown')
        }
      }}>
        <div className="grid grid-2">
          <PlanField name="title" label="Pathway name" required />
          <div className="field">
            <label htmlFor="pathway-evidence">Evidence status</label>
            <select id="pathway-evidence" value={evidence} onChange={(e) => setEvidence(e.target.value as PathwayDraft['evidence'])}>
              {PATHWAY_EVIDENCE.map((status) => <option value={status} key={status}>{PATHWAY_EVIDENCE_LABELS[status]}</option>)}
            </select>
          </div>
          <PlanField name="summary" label="Route concept and starting material" required multiline />
          <PlanField name="limitations" label="Tradeoffs and evidence gaps" required multiline />
        </div>
        <div className="pathway-metrics">
          <fieldset className="card col gap-sm">
            <legend>Time to first validation</legend>
            <PlanField name="days" label="Estimated days" type="number" />
            <PlanField name="timeBasis" label="Starting point, endpoint and resources" />
          </fieldset>
          <fieldset className="card col gap-sm">
            <legend>Yield</legend>
            <div className="grid grid-2">
              <PlanField name="yield" label="Value" type="number" />
              <PlanField name="yieldUnit" label="Unit" />
            </div>
            <div className="field">
              <label htmlFor="pathway-yieldKind">Yield type</label>
              <select id="pathway-yieldKind" name="yieldKind">
                {YIELD_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
              </select>
            </div>
            <PlanField name="yieldBasis" label="Product, substrate and conditions" />
          </fieldset>
          <fieldset className="card col gap-sm">
            <legend>Reaction steps</legend>
            <PlanField name="steps" label="Number of steps" type="number" />
            <PlanField name="stepBasis" label="Start, end and counting convention" />
          </fieldset>
        </div>
        <div className="grid grid-2">
          <PlanField name="reference" label="Reference title or DOI" />
          <PlanField name="referenceUrl" label="Reference URL" type="url" />
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div><button className="btn btn-primary" type="submit" disabled={disabled}>Add to comparison</button></div>
      </form>
    </details>
  )
}

function PlanField({ name, label, required, multiline, type = 'text' }: {
  name: string; label: string; required?: boolean; multiline?: boolean; type?: string
}): JSX.Element {
  return <div className="field">
    <label htmlFor={`pathway-${name}`}>{label}</label>
    {multiline
      ? <textarea id={`pathway-${name}`} name={name} required={required} rows={2} />
      : <input id={`pathway-${name}`} name={name} required={required} type={type}
          step={type === 'number' ? 'any' : undefined} />}
  </div>
}
