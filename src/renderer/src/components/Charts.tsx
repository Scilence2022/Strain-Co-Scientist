import { useMemo } from 'react'
import type { CalibrationProfile, SystemStatistics, EloSnapshot } from '@shared/domain'

/**
 * Elo-over-time chart — the paper's signature metric. Plots the top-10 average
 * and the best Elo across supervisor cycles. Hand-rolled SVG to stay on-brand.
 */
export function EloChart({ stats }: { stats: SystemStatistics[] }): JSX.Element {
  const W = 640
  const H = 220
  const pad = { l: 44, r: 16, t: 14, b: 26 }

  const pts = stats.filter((s) => s.cycle > 0)
  if (pts.length < 2) {
    return <div className="empty" style={{ height: H }}>Elo trend appears once the tournament has a few cycles.</div>
  }

  const xs = pts.map((s) => s.cycle)
  const all = pts.flatMap((s) => [s.topEloAvg10, s.bestElo])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...all) - 10
  const maxY = Math.max(...all) + 10
  const sx = (x: number) => pad.l + ((x - minX) / Math.max(1, maxX - minX)) * (W - pad.l - pad.r)
  const sy = (y: number) => H - pad.b - ((y - minY) / Math.max(1, maxY - minY)) * (H - pad.t - pad.b)

  const line = (key: 'topEloAvg10' | 'bestElo') =>
    pts.map((s, i) => `${i === 0 ? 'M' : 'L'}${sx(s.cycle).toFixed(1)},${sy(s[key]).toFixed(1)}`).join(' ')

  const yTicks = 4
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => minY + ((maxY - minY) / yTicks) * i)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} stroke="var(--border-subtle)" />
          <text x={pad.l - 8} y={sy(t) + 3} textAnchor="end" fontSize="10" fill="var(--text-faint)">
            {Math.round(t)}
          </text>
        </g>
      ))}
      <path d={line('topEloAvg10')} fill="none" stroke="var(--accent)" strokeWidth="2" />
      <path d={line('bestElo')} fill="none" stroke="var(--blue)" strokeWidth="2" strokeDasharray="4 3" />
      {pts.map((s, i) => (
        <circle key={i} cx={sx(s.cycle)} cy={sy(s.topEloAvg10)} r="2.4" fill="var(--accent)" />
      ))}
      <text x={pad.l} y={H - 6} fontSize="10" fill="var(--text-faint)">cycle {minX}</text>
      <text x={W - pad.r} y={H - 6} fontSize="10" fill="var(--text-faint)" textAnchor="end">
        cycle {maxX}
      </text>
    </svg>
  )
}

export function ChartLegend(): JSX.Element {
  return (
    <div className="row gap-md" style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
      <span className="row gap-sm">
        <svg width="20" height="8">
          <line x1="0" y1="4" x2="20" y2="4" stroke="var(--accent)" strokeWidth="2" />
        </svg>
        Top-10 avg Elo
      </span>
      <span className="row gap-sm">
        <svg width="20" height="8">
          <line x1="0" y1="4" x2="20" y2="4" stroke="var(--blue)" strokeWidth="2" strokeDasharray="4 3" />
        </svg>
        Best Elo
      </span>
    </div>
  )
}

