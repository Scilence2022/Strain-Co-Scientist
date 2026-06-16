import type { Campaign, Review, ReviewType, StrainDesign, CriterionKey } from '@shared/domain'
import type { EngineContext } from '../context'
import { parseJsonLoose } from '../../llm'
import { reviewPrompt, SYSTEM_PREAMBLE } from '../prompts'
import { clampScore } from './util'

/**
 * Reflection agent — the scientific peer reviewer. Implements the paper's
 * review modes (initial / full / deep-verification / observation / simulation /
 * tournament). Full reviews use literature + genomic grounding when available.
 */
export class ReflectionAgent {
  constructor(private ctx: EngineContext) {}

  async review(
    campaign: Campaign,
    design: StrainDesign,
    type: ReviewType,
    metaFeedback?: string
  ): Promise<Review> {
    const review = await this.llmReview(campaign, design, type, metaFeedback)

    // Persist review + bump the design's review count.
    this.ctx.addReview(review)
    design.reviewCount += 1
    // Reflection can refine the design's novelty estimate.
    if (typeof review.scores.novelty === 'number') design.novelty = review.scores.novelty
    this.ctx.upsertDesign(design)

    this.ctx.log(
      campaign.id,
      'reflection',
      review.verdict === 'reject' ? 'warning' : 'info',
      `${type} review of "${design.title}" → ${review.verdict}`,
      { designId: design.id, type }
    )
    return review
  }

  private async llmReview(
    campaign: Campaign,
    design: StrainDesign,
    type: ReviewType,
    metaFeedback?: string
  ): Promise<Review> {
    let literature: string | undefined
    let geneEvidence: string | undefined

    if (type === 'full' || type === 'deep-verification') {
      if (this.ctx.deepResearch.available) {
        const finding = await this.ctx.deepResearch.search([
          { query: `${design.title} ${campaign.productTarget} prior work`, researchGoal: campaign.goal }
        ])
        if (finding) literature = finding.summary
      }
      // Verify the first concrete gene target genomically.
      if (this.ctx.codexomics.available) {
        const target = design.interventions.flatMap((i) => i.targets)[0]
        if (target) {
          const ev = await this.ctx.codexomics.checkGene(target)
          if (ev) geneEvidence = `Target "${ev.query}" found=${ev.found}. ${ev.detail}`
        }
      }
    }

    const prompt = `${reviewPrompt(campaign, design, type, literature, geneEvidence)}${
      metaFeedback ? `\n\nMETA-REVIEW FEEDBACK TO HONOUR:\n${metaFeedback}` : ''
    }`

    const res = await this.ctx.llm.complete({
      agent: 'reflection',
      system: SYSTEM_PREAMBLE,
      prompt,
      effort: type === 'initial' ? 'medium' : 'high',
      think: type !== 'initial',
      maxTokens: 3000
    })

    const parsed = parseJsonLoose<any>(res.text) ?? {}
    const scores: Partial<Record<CriterionKey, number>> = {}
    for (const key of ['alignment', 'plausibility', 'novelty', 'testability', 'hostCompatibility', 'safety'] as CriterionKey[]) {
      if (parsed.scores && parsed.scores[key] != null) scores[key] = clampScore(parsed.scores[key], 5)
    }
    const verdict: Review['verdict'] = ['pass', 'revise', 'reject'].includes(parsed.verdict)
      ? parsed.verdict
      : 'revise'

    // Enforce biosafety gate.
    if (this.ctx.settings.safety.enforceBiosafety && (scores.safety ?? 10) <= 3) {
      return {
        id: this.ctx.newId(),
        createdAt: Date.now(),
        designId: design.id,
        campaignId: campaign.id,
        type,
        scores,
        verdict: 'reject',
        narrative: `Rejected on safety grounds. ${String(parsed.narrative ?? '')}`,
        evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String) : [],
        author: 'Reflection'
      }
    }

    return {
      id: this.ctx.newId(),
      createdAt: Date.now(),
      designId: design.id,
      campaignId: campaign.id,
      type,
      scores,
      verdict,
      narrative: String(parsed.narrative ?? ''),
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String) : [],
      author: 'Reflection'
    }
  }
}
