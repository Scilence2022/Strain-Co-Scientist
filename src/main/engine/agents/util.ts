import type {
  Campaign,
  DBTLStep,
  DesignOrigin,
  Intervention,
  InterventionType,
  QuantPrediction,
  StrainDesign
} from '@shared/domain'
import { hostDisplayName } from '@shared/hosts'
import { INITIAL_ELO } from '../tournament/Elo'

const VALID_INTERVENTIONS: InterventionType[] = [
  'knockout',
  'overexpression',
  'knockdown',
  'promoter-swap',
  'rbs-tuning',
  'heterologous-pathway',
  'transporter-engineering',
  'cofactor-balancing',
  'dynamic-regulation',
  'enzyme-engineering',
  'other'
]

function coerceInterventions(raw: any): Intervention[] {
  if (!Array.isArray(raw)) return []
  return raw.map((r) => ({
    type: VALID_INTERVENTIONS.includes(r?.type) ? r.type : 'other',
    targets: Array.isArray(r?.targets) ? r.targets.map(String) : r?.targets ? [String(r.targets)] : [],
    details: String(r?.details ?? '')
  }))
}

function coercePlan(raw: any): DBTLStep[] {
  if (!Array.isArray(raw)) return []
  const phases = ['design', 'build', 'test', 'learn']
  return raw.map((r) => ({
    phase: phases.includes(r?.phase) ? r.phase : 'design',
    description: String(r?.description ?? '')
  }))
}

const QP_METRICS: QuantPrediction['metric'][] = ['titer', 'rate', 'yield', 'tolerance', 'other']

/** Coerce a loosely-parsed structured prediction; returns undefined if unusable. */
function coerceQuantPrediction(raw: any): QuantPrediction | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const metric = QP_METRICS.includes(raw.metric) ? raw.metric : 'other'
  const direction = raw.direction === 'decrease' ? 'decrease' : 'increase'
  const rc = Number(raw.relativeChange)
  const conf = Number(raw.confidence)
  const pred: QuantPrediction = { metric, direction }
  if (Number.isFinite(rc)) pred.relativeChange = Math.abs(rc)
  if (Number.isFinite(conf)) pred.confidence = Math.max(0, Math.min(1, conf))
  if (raw.baselineNote) pred.baselineNote = String(raw.baselineNote)
  // Only keep a prediction that carries at least a magnitude — a bare
  // metric/direction adds nothing the free-text predictedEffect doesn't.
  return typeof pred.relativeChange === 'number' ? pred : undefined
}

/**
 * Normalise a loosely-parsed generation payload into an array of design
 * objects. Accepts a bare array, a single design object, or a common wrapper
 * the model sometimes emits despite being asked for a bare array
 * (`{ designs|strategies|results|items|data: [...] }`). Without this, a wrapped
 * array parsed to a single object with no `title` and silently yielded zero
 * designs.
 */
export function toDesignObjects(parsed: any): any[] {
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object') {
    for (const key of ['designs', 'strategies', 'results', 'items', 'data']) {
      if (Array.isArray(parsed[key])) return parsed[key]
    }
    return [parsed] // treat as a single design (coerceDesign rejects it if untitled)
  }
  return []
}

/** Build a StrainDesign from a loosely-parsed LLM object. */
export function coerceDesign(
  obj: any,
  campaign: Campaign,
  origin: DesignOrigin,
  newId: () => string
): StrainDesign | null {
  if (!obj || typeof obj !== 'object') return null
  const title = String(obj.title ?? '').trim()
  if (!title) return null
  const now = Date.now()
  const host = hostDisplayName(campaign.host.preset, campaign.host.customName)
  return {
    id: newId(),
    campaignId: campaign.id,
    createdAt: now,
    updatedAt: now,
    title,
    summary: String(obj.summary ?? ''),
    chassis: String(obj.chassis ?? host),
    interventions: coerceInterventions(obj.interventions),
    mechanism: String(obj.mechanism ?? ''),
    predictedEffect: String(obj.predictedEffect ?? ''),
    quantPrediction: coerceQuantPrediction(obj.quantPrediction),
    experimentalPlan: coercePlan(obj.experimentalPlan),
    constructSuggestions: [],
    risks: Array.isArray(obj.risks) ? obj.risks.map(String) : [],
    citations: Array.isArray(obj.citations)
      ? obj.citations
          .filter((c: any) => c && (c.title || c.url))
          .map((c: any) => ({ title: String(c.title ?? c.url), url: c.url, note: c.note }))
      : [],
    novelty: clampScore(obj.novelty, 5),
    origin,
    status: 'draft',
    lineage: { parentIds: [] },
    elo: INITIAL_ELO,
    eloHistory: [],
    wins: 0,
    losses: 0,
    reviewCount: 0
  }
}

export function clampScore(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(10, Math.round(n)))
}
