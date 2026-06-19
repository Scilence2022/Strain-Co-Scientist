import type {
  CampaignStatus,
  DesignStatus,
  EvidenceGrade,
  ResultOutcome,
  Review
} from '@shared/domain'
import { EVIDENCE_GRADE_LABELS, RESULT_OUTCOME_LABELS } from '@shared/domain'

export function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function clockTime(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

export function DesignStatusBadge({ status }: { status: DesignStatus }): JSX.Element {
  const map: Record<DesignStatus, { cls: string; label: string }> = {
    draft: { cls: '', label: 'Draft' },
    reviewing: { cls: 'blue', label: 'Reviewing' },
    active: { cls: 'accent', label: 'In tournament' },
    rejected: { cls: 'err', label: 'Rejected' },
    flagged: { cls: 'warn', label: 'Flagged' }
  }
  const m = map[status]
  return <span className={`badge ${m.cls}`}>{m.label}</span>
}

export function VerdictBadge({ verdict }: { verdict: Review['verdict'] }): JSX.Element {
  const cls = verdict === 'pass' ? 'ok' : verdict === 'reject' ? 'err' : 'warn'
  return <span className={`badge ${cls}`}>{verdict}</span>
}

export function CampaignStatusPill({ status }: { status: CampaignStatus }): JSX.Element {
  const map: Record<CampaignStatus, { dot: string; label: string }> = {
    draft: { dot: '', label: 'Draft' },
    running: { dot: 'run', label: 'Running' },
    paused: { dot: '', label: 'Paused' },
    completed: { dot: 'ok', label: 'Completed' },
    stopped: { dot: '', label: 'Stopped' },
    error: { dot: 'err', label: 'Error' }
  }
  const m = map[status]
  return (
    <span className="status-pill">
      <span className={`status-dot ${m.dot}`} />
      {m.label}
    </span>
  )
}

/**
 * Authoritative empirical standing of a design. Renders nothing for the
 * predicted-only default unless `showPredicted` is set, so the badge only draws
 * attention to designs that actually carry wet-lab evidence.
 */
export function EvidenceBadge({
  grade,
  showPredicted
}: {
  grade?: EvidenceGrade
  showPredicted?: boolean
}): JSX.Element | null {
  const g: EvidenceGrade = grade ?? 'predicted-only'
  if (g === 'predicted-only' && !showPredicted) return null
  const cls: Record<EvidenceGrade, string> = {
    'measured-confirmed': 'ok',
    'measured-partial': 'blue',
    'predicted-only': '',
    'measured-refuted': 'err'
  }
  return (
    <span className={`badge ${cls[g]}`} title="Evidence grade (measured outranks predicted)">
      {EVIDENCE_GRADE_LABELS[g]}
    </span>
  )
}

export function OutcomeBadge({ outcome }: { outcome: ResultOutcome }): JSX.Element {
  const cls: Record<ResultOutcome, string> = {
    confirmed: 'ok',
    partial: 'blue',
    refuted: 'err',
    inconclusive: 'warn',
    'build-failed': 'err'
  }
  return <span className={`badge ${cls[outcome]}`}>{RESULT_OUTCOME_LABELS[outcome]}</span>
}

export function OriginBadge({ origin }: { origin: string }): JSX.Element {
  const map: Record<string, string> = { generated: '', evolved: 'blue', expert: 'warn' }
  const label = origin === 'generated' ? 'Generated' : origin === 'evolved' ? 'Evolved' : 'Expert'
  return <span className={`badge ${map[origin] ?? ''}`}>{label}</span>
}

export function Empty({
  title,
  hint,
  icon,
  action
}: {
  title: string
  hint?: string
  icon?: JSX.Element
  action?: JSX.Element
}): JSX.Element {
  return (
    <div className="empty">
      {icon}
      <div style={{ fontSize: 'var(--fs-md)', color: 'var(--text-muted)' }}>{title}</div>
      {hint && <div style={{ maxWidth: 420 }}>{hint}</div>}
      {action && <div style={{ marginTop: 4 }}>{action}</div>}
    </div>
  )
}