/** Tiny inline sparkline for a design's Elo history. */
export function Sparkline({ history }: { history: EloSnapshot[] }): JSX.Element {
  const W = 90
  const H = 22
  const data = useMemo(() => history.map((h) => h.elo), [history])
  if (data.length < 2) return <span className="faint mono">—</span>
  const min = Math.min(...data)
  const max = Math.max(...data)
  const sx = (i: number) => (i / (data.length - 1)) * W
  const sy = (v: number) => H - 2 - ((v - min) / Math.max(1, max - min)) * (H - 4)
  const d = data.map((v, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ')
  const up = data[data.length - 1] >= data[0]
  return (
    <svg width={W} height={H}>
      <path d={d} fill="none" stroke={up ? 'var(--green)' : 'var(--red)'} strokeWidth="1.6" />
    </svg>
  )
}

/**
 * Predicted-vs-measured calibration scatter. Points on the diagonal are
 * perfectly calibrated; above the line = over-prediction, below = under. Values
 * are signed relative changes (fraction vs baseline).
 */
export function CalibrationScatter({
  points
}: {
  points: { predicted: number; measured: number; label: string }[]
}): JSX.Element {
  const W = 320
  const H = 240
  const pad = 34
  if (points.length === 0) {
    return (
      <div className="empty" style={{ height: H }}>
        Record measured results with a baseline to see calibration.
      </div>
    )
  }
  const vals = points.flatMap((p) => [p.predicted, p.measured])
  const lim = Math.max(0.1, ...vals.map((v) => Math.abs(v))) * 1.15
  const sx = (v: number): number => pad + ((v + lim) / (2 * lim)) * (W - pad - 8)
  const sy = (v: number): number => H - pad - ((v + lim) / (2 * lim)) * (H - pad - 8)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
      {/* axes at zero */}
      <line x1={sx(-lim)} x2={sx(lim)} y1={sy(0)} y2={sy(0)} stroke="var(--border-subtle)" />
      <line x1={sx(0)} x2={sx(0)} y1={sy(-lim)} y2={sy(lim)} stroke="var(--border-subtle)" />
      {/* perfect-calibration diagonal */}
      <line x1={sx(-lim)} y1={sy(-lim)} x2={sx(lim)} y2={sy(lim)} stroke="var(--text-faint)" strokeDasharray="4 3" />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={sx(p.predicted)}
          cy={sy(p.measured)}
          r="4"
          fill={Math.sign(p.predicted) === Math.sign(p.measured) ? 'var(--green)' : 'var(--red)'}
          opacity={0.85}
        >
          <title>{`${p.label}\npredicted ${Math.round(p.predicted * 100)}% · measured ${Math.round(p.measured * 100)}%`}</title>
        </circle>
      ))}
      <text x={W - 6} y={sy(0) - 4} textAnchor="end" fontSize="10" fill="var(--text-faint)">
        predicted →
      </text>
      <text x={sx(0) + 4} y={12} fontSize="10" fill="var(--text-faint)">
        measured ↑
      </text>
    </svg>
  )
}

/** Signed-bias-over-cycles: is the model's over/under-prediction shrinking? */
export function BiasTrend({ profiles }: { profiles: CalibrationProfile[] }): JSX.Element {
  const W = 320
  const H = 120
  const pad = { l: 30, r: 10, t: 10, b: 18 }
  const pts = profiles.filter((p) => p.nPairs > 0)
  if (pts.length < 1) {
    return <div className="empty" style={{ height: H }}>No calibration history yet.</div>
  }
  const ys = pts.map((p) => p.signedBias)
  const lim = Math.max(0.05, ...ys.map((v) => Math.abs(v))) * 1.2
  const sx = (i: number): number =>
    pad.l + (pts.length === 1 ? 0.5 : i / (pts.length - 1)) * (W - pad.l - pad.r)
  const sy = (v: number): number => H - pad.b - ((v + lim) / (2 * lim)) * (H - pad.t - pad.b)
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(p.signedBias).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
      <line x1={pad.l} x2={W - pad.r} y1={sy(0)} y2={sy(0)} stroke="var(--border-subtle)" />
      <text x={2} y={sy(0) + 3} fontSize="9" fill="var(--text-faint)">0</text>
      <path d={d} fill="none" stroke="var(--amber)" strokeWidth="2" />
      {pts.map((p, i) => (
        <circle key={i} cx={sx(i)} cy={sy(p.signedBias)} r="2.6" fill="var(--amber)">
          <title>{`cycle ${p.cycle}: signed bias ${Math.round(p.signedBias * 100)} pts (n=${p.nPairs})`}</title>
        </circle>
      ))}
    </svg>
  )
}

/** Horizontal distribution bar (e.g. designs by status). */
export function StackBar({
  segments
}: {
  segments: { label: string; value: number; color: string }[]
}): JSX.Element {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1
  return (
    <div>
      <div style={{ display: 'flex', height: 10, borderRadius: 6, overflow: 'hidden', background: 'var(--bg-input)' }}>
        {segments.map(
          (s, i) =>
            s.value > 0 && (
              <div
                key={i}
                style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
                title={`${s.label}: ${s.value}`}
              />
            )
        )}
      </div>
      <div className="row wrap gap-md" style={{ marginTop: 8, fontSize: 'var(--fs-sm)' }}>
        {segments.map((s, i) => (
          <span key={i} className="row gap-sm muted">
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
            {s.label} <b style={{ color: 'var(--text)' }}>{s.value}</b>
          </span>
        ))}
      </div>
    </div>
  )
}
