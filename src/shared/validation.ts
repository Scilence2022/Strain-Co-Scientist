import { z } from 'zod'
import { CRITERIA_KEYS, OBJECTIVE_LABELS, INTERVENTION_LABELS, RESULT_OUTCOME_LABELS, AGENT_LABELS } from './domain'
import type { IpcApiChannel } from './ipc'
import { PROVIDER_IDS } from './providers'

const text = z.string().max(100_000)
const required = text.trim().min(1)
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/, 'Invalid identifier')
const finite = z.number().finite()
const integer = (min: number, max: number) => finite.int().min(min).max(max)
const strings = z.array(text).max(10_000)
const provider = z.enum(PROVIDER_IDS as [string, ...string[]])
const model = z.object({ provider, model: required })
const scores = z.object(Object.fromEntries(CRITERIA_KEYS.map((key) => [key, finite.min(0).max(10).optional()])))
const weights = z.object(Object.fromEntries(CRITERIA_KEYS.map((key) => [key, finite.min(0).max(10)])))
  .refine((value) => Object.values(value).some((weight) => weight > 0), 'At least one criterion weight must be positive')

export const tournamentConfigSchema = z.object({
  weights,
  topDebates: integer(0, 8),
  singleTurnMatches: integer(0, 12),
  maxPairsPerCycle: integer(1, 20),
  randomizeOrder: z.boolean(),
  tieHandling: z.enum(['higher-elo', 'draw']),
  kFactor: finite.min(8).max(64)
})

const httpUrl = z.string().max(4096).refine((value) => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password }
  catch { return false }
}, 'Expected an HTTP or HTTPS URL without embedded credentials')
const optionalUrl = z.union([httpUrl, z.literal('')]).optional()
const server = z.object({ enabled: z.boolean(), url: z.union([httpUrl, z.literal('')]), accessToken: text.optional() })
  .refine((value) => !value.enabled || !!value.url, 'An enabled server needs a URL')

export const settingsSchema = z.object({
  llm: z.object({
    provider,
    providers: z.record(provider, z.object({ enabled: z.boolean(), apiKey: text, baseUrl: optionalUrl, fetchedModels: strings.optional(), selectedModels: strings.optional() })),
    tiers: z.object({ highTier: model, fastTier: model }),
    overrides: z.record(z.enum(Object.keys(AGENT_LABELS) as [string, ...string[]]), model),
    temperature: finite.min(0).max(2),
    maxTokens: integer(0, 1_000_000)
  }),
  mcp: z.object({ deepResearch: server, codexomics: server }),
  run: z.object({ concurrency: integer(1, 32) }),
  safety: z.object({ enforceBiosafety: z.boolean() }),
  ui: z.object({ theme: z.enum(['dark', 'light']) })
})

export const labContextSchema = z.object({
  metric: z.enum(['titer', 'rate', 'yield', 'tolerance', 'other']),
  baselineValue: finite.optional(), targetValue: finite.optional(), unit: text.optional(),
  baselineStrain: text.optional(), carbonSource: text.optional(), cultureMode: text.optional(),
  medium: text.optional(), conditions: text.optional(), assay: text.optional(), bottlenecks: text.optional()
})

export const campaignInputSchema = z.object({
  title: text.trim(), productTarget: required, goal: required,
  host: z.object({ preset: z.enum(['ecoli', 'scerevisiae', 'cglutamicum', 'bsubtilis', 'pputida', 'ppastoris', 'custom', 'agnostic']), customName: text.optional(), strainBackground: text.optional(), notes: text.optional() })
    .refine((host) => host.preset !== 'custom' || !!host.customName?.trim(), 'Custom hosts require a name'),
  objective: z.enum(Object.keys(OBJECTIVE_LABELS) as [string, ...string[]]),
  constraints: z.object({ availableTools: strings, forbiddenInterventions: strings, biosafety: z.enum(['BSL-1', 'BSL-2', 'unspecified']), regulatoryNotes: text.optional(), onlyNovel: z.boolean() }),
  preferences: text,
  labContext: labContextSchema.optional(),
  tournamentConfig: tournamentConfigSchema,
  computeBudget: z.object({ initialGeneration: integer(1, 20), targetDesigns: integer(1, 120), maxCycles: integer(1, 120) })
    .refine((budget) => budget.initialGeneration <= budget.targetDesigns, 'Initial generation cannot exceed target designs')
})

const result = z.object({
  campaignId: id, designId: id,
  outcome: z.enum(Object.keys(RESULT_OUTCOME_LABELS) as [string, ...string[]]),
  metric: z.enum(['titer', 'rate', 'yield', 'tolerance', 'other']).optional(),
  measuredValue: finite.optional(), baselineValue: finite.optional(),
  unit: text.optional(), replicates: integer(1, 1_000_000).optional(), observations: required, author: text.optional(),
  runLabel: text.optional(), strainLabel: text.optional(), conditions: text.optional()
})

/** Validate every renderer request at the privileged-process boundary. */
export const ipcArguments: Record<IpcApiChannel, z.ZodTypeAny> = {
  getSettings: z.tuple([]), saveSettings: z.tuple([settingsSchema]),
  testMcp: z.tuple([z.enum(['deepResearch', 'codexomics'])]), pingLlm: z.tuple([]), listProviderModels: z.tuple([provider]),
  listCampaigns: z.tuple([]), createCampaign: z.tuple([campaignInputSchema]), deleteCampaign: z.tuple([id]), getSnapshot: z.tuple([id]),
  updateTournamentConfig: z.tuple([id, tournamentConfigSchema]),
  startCampaign: z.tuple([id]), pauseCampaign: z.tuple([id]), resumeCampaign: z.tuple([id]), stopCampaign: z.tuple([id]), reopenCampaign: z.tuple([id]),
  updateLabContext: z.tuple([id, labContextSchema]),
  regenerateOverview: z.tuple([id]), refineGoal: z.tuple([id, required]), flagDesign: z.tuple([id, z.boolean()]),
  submitExpertDesign: z.tuple([z.object({ campaignId: id, title: required, summary: required, chassis: text, mechanism: text, predictedEffect: text,
    interventions: z.array(z.object({ type: z.enum(Object.keys(INTERVENTION_LABELS) as [string, ...string[]]), targets: strings, details: text })).max(1000) })]),
  submitExpertReview: z.tuple([z.object({ campaignId: id, designId: id, verdict: z.enum(['pass', 'revise', 'reject']), narrative: required, scores, author: text })]),
  recordExperimentalResult: z.tuple([result]), disputeResult: z.tuple([id, id, z.boolean()]),
  exportFile: z.tuple([z.object({ defaultName: required, contents: z.string().max(50_000_000), filters: z.array(z.object({ name: required, extensions: z.array(required).min(1) })).optional() })])
}
