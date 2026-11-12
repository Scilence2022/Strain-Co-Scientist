import type { Campaign } from '@shared/domain'
import {
  availablePathways,
  effectiveHost,
  formatHost,
  hostKey,
  type EngineeringDecision,
  type EngineeringPlan,
  type PlanningStage
} from '@shared/engineering'
import { HOST_PRESET_LIST } from '@shared/hosts'
import { hostOptionSchema, pathwayDraftSchema } from '@shared/validation'
import { parseJsonLoose } from '../llm'
import type { EngineContext } from './context'
import { goalContext, SYSTEM_PREAMBLE } from './prompts'

export function decideEngineeringPlan(
  campaign: Campaign,
  decision: EngineeringDecision,
  newId: () => string
): EngineeringPlan {
  const plan = { ...(campaign.engineering ?? { hosts: [], pathways: [] }) }
  switch (decision.action) {
    case 'set-host': {
      const current = plan.hosts.find((option) =>
        option.source === 'scientist' && hostKey(option.host) === hostKey(decision.host) &&
        (option.host.notes ?? '') === (decision.host.notes ?? '')
      )
      const option = current ?? {
        id: newId(), source: 'scientist' as const, host: decision.host,
        rationale: decision.host.notes ?? '', limitations: ''
      }
      if (!current) plan.hosts = [...plan.hosts, option]
      if (hostKey(effectiveHost(campaign)) !== hostKey(option.host)) plan.selectedPathwayId = undefined
      plan.selectedHostId = option.id
      break
    }
    case 'select-host': {
      const option = plan.hosts.find((h) => h.id === decision.optionId)
      if (!option) throw new Error('Host option not found')
      if (hostKey(effectiveHost(campaign)) !== hostKey(option.host)) plan.selectedPathwayId = undefined
      plan.selectedHostId = option.id
      break
    }
    case 'add-pathway': {
      const host = effectiveHost(campaign)
      if (host.preset === 'agnostic') throw new Error('Choose a host before adding a pathway')
      const key = hostKey(host)
      const duplicate = availablePathways(campaign).some(({ id, hostKey: storedHostKey, source, ...draft }) =>
        source === 'scientist' && JSON.stringify(draft) === JSON.stringify(decision.pathway)
      )
      if (!duplicate) {
        plan.pathways = [...plan.pathways, {
          ...decision.pathway, id: newId(), hostKey: key, source: 'scientist'
        }]
      }
      break
    }
    case 'select-pathway':
      if (!availablePathways(campaign).some((p) => p.id === decision.optionId)) {
        throw new Error('Pathway option does not belong to the current host')
      }
      plan.selectedPathwayId = decision.optionId
      break
    case 'clear-pathway':
      plan.selectedPathwayId = undefined
      break
  }
  return plan
}

export async function suggestEngineeringOptions(
  ctx: Pick<EngineContext, 'llm' | 'newId'>,
  campaign: Campaign,
  stage: PlanningStage
): Promise<EngineeringPlan> {
  const host = effectiveHost(campaign)
  if (stage === 'pathways' && host.preset === 'agnostic') throw new Error('Choose a host before comparing pathways')
  const plan = campaign.engineering ?? { hosts: [], pathways: [] }
  const citationShape = '"citations": [{"title": "source title or DOI", "url": "optional HTTP(S) URL", "note": "what the source supports"}]'
  const task = stage === 'hosts'
    ? `Compare up to four host options for this brief. Treat the current host, if any, as the baseline for comparison. Discuss pathway compatibility, cultivation and tool access, known advantages, and uncertainty at strain level.
Allowed preset IDs: ${HOST_PRESET_LIST.filter((h) => h.id !== 'agnostic').map((h) => `${h.id} (${h.name})`).join(', ')}.
Already listed: ${plan.hosts.map((h) => formatHost(h.host)).join(', ') || 'none'}.
Return a JSON array with objects shaped like:
{"host": {"preset": "allowed ID", "customName": "required only for custom", "strainBackground": "omit if unknown", "notes": "optional"}, "rationale": "fit to the brief", "limitations": "tradeoffs and evidence gaps", ${citationShape}}`
    : `Compare up to six distinct pathway options for ${formatHost(host)}. Explore four lenses: shorter time to first experimental validation (days, not production rate), higher yield, fewer reaction steps within the same start and end boundaries, and new unvalidated alternatives. Include each lens where scientifically plausible. Explain tradeoffs and host compatibility. Use the same explicit basis strings where quantities share assumptions. Omit unsupported numeric estimates; in limitations describe why they are unknown. Describe pathways at the planning level. A reported pathway needs a specific source. Treat an unvalidated route as a hypothesis.
Already listed for this host: ${availablePathways(campaign).map((p) => p.title).join(', ') || 'none'}.
Return a JSON array with objects shaped like:
{"title": "route name", "summary": "route concept and starting material", "limitations": "tradeoffs and evidence gaps", "evidence": "unknown|hypothetical|reported-other-host|reported-in-host",
"timeToValidation": {"days": 10, "basis": "definition of first validation, starting point and resource assumptions"},
"yield": {"value": 0.3, "unit": "g/g", "basis": "product, substrate and conditions", "kind": "theoretical|estimated|reported"},
"steps": {"count": 3, "basis": "starting metabolite to product, including or excluding transport explicitly"}, ${citationShape}}
Numbers in this example are placeholders. Omit optional fields when unknown. Use only citations you can identify.`
  const response = await ctx.llm.complete({
    agent: 'supervisor',
    system: SYSTEM_PREAMBLE,
    prompt: `${goalContext(campaign)}\n\n${task}`,
    effort: 'medium',
    maxTokens: 6000
  })
  const items = parseJsonLoose<unknown>(response.text)
  if (!Array.isArray(items)) throw new Error('The model did not return a planning options array. Retry or add an option manually.')

  if (stage === 'hosts') {
    const existing = new Set(plan.hosts.map((h) => hostKey(h.host)))
    const hosts = [...plan.hosts]
    for (const item of items.slice(0, 8)) {
      const parsed = hostOptionSchema.safeParse(item)
      if (!parsed.success) continue
      const key = hostKey(parsed.data.host)
      if (existing.has(key)) continue
      existing.add(key)
      hosts.push({ ...parsed.data, id: ctx.newId(), source: 'model' })
    }
    if (hosts.length > plan.hosts.length) return { ...plan, hosts }
  } else {
    const key = hostKey(host)
    const existing = new Set(availablePathways(campaign).map((p) => p.title.trim().toLowerCase()))
    const pathways = [...plan.pathways]
    for (const item of items.slice(0, 8)) {
      const parsed = pathwayDraftSchema.safeParse(item)
      if (!parsed.success) continue
      const title = parsed.data.title.toLowerCase()
      if (existing.has(title)) continue
      existing.add(title)
      pathways.push({ ...parsed.data, id: ctx.newId(), hostKey: key, source: 'model' })
    }
    if (pathways.length > plan.pathways.length) return { ...plan, pathways }
  }
  throw new Error('The model returned no new usable options. Retry or add an option manually.')
}
