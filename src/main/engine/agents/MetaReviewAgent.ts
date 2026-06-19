import type {
  AgentRole,
  Campaign,
  ExperimentalResult,
  MetaReview,
  ResearchOverviewArea,
  StrainDesign
} from '@shared/domain'
import { compareDesigns, RESULT_OUTCOME_LABELS } from '@shared/domain'
import type { EngineContext } from '../context'
import { parseJsonLoose } from '../../llm'
import { metaReviewPrompt, SYSTEM_PREAMBLE } from '../prompts'
import { calibrationNote } from '../learn/Calibration'

/** True when a meta-review carries no usable research overview (parse/content failure). */
export function isEmptyOverview(meta: MetaReview): boolean {
  return !meta.overview.summary.trim() && meta.overview.areas.length === 0
}

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Tolerant title match: exact, containment, or ≥2 shared significant words. */
function titleMatches(designTitle: string, candidate: string): boolean {
  const a = normalizeTitle(designTitle)
  const b = normalizeTitle(candidate)
  if (!a || !b) return false
  if (a === b || a.includes(b) || b.includes(a)) return true
  const wa = new Set(a.split(' ').filter((w) => w.length >= 4))
  const shared = b.split(' ').filter((w) => w.length >= 4 && wa.has(w))
  return shared.length >= 2
}

/** Short, model-facing summary of recorded wet-lab results, keyed to design titles. */
function summarizeResults(results: ExperimentalResult[], designs: StrainDesign[]): string {
  const titles = new Map(designs.map((d) => [d.id, d.title]))
  const recorded = results.filter((r) => r.status === 'recorded')
  if (!recorded.length) return ''
  return recorded
    .slice(-20)
    .map((r) => {
      const delta =
        typeof r.measuredValue === 'number' && typeof r.baselineValue === 'number' && r.baselineValue !== 0
          ? ` (${r.measuredValue >= r.baselineValue ? '+' : ''}${Math.round(
              ((r.measuredValue - r.baselineValue) / r.baselineValue) * 100
            )}%)`
          : ''
      return `- ${titles.get(r.designId) ?? 'design'}: ${RESULT_OUTCOME_LABELS[r.outcome]}${delta} — ${r.observations}`
    })
    .join('\n')
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
    const top = [...designs].sort(compareDesigns).slice(0, 8)
    const reviewExcerpts = (snapshot?.reviews ?? [])
      .slice(-30)
      .map((r) => `[${r.type}/${r.verdict}] ${r.narrative}`)
    const matchPatterns = (snapshot?.matches ?? []).slice(-30).map((m) => m.rationale)
    const resultsSummary = summarizeResults(snapshot?.results ?? [], designs)
    const calNote = calibrationNote(this.ctx.store.latestCalibration(campaign.id))
    return this.llm(campaign, cycle, top, reviewExcerpts, matchPatterns, calNote, resultsSummary)
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
    // Map the area back to concrete designs. Preferred signal is an explicit
    // 1-based reference into the numbered TOP-RANKED DESIGNS list (deterministic);
    // we also accept titles (in either field) and match them fuzzily, so the
    // "related designs" highlights resolve reliably across regenerations rather
    // than depending on the model echoing a title verbatim.
    const ids = new Set<string>()
    const titleCandidates: string[] = Array.isArray(area.relatedDesignTitles)
      ? area.relatedDesignTitles.map(String)
      : []
    const refs = Array.isArray(area.relatedDesigns) ? area.relatedDesigns : []
    for (const r of refs) {
      const n = Number(r)
      if (Number.isFinite(n) && n >= 1 && n <= designs.length) {
        ids.add(designs[Math.trunc(n) - 1].id)
      } else if (typeof r === 'string') {
        titleCandidates.push(r)
      }
    }
    if (titleCandidates.length) {
      for (const d of designs) {
        if (titleCandidates.some((t) => titleMatches(d.title, t))) ids.add(d.id)
      }
    }
    return {
      title: String(area.title ?? 'Engineering area'),
      justification: String(area.justification ?? ''),
      exampleExperiments: Array.isArray(area.exampleExperiments)
        ? area.exampleExperiments.map(String)
        : [],
      relatedDesignIds: [...ids]
    }
  }

  private async llm(
    campaign: Campaign,
    cycle: number,
    top: StrainDesign[],
    reviewExcerpts: string[],
    matchPatterns: string[],
    calNote: string,
    resultsSummary: string
  ): Promise<MetaReview> {
    const res = await this.ctx.llm.complete({
      agent: 'meta-review',
      system: SYSTEM_PREAMBLE,
      prompt: metaReviewPrompt(campaign, top, reviewExcerpts, matchPatterns, calNote, resultsSummary),
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
