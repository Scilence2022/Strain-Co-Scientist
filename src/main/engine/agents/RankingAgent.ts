import type {
  Campaign,
  CriteriaWeights,
  CriterionKey,
  ExperimentalResult,
  Match,
  StrainDesign,
  TournamentConfig
} from '@shared/domain'
import { CRITERIA_KEYS, DEFAULT_TOURNAMENT_CONFIG } from '@shared/domain'
import type { EngineContext } from '../context'
import { parseJsonLoose } from '../../llm'
import { matchPrompt, SYSTEM_PREAMBLE } from '../prompts'
import { decideMatch, updateElo, weightedTotal } from '../tournament/Elo'

type Scores = Partial<Record<CriterionKey, number>>

/**
 * Ranking agent — runs Elo tournament matches via pairwise scientific debate.
 * The judge scores BOTH designs across the campaign's weighted criteria; the
 * winner is the higher weighted total (not an opaque single pick), so the
 * scientist's priorities — e.g. effectiveness over novelty — actually steer the
 * ladder. The per-design sub-scores are persisted on the Match so the ladder
 * can be replayed under new weights without re-running the match.
 *
 * Top designs get multi-turn debates; lower-ranked ones get single-turn
 * comparisons (matching the paper's optimisation).
 */
export class RankingAgent {
  constructor(private ctx: EngineContext) {}

  async match(
    campaign: Campaign,
    a: StrainDesign,
    b: StrainDesign,
    mode: 'debate' | 'single-turn',
    cycle: number
  ): Promise<Match> {
    const judgingConfig = campaign.tournamentConfig ?? DEFAULT_TOURNAMENT_CONFIG
    const resultsA = this.ctx.store.getResultsForDesign(campaign.id, a.id)
    const resultsB = this.ctx.store.getResultsForDesign(campaign.id, b.id)
    const decision = await this.llmMatch(campaign, a, b, mode, judgingConfig, resultsA, resultsB)
    this.ctx.signal?.throwIfAborted()
    if (a.status === 'rejected' || b.status === 'rejected') throw new Error('A match participant was rejected during review')
    const cfg = campaign.tournamentConfig ?? DEFAULT_TOURNAMENT_CONFIG

    const totalA = weightedTotal(decision.scoresA, cfg.weights)
    const totalB = weightedTotal(decision.scoresB, cfg.weights)
    const scoreA = decideMatch(totalA, totalB, a.elo, b.elo, cfg.tieHandling)

    const { newA, newB, delta } = updateElo(a.elo, b.elo, scoreA, cfg.kFactor)

    a.elo = newA
    b.elo = newB
    const at = Date.now()
    a.eloHistory.push({ cycle, at, elo: newA })
    b.eloHistory.push({ cycle, at, elo: newB })
    if (scoreA === 1) {
      a.wins += 1
      b.losses += 1
    } else if (scoreA === 0) {
      b.wins += 1
      a.losses += 1
    }
    this.ctx.upsertDesign(a)
    this.ctx.upsertDesign(b)

    const match: Match = {
      id: this.ctx.newId(),
      campaignId: campaign.id,
      cycle,
      createdAt: at,
      designAId: a.id,
      designBId: b.id,
      winnerId: scoreA === 0.5 ? null : scoreA === 1 ? a.id : b.id,
      mode,
      transcript: decision.transcript,
      rationale: decision.rationale,
      eloDelta: delta,
      scoresA: decision.scoresA,
      scoresB: decision.scoresB,
      weightedTotalA: Math.round(totalA * 10) / 10,
      weightedTotalB: Math.round(totalB * 10) / 10
    }
    this.ctx.addMatch(match)
    this.ctx.log(
      campaign.id,
      'ranking',
      'info',
      `Match: "${a.title}" vs "${b.title}" → ${scoreA === 0.5 ? 'Draw' : scoreA === 1 ? a.title : b.title} (${totalA.toFixed(0)} vs ${totalB.toFixed(0)}, Δ${delta})`,
      { matchId: match.id }
    )
    return match
  }

  private async llmMatch(
    campaign: Campaign,
    a: StrainDesign,
    b: StrainDesign,
    mode: 'debate' | 'single-turn',
    cfg: TournamentConfig,
    resultsA: ExperimentalResult[],
    resultsB: ExperimentalResult[]
  ): Promise<{ scoresA: Scores; scoresB: Scores; transcript: string; rationale: string }> {
    // Cancel positional bias by randomising which design is presented first,
    // then mapping the judge's scoresA/scoresB back to the real A/B. The measured
    // results travel with their design through the swap so the prompt stays correct.
    const swap = cfg.randomizeOrder && Math.random() < 0.5
    const first = swap ? b : a
    const second = swap ? a : b
    const resultsFirst = swap ? resultsB : resultsA
    const resultsSecond = swap ? resultsA : resultsB
    const res = await this.ctx.llm.complete({
      agent: 'ranking',
      system: SYSTEM_PREAMBLE,
      prompt: matchPrompt(campaign, first, second, mode, resultsFirst, resultsSecond),
      effort: mode === 'debate' ? 'medium' : 'low',
      think: mode === 'debate',
      maxTokens: 2000
    })
    const parsed = parseJsonLoose<any>(res.text)
    for (const scores of [parsed?.scoresA, parsed?.scoresB]) {
      if (!scores || !CRITERIA_KEYS.some((key) => (cfg.weights[key] ?? 0) > 0 && typeof scores[key] === 'number' && Number.isFinite(scores[key]))) {
        throw new Error(`Judge returned no usable criterion scores (stop reason: ${res.stopReason ?? 'unknown'})`)
      }
    }
    const sFirst = cleanScores(parsed.scoresA, cfg.weights)
    const sSecond = cleanScores(parsed.scoresB, cfg.weights)
    return {
      scoresA: swap ? sSecond : sFirst,
      scoresB: swap ? sFirst : sSecond,
      transcript: String(parsed.transcript ?? ''),
      rationale: String(parsed.rationale ?? '')
    }
  }
}

/**
 * Clamp the judged criteria to integers 0-10, defaulting a judged-but-missing
 * criterion to 5 so a partial parse never silently zeroes a dimension.
 * Criteria with weight 0 aren't requested and are left out.
 */
function cleanScores(raw: any, weights: CriteriaWeights): Scores {
  const out: Scores = {}
  for (const k of CRITERIA_KEYS) {
    if ((weights[k] ?? 0) <= 0) continue
    const v = Number(raw?.[k])
    out[k] = Number.isFinite(v) ? Math.max(0, Math.min(10, Math.round(v))) : 5
  }
  return out
}
