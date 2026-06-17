import { useState } from 'react'
import { useStore } from '../store/useStore'
import { Empty } from '../components/ui'
import { IconTournament, IconChevron } from '../components/Icons'
import { TournamentConfigEditor } from '../components/TournamentConfigEditor'
import { DEFAULT_TOURNAMENT_CONFIG, type TournamentConfig } from '@shared/domain'

export function TournamentView(): JSX.Element {
  const { snapshot, refreshSnapshot } = useStore()
  const [open, setOpen] = useState<string | null>(null)
  const [cfgOpen, setCfgOpen] = useState(false)
  const [draft, setDraft] = useState<TournamentConfig | null>(null)
  const [applying, setApplying] = useState(false)

  if (!snapshot) return <div className="page"><Empty icon={<IconTournament size={36} />} title="No campaign selected" /></div>

  const campaign = snapshot.campaign
  const liveCfg = campaign.tournamentConfig ?? DEFAULT_TOURNAMENT_CONFIG
  const matches = [...snapshot.matches].reverse()
  const designTitle = (id: string): string => snapshot.designs.find((d) => d.id === id)?.title ?? '(removed)'
  const debates = matches.filter((m) => m.mode === 'debate').length

  const openConfig = (): void => {
    setDraft(draft ?? structuredClone(liveCfg))
    setCfgOpen((v) => !v)
  }

  const apply = async (): Promise<void> => {
    if (!draft) return
    setApplying(true)
    try {
      await window.api.updateTournamentConfig(campaign.id, draft)
      await refreshSnapshot()
      setCfgOpen(false)
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 'var(--fs-xl)' }}>Tournament</h2>
        <span className="spacer" />
        <span className="badge">{matches.length} matches</span>
        <span className="badge accent">{debates} debates</span>
        <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={openConfig}>
          Scoring config
        </button>
      </div>

      {cfgOpen && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="faint" style={{ fontSize: 'var(--fs-sm)', marginBottom: 12 }}>
            Re-weighting replays the Elo ladder from each match&apos;s stored per-criterion scores —
            no matches are re-run. Scheduling changes take effect on the next cycle.
          </div>
          <TournamentConfigEditor value={draft ?? liveCfg} onChange={setDraft} />
          <div className="row" style={{ marginTop: 12 }}>
            <span className="spacer" />
            <button className="btn" disabled={applying} onClick={() => { setDraft(structuredClone(liveCfg)); setCfgOpen(false) }}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={applying} onClick={apply}>
              {applying ? 'Re-ranking…' : 'Apply & re-rank'}
            </button>
          </div>
        </div>
      )}

      {matches.length === 0 ? (
        <Empty title="No matches yet" hint="The Ranking agent runs Elo tournament matches between designs as the campaign progresses." />
      ) : (
        <div className="col gap-sm">
          {matches.map((m) => {
            const expanded = open === m.id
            const winnerIsA = m.winnerId === m.designAId
            const hasTotals = typeof m.weightedTotalA === 'number' && typeof m.weightedTotalB === 'number'
            return (
              <div key={m.id} className="card" style={{ padding: 0 }}>
                <div
                  className="row"
                  style={{ padding: '12px 16px', cursor: 'pointer' }}
                  onClick={() => setOpen(expanded ? null : m.id)}
                >
                  <IconChevron size={14} className="" />
                  <span className={`badge ${m.mode === 'debate' ? 'accent' : ''}`}>{m.mode}</span>
                  <div style={{ marginLeft: 8 }}>
                    <span style={{ fontWeight: winnerIsA ? 700 : 400, color: winnerIsA ? 'var(--text)' : 'var(--text-muted)' }}>
                      {designTitle(m.designAId)}
                    </span>
                    {hasTotals && <span className="faint" style={{ fontSize: 'var(--fs-xs)', margin: '0 4px' }}>({m.weightedTotalA})</span>}
                    <span className="faint" style={{ margin: '0 8px' }}>vs</span>
                    <span style={{ fontWeight: !winnerIsA ? 700 : 400, color: !winnerIsA ? 'var(--text)' : 'var(--text-muted)' }}>
                      {designTitle(m.designBId)}
                    </span>
                    {hasTotals && <span className="faint" style={{ fontSize: 'var(--fs-xs)', marginLeft: 4 }}>({m.weightedTotalB})</span>}
                  </div>
                  <span className="spacer" />
                  <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>cycle {m.cycle}</span>
                  <span className="badge ok" style={{ marginLeft: 8 }}>Δ{m.eloDelta}</span>
                </div>
                {expanded && (
                  <div style={{ padding: '0 16px 14px 16px', borderTop: '1px solid var(--border-subtle)' }}>
                    <div className="detail-block" style={{ marginTop: 12 }}>
                      <h4>Debate / comparison</h4>
                      <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{m.transcript}</p>
                    </div>
                    <div className="detail-block" style={{ marginBottom: 0 }}>
                      <h4>Decision rationale</h4>
                      <p>{m.rationale}</p>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
