import type { CriterionKey, TournamentConfig } from '@shared/domain'
import { CRITERIA_KEYS, CRITERION_LABELS } from '@shared/domain'

/**
 * Editor for a campaign's tournament scoring configuration. Used both in the
 * create-campaign drawer and the Tournament view's mid-campaign re-rank panel.
 *
 * Weights are the lever the scientist cares about most: each match scores both
 * designs across these criteria and the higher weighted total wins, so raising
 * (say) Effectiveness above Novelty makes the whole ladder prefer impactful
 * targets over clever-but-marginal ones.
 */
export function TournamentConfigEditor({
  value,
  onChange
}: {
  value: TournamentConfig
  onChange: (next: TournamentConfig) => void
}): JSX.Element {
  const set = (patch: Partial<TournamentConfig>): void => onChange({ ...value, ...patch })
  const setWeight = (k: CriterionKey, n: number): void =>
    onChange({ ...value, weights: { ...value.weights, [k]: clampNum(n, 0, 10) } })

  const totalWeight = CRITERIA_KEYS.reduce((s, k) => s + (value.weights[k] ?? 0), 0)
  const pct = (w: number): string => (totalWeight > 0 ? `${Math.round((w / totalWeight) * 100)}%` : '0%')

  return (
    <div className="col gap-sm">
      <div className="section-title">Judge weights</div>
      <div className="faint" style={{ fontSize: 'var(--fs-sm)', marginTop: -4 }}>
        Each match scores both designs 0–10 per criterion; the higher weighted total wins. Set a
        weight to 0 to ignore a dimension entirely.
      </div>
      <div className="tc-weights">
        {CRITERIA_KEYS.map((k) => {
          const w = value.weights[k] ?? 0
          return (
            <div key={k} className="tc-weight-row">
              <label className="tc-weight-label">{CRITERION_LABELS[k]}</label>
              <input
                type="number"
                min={0}
                max={10}
                step={1}
                value={w}
                onChange={(e) => setWeight(k, +e.target.value)}
              />
              <span className="tc-weight-pct faint">{pct(w)}</span>
            </div>
          )
        })}
      </div>

      <div className="divider" />
      <div className="section-title">Match scheduling</div>
      <div className="grid grid-3">
        <div className="field">
          <label>Top debates / cycle</label>
          <input
            type="number"
            min={0}
            max={8}
            value={value.topDebates}
            onChange={(e) => set({ topDebates: clampNum(+e.target.value, 0, 8) })}
          />
        </div>
        <div className="field">
          <label>Single-turn / cycle</label>
          <input
            type="number"
            min={0}
            max={12}
            value={value.singleTurnMatches}
            onChange={(e) => set({ singleTurnMatches: clampNum(+e.target.value, 0, 12) })}
          />
        </div>
        <div className="field">
          <label>Max pairs / cycle</label>
          <input
            type="number"
            min={1}
            max={20}
            value={value.maxPairsPerCycle}
            onChange={(e) => set({ maxPairsPerCycle: clampNum(+e.target.value, 1, 20) })}
          />
        </div>
      </div>

      <div className="grid grid-3">
        <div className="field">
          <label>Tie handling</label>
          <select
            value={value.tieHandling}
            onChange={(e) => set({ tieHandling: e.target.value as TournamentConfig['tieHandling'] })}
          >
            <option value="higher-elo">Higher Elo wins</option>
            <option value="draw">Draw (½ point)</option>
          </select>
        </div>
        <div className="field">
          <label>Elo K-factor</label>
          <input
            type="number"
            min={8}
            max={64}
            value={value.kFactor}
            onChange={(e) => set({ kFactor: clampNum(+e.target.value, 8, 64) })}
          />
        </div>
        <div className="field" style={{ justifyContent: 'flex-end' }}>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={value.randomizeOrder}
              onChange={(e) => set({ randomizeOrder: e.target.checked })}
            />
            Randomize A/B order
          </label>
        </div>
      </div>
    </div>
  )
}

function clampNum(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.max(lo, Math.min(hi, n))
}
