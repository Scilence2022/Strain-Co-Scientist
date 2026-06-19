import { useStore } from '../store/useStore'
import { EloChart, ChartLegend, StackBar, BiasTrend } from '../components/Charts'
import { Empty, clockTime } from '../components/ui'
import { IconBeaker } from '../components/Icons'
import { AGENT_LABELS, type AgentRole, type SystemStatistics } from '@shared/domain'

export function Dashboard(): JSX.Element {
  const { snapshot, setView } = useStore()

  if (!snapshot) {
    return (
      <div className="page">
        <Empty
          icon={<IconBeaker size={36} />}
          title="No campaign selected"
          hint="Create a strain-engineering campaign to begin generating, reviewing, and ranking designs."
        />
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn btn-primary" onClick={() => setView('campaigns')}>
            Go to Campaigns
          </button>
        </div>
      </div>
    )
  }

  const { designs, reviews, matches, statistics, events, tasks } = snapshot
  const results = snapshot.results ?? []
  const calibration = snapshot.calibration ?? []
  const latestCal = calibration[calibration.length - 1]
  const evidenceSegments = [
    { label: 'Confirmed', value: designs.filter((d) => d.evidence === 'measured-confirmed').length, color: 'var(--green)' },
    { label: 'Partial', value: designs.filter((d) => d.evidence === 'measured-partial').length, color: 'var(--blue)' },
    { label: 'Refuted', value: designs.filter((d) => d.evidence === 'measured-refuted').length, color: 'var(--red)' }
  ]
  const measuredCount = evidenceSegments.reduce((s, x) => s + x.value, 0)
  const active = designs.filter((d) => d.status === 'active' || d.status === 'flagged')
  const sortedElo = [...active].sort((a, b) => b.elo - a.elo)
  const bestElo = sortedElo[0]?.elo ?? 1200
  const top10 = sortedElo.slice(0, 10)
  const top10avg = top10.length ? Math.round(top10.reduce((s, d) => s + d.elo, 0) / top10.length) : 1200
  const latest: SystemStatistics | undefined = statistics[statistics.length - 1]
  const progress = latest?.terminalProgress ?? 0

  const statusSegments = [
    { label: 'In tournament', value: designs.filter((d) => d.status === 'active').length, color: 'var(--accent)' },
    { label: 'Flagged', value: designs.filter((d) => d.status === 'flagged').length, color: 'var(--amber)' },
    { label: 'Draft', value: designs.filter((d) => d.status === 'draft').length, color: 'var(--text-faint)' },
    { label: 'Rejected', value: designs.filter((d) => d.status === 'rejected').length, color: 'var(--red)' }
  ]

  const runningTasks = tasks.filter((t) => t.state === 'running')
  const queued = tasks.filter((t) => t.state === 'queued').length

  // Agent utilization (task counts).
  const agentCounts = new Map<AgentRole, number>()
  for (const t of tasks) agentCounts.set(t.agent, (agentCounts.get(t.agent) ?? 0) + 1)
  const maxAgent = Math.max(1, ...agentCounts.values())

  return (
    <div className="page col gap-lg">
      <div className="grid grid-4">
        <Stat label="Designs (active)" value={active.length} sub={`${designs.length} total generated`} />
        <Stat label="Best Elo" value={bestElo} sub="Top-ranked design" />
        <Stat label="Top-10 avg Elo" value={top10avg} sub="Quality of the frontier" />
        <Stat label="Tournament matches" value={matches.length} sub={`${reviews.length} reviews`} />
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.7fr 1fr' }}>
        <div className="card pad-lg">
          <div className="card-head">
            <div className="card-title">Elo over compute (test-time scaling)</div>
            <ChartLegend />
          </div>
          <EloChart stats={statistics} />
        </div>

        <div className="col gap-md">
          <div className="card">
            <div className="section-title">Terminal progress</div>
            <div className="progress" style={{ marginBottom: 6 }}>
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <div className="row">
              <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
                cycle {latest?.cycle ?? 0} / {snapshot.campaign.computeBudget.maxCycles}
              </span>
              <span className="spacer" />
              <span className="mono">{Math.round(progress * 100)}%</span>
            </div>
          </div>

          <div className="card">
            <div className="section-title">Strategy effectiveness</div>
            <WinRate label="Generation win-rate" value={latest?.generationWinRate ?? 0} color="var(--accent)" />
            <div style={{ height: 8 }} />
            <WinRate label="Evolution win-rate" value={latest?.evolutionWinRate ?? 0} color="var(--blue)" />
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card">
          <div className="section-title">Designs by status</div>
          <StackBar segments={statusSegments} />
        </div>

        <div className="card">
          <div className="section-title">Agent utilization (worker tasks)</div>
          <div className="col" style={{ gap: 8 }}>
            {(Object.keys(AGENT_LABELS) as AgentRole[])
              .filter((a) => a !== 'supervisor')
              .map((a) => {
                const c = agentCounts.get(a) ?? 0
                return (
                  <div key={a} className="row gap-md">
                    <span className="muted" style={{ width: 100, fontSize: 'var(--fs-sm)' }}>
                      {AGENT_LABELS[a]}
                    </span>
                    <div className="bar-mini" style={{ flex: 1 }}>
                      <span style={{ width: `${(c / maxAgent) * 100}%` }} />
                    </div>
                    <span className="mono" style={{ width: 28, textAlign: 'right' }}>
                      {c}
                    </span>
                  </div>
                )
              })}
          </div>
        </div>
      </div>

      {(results.length > 0 || measuredCount > 0) && (
        <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
          <div className="card">
            <div className="card-head">
              <div className="card-title">Prediction calibration</div>
              {latestCal ? (
                <span className="badge">{latestCal.nPairs} measured pair{latestCal.nPairs === 1 ? '' : 's'}</span>
              ) : (
                <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>awaiting measured values</span>
              )}
            </div>
            <BiasTrend profiles={calibration} />
            {latestCal && (
              <div className="row wrap gap-md" style={{ marginTop: 10 }}>
                <CalMetric label="Signed bias" value={`${signed(latestCal.signedBias)} pts`} hint="positive = over-optimistic" />
                <CalMetric label="Mean abs err" value={`${Math.round(latestCal.meanAbsError * 100)} pts`} />
                <CalMetric label="Spearman" value={latestCal.spearman.toFixed(2)} hint="predicted vs measured rank" />
                {typeof latestCal.brier === 'number' && <CalMetric label="Brier" value={latestCal.brier.toFixed(2)} />}
              </div>
            )}
          </div>
          <div className="card">
            <div className="section-title">Evidence standing ({measuredCount} measured)</div>
            {measuredCount === 0 ? (
              <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
                {results.length} result{results.length === 1 ? '' : 's'} recorded; none yet decisive.
              </span>
            ) : (
              <StackBar segments={evidenceSegments} />
            )}
          </div>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card">
          <div className="card-head">
            <div className="card-title">Worker queue</div>
            <span className="badge">{queued} queued</span>
          </div>
          {runningTasks.length === 0 ? (
            <div className="faint" style={{ fontSize: 'var(--fs-sm)' }}>No tasks running.</div>
          ) : (
            <div className="col gap-sm">
              {runningTasks.map((t) => (
                <div key={t.id} className="row gap-sm">
                  <span className="status-dot run" />
                  <span className="badge accent">{AGENT_LABELS[t.agent]}</span>
                  <span style={{ fontSize: 'var(--fs-sm)' }}>{t.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <div className="card-title">Live activity</div>
            <button className="btn btn-ghost btn-sm" onClick={() => setView('log')}>
              View all
            </button>
          </div>
          <div className="scroll-y" style={{ maxHeight: 220 }}>
            {events.slice(-14).reverse().map((e) => (
              <div key={e.id} className="feed-line">
                <span className="feed-time">{clockTime(e.at)}</span>
                <span className="feed-agent">{e.agent}</span>
                <span className={`feed-msg ${e.severity}`}>{e.message}</span>
              </div>
            ))}
            {events.length === 0 && <div className="faint" style={{ fontSize: 'var(--fs-sm)' }}>Run the campaign to see activity.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }): JSX.Element {
  return (
    <div className="card stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  )
}

function signed(fraction: number): string {
  const pts = Math.round(fraction * 100)
  return `${pts >= 0 ? '+' : ''}${pts}`
}

function CalMetric({ label, value, hint }: { label: string; value: string; hint?: string }): JSX.Element {
  return (
    <div className="col" style={{ minWidth: 96 }}>
      <span className="faint" style={{ fontSize: 'var(--fs-xs)' }} title={hint}>
        {label}
      </span>
      <span className="mono" style={{ fontSize: 'var(--fs-md)' }}>
        {value}
      </span>
    </div>
  )
}

function WinRate({ label, value, color }: { label: string; value: number; color: string }): JSX.Element {
  return (
    <div>
      <div className="row" style={{ marginBottom: 5 }}>
        <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{label}</span>
        <span className="spacer" />
        <span className="mono">{Math.round(value * 100)}%</span>
      </div>
      <div className="bar-mini">
        <span style={{ width: `${Math.round(value * 100)}%`, background: color }} />
      </div>
    </div>
  )
}
