import type { CriteriaWeights, CriterionKey, TournamentConfig } from '@shared/domain'
import { CRITERIA_KEYS } from '@shared/domain'

/**
 * Elo rating utilities for the Ranking agent's tournament.
 * New hypotheses start at 1200 (matching the paper).
 */
export const INITIAL_ELO = 1200

export const DEFAULT_K_FACTOR = 32

/** Shared by live judging and deterministic replay. */
export function decideMatch(totalA: number, totalB: number, eloA: number, eloB: number, tieHandling: TournamentConfig['tieHandling']): 0 | 0.5 | 1 {
  if (totalA === totalB && tieHandling === 'draw') return 0.5
  if (totalA === totalB) return eloA >= eloB ? 1 : 0
  return totalA > totalB ? 1 : 0
}

export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400))
}

/**
 * Returns the new ratings after a match. `scoreA` is 1 if A won, 0 if A lost,
 * 0.5 for a draw. `kFactor` controls rating volatility (per-campaign config).
 */
export function updateElo(
  ratingA: number,
  ratingB: number,
  scoreA: number,
  kFactor: number = DEFAULT_K_FACTOR
): { newA: number; newB: number; delta: number } {
  const expA = expectedScore(ratingA, ratingB)
  const expB = expectedScore(ratingB, ratingA)
  const newA = ratingA + kFactor * (scoreA - expA)
  const newB = ratingB + kFactor * (1 - scoreA - expB)
  return {
    newA: Math.round(newA),
    newB: Math.round(newB),
    delta: Math.round(Math.abs(newA - ratingA))
  }
}

/**
 * Weighted sum of a design's per-criterion judge scores. Missing criteria are
 * skipped (not treated as 0), so a partial score object degrades gracefully.
 * This is the head-to-head ranking quantity: higher weighted total wins.
 */
export function weightedTotal(
  scores: Partial<Record<CriterionKey, number>> | undefined,
  weights: CriteriaWeights
): number {
  if (!scores) return 0
  let total = 0
  for (const k of CRITERIA_KEYS) {
    const s = scores[k]
    if (typeof s === 'number') total += (weights[k] ?? 0) * s
  }
  return total
}
