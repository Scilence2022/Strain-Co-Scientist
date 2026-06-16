import type { Campaign, EvolutionStrategy, StrainDesign } from '@shared/domain'
import type { EngineContext } from '../context'
import { parseJsonLoose } from '../../llm'
import { evolutionPrompt, SYSTEM_PREAMBLE } from '../prompts'
import { coerceDesign } from './util'

/**
 * Evolution agent. Refines top designs by producing NEW designs (it never
 * mutates an existing one — each new design must re-earn its rank in the
 * tournament). Implements the paper's six refinement strategies.
 */
export class EvolutionAgent {
  constructor(private ctx: EngineContext) {}

  async evolve(
    campaign: Campaign,
    parents: StrainDesign[],
    strategy: EvolutionStrategy,
    cycle: number,
    metaFeedback?: string
  ): Promise<StrainDesign | null> {
    if (!parents.length) return null

    let child: StrainDesign | null
    let failureMeta: Record<string, unknown> = { strategy }
    let literature: string | undefined
    if (strategy === 'grounding-enhancement' && this.ctx.deepResearch.available) {
      const finding = await this.ctx.deepResearch.search([
        { query: `improve ${parents[0].title} ${campaign.productTarget}`, researchGoal: campaign.goal }
      ])
      if (finding) literature = finding.summary
    }
    const res = await this.ctx.llm.complete({
      agent: 'evolution',
      system: SYSTEM_PREAMBLE,
      prompt: evolutionPrompt(campaign, parents, strategy, { literature, metaFeedback }),
      effort: 'medium',
      think: true,
      maxTokens: 4000
    })
    child = coerceDesign(parseJsonLoose<any>(res.text), campaign, 'evolved', () => this.ctx.newId())
    if (child) {
      child.lineage = { parentIds: parents.map((p) => p.id), strategy }
    } else {
      failureMeta = {
        strategy,
        stopReason: res.stopReason,
        outputTokens: res.usage.outputTokens,
        rawSnippet: res.text.slice(0, 400)
      }
    }

    if (!child) {
      const stop = (failureMeta.stopReason as string) ?? 'unknown'
      const truncated = stop === 'max_tokens' || stop === 'length'
      this.ctx.log(
        campaign.id,
        'evolution',
        'warning',
        `Evolution (${strategy}) produced no parseable design (stop: ${stop})${
          truncated ? ' — output truncated, raise the model max output tokens' : ''
        }`,
        failureMeta
      )
      return null
    }
    this.ctx.upsertDesign(child)
    this.ctx.log(
      campaign.id,
      'evolution',
      'success',
      `Evolved "${child.title}" from ${parents.length} parent(s) via ${strategy}`,
      { designId: child.id, strategy }
    )
    return child
  }
}
