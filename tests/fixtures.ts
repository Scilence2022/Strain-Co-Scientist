import { DEFAULT_COMPUTE_BUDGET, DEFAULT_TOURNAMENT_CONFIG, type Campaign, type CampaignSnapshot, type StrainDesign } from '../src/shared/domain'

export function campaign(id = 'campaign1'): Campaign {
  return {
    id, title: 'Test campaign', productTarget: 'Test product', goal: 'Test goal', createdAt: 1, updatedAt: 1, status: 'draft',
    host: { preset: 'agnostic' }, objective: 'other', preferences: '',
    constraints: { availableTools: [], forbiddenInterventions: [], biosafety: 'unspecified', onlyNovel: false },
    computeBudget: structuredClone(DEFAULT_COMPUTE_BUDGET), tournamentConfig: structuredClone(DEFAULT_TOURNAMENT_CONFIG)
  }
}

export function design(id = 'design1', campaignId = 'campaign1'): StrainDesign {
  return {
    id, campaignId, title: id, summary: '', chassis: '', interventions: [], mechanism: '', predictedEffect: '',
    experimentalPlan: [], constructSuggestions: [], risks: [], citations: [], novelty: 5, origin: 'expert', status: 'active',
    createdAt: 1, updatedAt: 1, lineage: { parentIds: [] }, elo: 1200, eloHistory: [], wins: 0, losses: 0, reviewCount: 0
  }
}

export function snapshot(id = 'campaign1'): CampaignSnapshot {
  return { campaign: campaign(id), designs: [], reviews: [], matches: [], metaReviews: [], statistics: [], tasks: [], events: [], results: [], calibration: [] }
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
