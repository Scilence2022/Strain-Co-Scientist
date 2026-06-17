import type { AgentRole, Campaign, MetaReview, ResearchOverviewArea, StrainDesign } from '@shared/domain'
import type { EngineContext } from '../context'
import { parseJsonLoose } from '../../llm'
import { metaReviewPrompt, SYSTEM_PREAMBLE } from '../prompts'

/** True when a meta-review carries no usable research overview (parse/content failure). */
export function isEmptyOverview(meta: MetaReview): boolean {
  return !meta.overview.summary.trim() && meta.overview.areas.length === 0
}

/**
 * Meta-review agent. Synthesises recurring critique patterns into feedback
 * appended to other agents' prompts (improvement without backprop), and at the
 * end produces a research-overview DBTL roadmap for the scientist.
 */
export class MetaReviewAgent {
  constructor(private ctx: EngineContext) {}

  /** Build a meta-review from the campaign state without persisting it. */
  async generate(campaign: Campaign, cycle: number): Promise<MetaReview> {
    const snapshot = this.ctx.store.getSnapshot(campaign.id)
    const designs = (snapshot?.designs ?? []).filter((d) => d.status !== 'rejected')
    const top = [...designs].sort((a, b) => b.elo - a.elo).slice(0, 8)
    const reviewExcerpts = (snapshot?.reviews ?? [])
      .slice(-30)
      .map((r) => `[${r.type}/${r.verdict}] ${r.narrative}`)
    const matchPatterns = (snapshot?.matches ?? []).slice(-30).map((m) => m.rationale)
    return this.llm(campaign, cycle, top, reviewExcerpts, matchPatterns)
  }

  async synthesize(campaign: Campaign, cycle: number): Promise<MetaReview> {
    const meta = await this.generate(campaign, cycle)
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
      // The overview is a large structured object; with adaptive thinking the
      // old 5K ceiling was routinely exhausted before the JSON closed, leaving
      // an unparseable (truncated) response. Give it ample room — the client
      // clamps this to the model's real max-output anyway.
      maxTokens: 16000
    })
    const parsed = parseJsonLoose<any>(res.text)
    if (!parsed) {
      // Surface *why* synthesis produced nothing, so a blank overview is
      // diagnosable from the Activity log instead of looking like a no-op.
      this.ctx.log(
        campaign.id,
        'meta-review',
        'warning',
        `Meta-review response did not parse (stop: ${res.stopReason ?? 'n/a'}, ${res.usage?.outputTokens ?? '?'} output tokens)`
      )
    }
    const data = parsed ?? {}
    const agentFeedback: Partial<Record<AgentRole, string>> = {}
    for (const k of ['generation', 'reflection', 'evolution', 'ranking'] as AgentRole[]) {
      if (data.agentFeedback?.[k]) agentFeedback[k] = String(data.agentFeedback[k])
    }
    return {
      id: this.ctx.newId(),
      campaignId: campaign.id,
      cycle,
      createdAt: Date.now(),
      critiquePatterns: Array.isArray(data.critiquePatterns)
        ? data.critiquePatterns.map(String)
        : [],
      agentFeedback,
      overview: {
        summary: String(data.overview?.summary ?? ''),
        areas: Array.isArray(data.overview?.areas)
          ? data.overview.areas.map((a: any) => this.resolveAreaIds(a, top))
          : []
      },
      suggestedExperts: Array.isArray(data.suggestedExperts)
        ? data.suggestedExperts.map((e: any) => ({
            name: String(e.name ?? ''),
            expertise: String(e.expertise ?? ''),
            rationale: String(e.rationale ?? '')
          }))
        : []
    }
  }

}
