import type { AgentRole, Campaign, MetaReview, ResearchOverviewArea, StrainDesign } from '@shared/domain'
import type { EngineContext } from '../context'
import { parseJsonLoose } from '../../llm'
import { metaReviewPrompt, SYSTEM_PREAMBLE } from '../prompts'

/**
 * Meta-review agent. Synthesises recurring critique patterns into feedback
 * appended to other agents' prompts (improvement without backprop), and at the
 * end produces a research-overview DBTL roadmap for the scientist.
 */
export class MetaReviewAgent {
  constructor(private ctx: EngineContext) {}

  async synthesize(campaign: Campaign, cycle: number): Promise<MetaReview> {
    const snapshot = this.ctx.store.getSnapshot(campaign.id)
    const designs = (snapshot?.designs ?? []).filter((d) => d.status !== 'rejected')
    const top = [...designs].sort((a, b) => b.elo - a.elo).slice(0, 8)
    const reviewExcerpts = (snapshot?.reviews ?? [])
      .slice(-30)
      .map((r) => `[${r.type}/${r.verdict}] ${r.narrative}`)
    const matchPatterns = (snapshot?.matches ?? []).slice(-30).map((m) => m.rationale)

    const meta = await this.llm(campaign, cycle, top, reviewExcerpts, matchPatterns)

    this.ctx.addMetaReview(meta)
    this.ctx.log(
      campaign.id,
      'meta-review',
      'success',
      `Synthesised meta-review: ${meta.critiquePatterns.length} patterns, ${meta.overview.areas.length} roadmap areas`
    )
    return meta
  }

  private resolveAreaIds(area: any, designs: StrainDesign[]): ResearchOverviewArea {
    const titles: string[] = Array.isArray(area.relatedDesignTitles) ? area.relatedDesignTitles : []
    const relatedDesignIds = designs
      .filter((d) => titles.some((t) => d.title.toLowerCase().includes(String(t).toLowerCase().slice(0, 12))))
      .map((d) => d.id)
    return {
      title: String(area.title ?? 'Engineering area'),
      justification: String(area.justification ?? ''),
      exampleExperiments: Array.isArray(area.exampleExperiments)
        ? area.exampleExperiments.map(String)
        : [],
      relatedDesignIds
    }
  }

  private async llm(
    campaign: Campaign,
    cycle: number,
    top: StrainDesign[],
    reviewExcerpts: string[],
    matchPatterns: string[]
  ): Promise<MetaReview> {
    const res = await this.ctx.llm.complete({
      agent: 'meta-review',
      system: SYSTEM_PREAMBLE,
      prompt: metaReviewPrompt(campaign, top, reviewExcerpts, matchPatterns),
      effort: 'high',
      think: true,
      maxTokens: 5000
    })
    const parsed = parseJsonLoose<any>(res.text) ?? {}
    const agentFeedback: Partial<Record<AgentRole, string>> = {}
    for (const k of ['generation', 'reflection', 'evolution', 'ranking'] as AgentRole[]) {
      if (parsed.agentFeedback?.[k]) agentFeedback[k] = String(parsed.agentFeedback[k])
    }
    return {
      id: this.ctx.newId(),
      campaignId: campaign.id,
      cycle,
      createdAt: Date.now(),
      critiquePatterns: Array.isArray(parsed.critiquePatterns)
        ? parsed.critiquePatterns.map(String)
        : [],
      agentFeedback,
      overview: {
        summary: String(parsed.overview?.summary ?? ''),
        areas: Array.isArray(parsed.overview?.areas)
          ? parsed.overview.areas.map((a: any) => this.resolveAreaIds(a, top))
          : []
      },
      suggestedExperts: Array.isArray(parsed.suggestedExperts)
        ? parsed.suggestedExperts.map((e: any) => ({
            name: String(e.name ?? ''),
            expertise: String(e.expertise ?? ''),
            rationale: String(e.rationale ?? '')
          }))
        : []
    }
  }

}
