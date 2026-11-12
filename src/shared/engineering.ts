import type { Campaign, Citation, ExperimentalResult, HostContext, LabContext, StrainDesign } from './domain'
import { hostDisplayName } from './hosts'

export interface HostOption {
  id: string
  host: HostContext
  rationale: string
  limitations: string
  citations?: Citation[]
  source: 'model' | 'scientist'
}

export const PATHWAY_EVIDENCE = ['unknown', 'hypothetical', 'reported-other-host', 'reported-in-host'] as const
export const PATHWAY_EVIDENCE_LABELS: Record<(typeof PATHWAY_EVIDENCE)[number], string> = {
  unknown: 'Evidence unknown',
  hypothetical: 'Unvalidated hypothesis',
  'reported-other-host': 'Reported in another host',
  'reported-in-host': 'Reported in this host'
}

export const YIELD_KINDS = ['theoretical', 'estimated', 'reported'] as const

export interface PathwayDraft {
  title: string
  summary: string
  evidence: (typeof PATHWAY_EVIDENCE)[number]
  limitations: string
  timeToValidation?: { days: number; basis: string }
  yield?: { value: number; unit: string; basis: string; kind: (typeof YIELD_KINDS)[number] }
  steps?: { count: number; basis: string }
  citations?: Citation[]
}

export interface PathwayOption extends PathwayDraft {
  id: string
  hostKey: string
  source: HostOption['source']
}

export interface EngineeringPlan {
  hosts: HostOption[]
  pathways: PathwayOption[]
  selectedHostId?: string
  selectedPathwayId?: string
}

export interface EngineeringScope {
  id: string
  host: HostContext
  pathway?: PathwayOption
  labContext?: LabContext
}

export type PlanningStage = 'hosts' | 'pathways'

export type EngineeringDecision =
  | { action: 'set-host'; host: HostContext }
  | { action: 'select-host'; optionId: string }
  | { action: 'add-pathway'; pathway: PathwayDraft }
  | { action: 'select-pathway'; optionId: string }
  | { action: 'clear-pathway' }

export const METABOLIC_TARGET_CATEGORIES = [
  'redox-balance',
  'cofactor-regeneration',
  'rate-limiting-step',
  'precursor-supply',
  'competing-flux',
  'compartment-engineering'
] as const

export const METABOLIC_TARGET_LABELS: Record<(typeof METABOLIC_TARGET_CATEGORIES)[number], string> = {
  'redox-balance': 'NADH / NADPH balance',
  'cofactor-regeneration': 'Cofactor regeneration',
  'rate-limiting-step': 'Rate-limiting step',
  'precursor-supply': 'Precursor supply',
  'competing-flux': 'Competing flux',
  'compartment-engineering': 'Organelle / compartment engineering'
}

export const COFACTORS = ['NADH', 'NADPH', 'NAD', 'NADP', 'CoA', 'SAM', 'FAD'] as const

export interface MetabolicTargetDraft {
  name: string
  category: (typeof METABOLIC_TARGET_CATEGORIES)[number]
  cofactors?: (typeof COFACTORS)[number][]
  hypothesis: string
  readout: string
  limitation: string
}

export interface MetabolicTarget extends MetabolicTargetDraft {
  id: string
}

export function hostKey(host: HostContext): string {
  return JSON.stringify([
    host.preset,
    host.preset === 'custom' ? normalize(host.customName ?? '') : '',
    normalize(host.strainBackground ?? '')
  ])
}

export function formatHost(host: HostContext): string {
  return [hostDisplayName(host.preset, host.customName), host.strainBackground].filter(Boolean).join(' · ')
}

export function selectedHost(campaign: Campaign): HostOption | undefined {
  return campaign.engineering?.hosts.find((h) => h.id === campaign.engineering?.selectedHostId)
}

export function effectiveHost(campaign: Campaign): HostContext {
  return selectedHost(campaign)?.host ?? campaign.host
}

export function availablePathways(campaign: Campaign): PathwayOption[] {
  const key = hostKey(effectiveHost(campaign))
  return campaign.engineering?.pathways.filter((pathway) => pathway.hostKey === key) ?? []
}

export function engineeringScopeId(campaign: Campaign): string | undefined {
  return campaign.engineering?.selectedPathwayId ?? campaign.engineering?.selectedHostId
}

export function engineeringScope(campaign: Campaign): EngineeringScope | undefined {
  const id = engineeringScopeId(campaign)
  if (!id) return undefined
  const pathway = availablePathways(campaign).find((p) => p.id === campaign.engineering?.selectedPathwayId)
  return structuredClone({ id, host: effectiveHost(campaign), pathway, labContext: campaign.labContext })
}

export function inEngineeringScope(campaign: Campaign, design: StrainDesign): boolean {
  return engineeringScopeId(campaign) === design.engineeringScope?.id
}

export function resultScopeLabel(result: ExperimentalResult, design?: StrainDesign): string {
  if (!result.targetId) return 'Whole design'
  const target = design?.metabolicTargets?.find((target) => target.id === result.targetId)
  return target ? `Target: ${target.name} (${METABOLIC_TARGET_LABELS[target.category]})` : `Target: ${result.targetId}`
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Compare only estimates with the same units, assumptions and evidence basis. */
export function pathwayLeaders(pathways: PathwayOption[]): Record<'time' | 'yield' | 'steps', Set<string>> {
  const metric = (measure: (pathway: PathwayOption) => { value: number; basis: string } | undefined, direction: number) => {
    const values = pathways.flatMap((pathway) => {
      const entry = measure(pathway)
      return entry ? [{ ...entry, id: pathway.id }] : []
    })
    if (values.length < 2 || new Set(values.map((entry) => entry.basis)).size !== 1) {
      return new Set<string>()
    }
    const best = Math.min(...values.map(({ value }) => value * direction))
    return new Set(values.filter(({ value }) => value * direction === best).map(({ id }) => id))
  }
  return {
    time: metric((p) => p.timeToValidation && { value: p.timeToValidation.days, basis: normalize(p.timeToValidation.basis) }, 1),
    yield: metric((p) => p.yield && { value: p.yield.value, basis: JSON.stringify([p.yield.unit.trim(), normalize(p.yield.basis), p.yield.kind]) }, -1),
    steps: metric((p) => p.steps && { value: p.steps.count, basis: normalize(p.steps.basis) }, 1)
  }
}
