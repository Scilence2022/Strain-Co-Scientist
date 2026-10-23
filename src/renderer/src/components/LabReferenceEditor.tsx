import { useState } from 'react'
import type { Campaign, LabContext } from '@shared/domain'
import { METRIC_LABELS, METRIC_UNITS } from '@shared/workbench'
import { labContextSchema } from '@shared/validation'
import { Drawer } from './Drawer'
import { useStore } from '../store/useStore'

export function LabReferenceEditor({
  campaign,
  onClose
}: {
  campaign: Campaign
  onClose: () => void
}): JSX.Element {
  const { refreshSnapshot } = useStore()
  const [lab, setLab] = useState<LabContext>(
    campaign.labContext ?? { metric: 'titer', unit: 'g/L' }
  )
  const [baseline, setBaseline] = useState(String(lab.baselineValue ?? ''))
  const [target, setTarget] = useState(String(lab.targetValue ?? ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    const next = {
      ...lab,
      baselineValue: baseline.trim() ? Number(baseline) : undefined,
      targetValue: target.trim() ? Number(target) : undefined
    }
    if ((baseline.trim() || target.trim()) && !lab.unit?.trim()) {
      setError('Specify a shared measurement unit.')
      return
    }
    const parsed = labContextSchema.safeParse(next)
    if (!parsed.success) {
      setError('Check the measurement values; use finite numbers or leave unknown values blank.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await window.api.updateLabContext(campaign.id, next)
      await refreshSnapshot()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  const textFields: { key: keyof LabContext; label: string }[] = [
    { key: 'baselineStrain', label: 'Reference / parental strain' },
    { key: 'carbonSource', label: 'Carbon source' },
    { key: 'cultureMode', label: 'Culture format' },
    { key: 'medium', label: 'Medium' },
    { key: 'conditions', label: 'Culture conditions' },
    { key: 'assay', label: 'Available measurements' },
    { key: 'bottlenecks', label: 'Known bottlenecks & previous attempts' }
  ]
  return (
    <Drawer
      title="Edit the experimental reference"
      subtitle="Applies to future research. Existing design predictions and recorded batch values retain their original context."
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <div className="drawer-body col gap-md">
        {campaign.status === 'running' && (
          <div className="evidence-gaps">
            Pause research before changing the reference so in-flight proposals use consistent
            conditions.
          </div>
        )}
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="reference-metric">Primary measurement</label>
            <select
              id="reference-metric"
              value={lab.metric}
              onChange={(e) => {
                const metric = e.target.value as LabContext['metric']
                setLab((l) => ({ ...l, metric, unit: METRIC_UNITS[metric] }))
                setBaseline('')
                setTarget('')
              }}
            >
              {Object.entries(METRIC_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="reference-unit">Shared measurement unit</label>
            <input
              id="reference-unit"
              value={lab.unit ?? ''}
              onChange={(e) => setLab((l) => ({ ...l, unit: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="reference-baseline">Current baseline</label>
            <input
              id="reference-baseline"
              type="number"
              step="any"
              value={baseline}
              onChange={(e) => setBaseline(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="reference-target">Success target</label>
            <input
              id="reference-target"
              type="number"
              step="any"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </div>
        </div>
        {textFields.map(({ key, label }) => (
          <div className="field" key={key}>
            <label htmlFor={`reference-${key}`}>{label}</label>
            <textarea
              id={`reference-${key}`}
              rows={key === 'bottlenecks' ? 3 : 2}
              value={String(lab[key] ?? '')}
              onChange={(e) => setLab((l) => ({ ...l, [key]: e.target.value }))}
            />
          </div>
        ))}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
      </div>
      <div className="drawer-footer">
        <span className="hint">Unknown values can remain blank.</span>
        <span className="spacer" />
        <button
          className="btn btn-primary"
          disabled={busy || campaign.status === 'running'}
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : 'Save experimental reference'}
        </button>
      </div>
    </Drawer>
  )
}
