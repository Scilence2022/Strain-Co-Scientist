import type { Campaign, Match, StrainDesign } from '@shared/domain'
import type { EngineContext } from '../context'
import { parseJsonLoose } from '../../llm'
import { matchPrompt, SYSTEM_PREAMBLE } from '../prompts'
import { updateElo } from '../tournament/Elo'

/**
 * Ranking agent — runs Elo tournament matches via pairwise scientific debate.
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
    const decision = await this.llmMatch(campaign, a, b, mode)

    const aWon = decision.winner === 'A'
    const { newA, newB, delta } = updateElo(a.elo, b.elo, aWon ? 1 : 0)

    a.elo = newA
    b.elo = newB
    const at = Date.now()
    a.eloHistory.push({ cycle, at, elo: newA })
    b.eloHistory.push({ cycle, at, elo: newB })
    if (aWon) {
      a.wins += 1
      b.losses += 1
    } else {
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
      winnerId: aWon ? a.id : b.id,
      mode,
      transcript: decision.transcript,
      rationale: decision.rationale,
      eloDelta: delta
    }
    this.ctx.addMatch(match)
    this.ctx.log(
      campaign.id,
      'ranking',
      'info',
      `Match: "${a.title}" vs "${b.title}" → ${aWon ? a.title : b.title} (Δ${delta})`,
      { matchId: match.id }
    )
    return match
  }

  private async llmMatch(
    campaign: Campaign,
    a: StrainDesign,
    b: StrainDesign,
    mode: 'debate' | 'single-turn'
  ): Promise<{ winner: 'A' | 'B'; transcript: string; rationale: string }> {
    const res = await this.ctx.llm.complete({
      agent: 'ranking',
      system: SYSTEM_PREAMBLE,
      prompt: matchPrompt(campaign, a, b, mode),
      effort: mode === 'debate' ? 'medium' : 'low',
      think: mode === 'debate',
      maxTokens: 2000
    })
    const parsed = parseJsonLoose<any>(res.text) ?? {}
    const winner: 'A' | 'B' = parsed.winner === 'B' ? 'B' : 'A'
    return {
      winner,
      transcript: String(parsed.transcript ?? ''),
      rationale: String(parsed.rationale ?? '')
    }
  }
}
