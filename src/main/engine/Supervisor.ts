import type {
  Campaign,
  DesignStatus,
  EvolutionStrategy,
  StrainDesign,
  SystemStatistics,
  AgentRole,
  ReviewType
} from '@shared/domain'
import type { EngineContext } from './context'
import { TaskQueue, type AgentTask } from './TaskQueue'
import { GenerationAgent } from './agents/GenerationAgent'
import { ReflectionAgent } from './agents/ReflectionAgent'
import { RankingAgent } from './agents/RankingAgent'
import { ProximityAgent } from './agents/ProximityAgent'
import { EvolutionAgent } from './agents/EvolutionAgent'
import { MetaReviewAgent } from './agents/MetaReviewAgent'
import { parseGoalPrompt, SYSTEM_PREAMBLE, type GenerationStrategy } from './prompts'
import { parseJsonLoose } from '../llm'

const GEN_STRATEGIES: GenerationStrategy[] = ['literature', 'debate', 'assumptions', 'expansion']
const EVO_STRATEGIES: EvolutionStrategy[] = [
  'grounding-enhancement',
  'feasibility',
  'combination',
  'inspiration',
  'simplification',
  'out-of-box'
]

/**
 * Supervisor agent. Parses the goal into a research-plan config, then runs the
 * asynchronous orchestration loop: each cycle it weights and schedules the
 * specialized agents (generation, reflection, ranking, proximity, evolution,
 * meta-review) as worker tasks, computes statistics, and decides terminal
 * state. State is checkpointed to context memory so runs survive restarts.
 */
export class Supervisor {
  private generation: GenerationAgent
  private reflection: ReflectionAgent
  private ranking: RankingAgent
  private proximity: ProximityAgent
  private evolution: EvolutionAgent
  private metaReview: MetaReviewAgent
  private queue: TaskQueue
  private bestEloByCycle: number[] = []

  constructor(
    private ctx: EngineContext,
    private campaignId: string
  ) {
    this.generation = new GenerationAgent(ctx)
    this.reflection = new ReflectionAgent(ctx)
    this.ranking = new RankingAgent(ctx)
    this.proximity = new ProximityAgent(ctx)
    this.evolution = new EvolutionAgent(ctx)
    this.metaReview = new MetaReviewAgent(ctx)
    this.queue = new TaskQueue(ctx, campaignId)
  }

  private get campaign(): Campaign | undefined {
    return this.ctx.store.getCampaign(this.campaignId)
  }

  cancel(): void {
    this.queue.cancel()
  }

  // -- Goal parsing ---------------------------------------------------------

  async parseGoal(campaign: Campaign): Promise<void> {
    this.ctx.log(campaign.id, 'supervisor', 'info', 'Parsing research goal into a plan configuration')
    try {
      const res = await this.ctx.llm.complete({
        agent: 'supervisor',
        system: SYSTEM_PREAMBLE,
        prompt: parseGoalPrompt(campaign),
        effort: 'medium',
        maxTokens: 2000
      })
      const parsed = parseJsonLoose<any>(res.text) ?? {}
      campaign.researchPlan = {
        restatedGoal: String(parsed.restatedGoal ?? campaign.goal),
        focusAreas: Array.isArray(parsed.focusAreas) ? parsed.focusAreas.map(String) : [],
        derivedConstraints: Array.isArray(parsed.derivedConstraints)
          ? parsed.derivedConstraints.map(String)
          : [],
        evaluationRubric: String(parsed.evaluationRubric ?? ''),
        recommendedChassis: String(parsed.recommendedChassis ?? ''),
        parsedAt: Date.now()
      }
    } catch (err) {
      this.ctx.log(
        campaign.id,
        'supervisor',
        'warning',
        `Goal parsing failed, using defaults: ${err instanceof Error ? err.message : String(err)}`
      )
      campaign.researchPlan = {
        restatedGoal: campaign.goal,
        focusAreas: [],
        derivedConstraints: [],
        evaluationRubric: '',
        parsedAt: Date.now()
      }
    }
    campaign.updatedAt = Date.now()
    this.ctx.store.upsertCampaign(campaign)
  }

  // -- Main loop ------------------------------------------------------------

  async run(): Promise<'completed' | 'paused' | 'stopped'> {
    this.queue.reset()
    const campaign = this.campaign
    if (!campaign) return 'stopped'

    if (!campaign.researchPlan) await this.parseGoal(campaign)

    let cycle = this.lastCycle()
    while (true) {
      const current = this.campaign
      if (!current || current.status === 'stopped') return 'stopped'
      if (current.status === 'paused') return 'paused'

      cycle += 1
      const tasks = await this.planCycle(current, cycle)
      if (tasks.length === 0) {
        // Nothing left to do → finalize.
        await this.finalize(current, cycle)
        return 'completed'
      }

      await this.queue.runBatch(tasks)

      // Re-check control after the batch (pause/stop may have arrived).
      const after = this.campaign
      if (!after || after.status === 'stopped') return 'stopped'
      if (after.status === 'paused') {
        this.recordStatistics(after, cycle)
        return 'paused'
      }

      this.recordStatistics(after, cycle)

      if (this.isTerminal(after, cycle)) {
        await this.finalize(after, cycle)
        return 'completed'
      }
    }
  }

  private lastCycle(): number {
    const stats = this.ctx.store.getSnapshot(this.campaignId)?.statistics ?? []
    return stats.length ? stats[stats.length - 1].cycle : 0
  }

  // -- Per-cycle planning ---------------------------------------------------

  private async planCycle(campaign: Campaign, cycle: number): Promise<AgentTask[]> {
    const tasks: AgentTask[] = []
    const designs = this.ctx.store.getDesigns(campaign.id)
    const feedback = this.metaFeedback()

    const drafts = designs.filter((d) => d.status === 'draft')
    const active = designs.filter((d) => d.status === 'active' || d.status === 'flagged')
    const nonRejected = designs.filter((d) => d.status !== 'rejected')

    // 0) First cycle (or empty): seed the initial generation.
    if (designs.length === 0) {
      const n = campaign.computeBudget.initialGeneration
      tasks.push({
        agent: 'generation',
        label: `Seed generation (${n} designs)`,
        cycle,
        run: async () => {
          const created = await this.generation.generate(campaign, 'literature', n, cycle, feedback?.generation)
          return created.map((d) => d.id)
        }
      })
      return tasks
    }

    // 1) Initial reviews for all drafts → promote or reject.
    for (const d of drafts) {
      tasks.push(this.reviewTask(campaign, d, 'initial', cycle, feedback?.reflection))
    }

    // 2) Deeper reviews for a rotating subset of active designs.
    const needsFull = active.filter((d) => d.reviewCount < 2).slice(0, 3)
    for (const d of needsFull) {
      tasks.push(this.reviewTask(campaign, d, 'full', cycle, feedback?.reflection))
    }
    if (cycle % 3 === 0) {
      const top = [...active].sort((a, b) => b.elo - a.elo).slice(0, 2)
      for (const d of top) {
        const types: ReviewType[] = ['deep-verification', 'simulation']
        tasks.push(this.reviewTask(campaign, d, types[cycle % 2], cycle, feedback?.reflection))
      }
    }

    // 3) Tournament matches among active designs.
    for (const [a, b, mode] of this.selectMatchPairs(active)) {
      tasks.push({
        agent: 'ranking',
        label: `${mode} match: ${truncate(a.title)} vs ${truncate(b.title)}`,
        cycle,
        run: async () => {
          await this.ranking.match(campaign, a, b, mode, cycle)
        }
      })
    }

    // 4) Proximity recluster every 2 cycles.
    if (active.length >= 2 && cycle % 2 === 0) {
      tasks.push({
        agent: 'proximity',
        label: 'Recompute proximity graph',
        cycle,
        run: async () => {
          this.proximity.recluster(campaign)
        }
      })
    }

    // 5) Evolution of top designs (adaptive: bias toward evolution if it wins).
    if (active.length >= 2 && cycle % 2 === 0) {
      const evoCount = this.evolutionWinRate(active) >= this.generationWinRate(active) ? 2 : 1
      const top = [...active].sort((a, b) => b.elo - a.elo)
      for (let i = 0; i < evoCount; i++) {
        const strat = EVO_STRATEGIES[(cycle + i) % EVO_STRATEGIES.length]
        const parents =
          strat === 'combination' && top.length >= 2 ? [top[0], top[1]] : [top[i % top.length]]
        tasks.push({
          agent: 'evolution',
          label: `Evolve top design (${strat})`,
          cycle,
          run: async () => {
            const child = await this.evolution.evolve(campaign, parents, strat, cycle, feedback?.evolution)
            return child ? [child.id] : []
          }
        })
      }
    }

    // 6) Generation expansion if under the design budget.
    if (nonRejected.length < campaign.computeBudget.targetDesigns && cycle % 3 === 0) {
      const strat = GEN_STRATEGIES[cycle % GEN_STRATEGIES.length]
      tasks.push({
        agent: 'generation',
        label: `Expand design space (${strat})`,
        cycle,
        run: async () => {
          const created = await this.generation.generate(campaign, strat, 3, cycle, feedback?.generation)
          return created.map((d) => d.id)
        }
      })
    }

    // 7) Construct augmentation for top designs lacking suggestions.
    const needConstructs = active
      .filter((d) => d.constructSuggestions.length === 0)
      .sort((a, b) => b.elo - a.elo)
      .slice(0, 1)
    for (const d of needConstructs) {
      tasks.push({
        agent: 'reflection',
        label: `Construct suggestions for ${truncate(d.title)}`,
        cycle,
        run: async () => {
          await this.augmentConstructs(campaign, d)
        }
      })
    }

    // 8) Meta-review every 4 cycles.
    if (cycle % 4 === 0 && active.length >= 2) {
      tasks.push({
        agent: 'meta-review',
        label: 'Synthesise meta-review feedback',
        cycle,
        run: async () => {
          await this.metaReview.synthesize(campaign, cycle)
        }
      })
    }

    return tasks
  }

  private reviewTask(
    campaign: Campaign,
    design: StrainDesign,
    type: ReviewType,
    cycle: number,
    feedback?: string
  ): AgentTask {
    return {
      agent: 'reflection',
      label: `${type} review: ${truncate(design.title)}`,
      cycle,
      run: async () => {
        const review = await this.reflection.review(campaign, design, type, feedback)
        if (type === 'initial') {
          const next: DesignStatus = review.verdict === 'reject' ? 'rejected' : 'active'
          design.status = next
          if (next === 'active' && design.eloHistory.length === 0) {
            design.eloHistory.push({ cycle, at: Date.now(), elo: design.elo })
          }
          this.ctx.upsertDesign(design)
        }
      }
    }
  }

  /** Pick tournament pairs: newest + top designs, paired with a proximity-close partner. */
  private selectMatchPairs(
    active: StrainDesign[]
  ): [StrainDesign, StrainDesign, 'debate' | 'single-turn'][] {
    if (active.length < 2) return []
    const pairs: [StrainDesign, StrainDesign, 'debate' | 'single-turn'][] = []
    const used = new Set<string>()
    const byElo = [...active].sort((a, b) => b.elo - a.elo)
    const byRecency = [...active].sort((a, b) => b.createdAt - a.createdAt)

    // A few top-vs-top debates.
    for (let i = 0; i + 1 < Math.min(4, byElo.length); i += 2) {
      pairs.push([byElo[i], byElo[i + 1], 'debate'])
    }
    // Newest designs get a proximity-close single-turn match to find their level.
    for (const d of byRecency.slice(0, 3)) {
      if (used.has(d.id)) continue
      const partner = this.proximity.closest(this.campaignAt(d.campaignId), d, new Set([d.id, ...used]))
      if (partner) {
        pairs.push([d, partner, 'single-turn'])
        used.add(d.id)
        used.add(partner.id)
      }
    }
    return pairs.slice(0, 6)
  }

  private campaignAt(id: string): Campaign {
    return this.ctx.store.getCampaign(id)!
  }

  private async augmentConstructs(campaign: Campaign, design: StrainDesign): Promise<void> {
    const target = design.interventions.flatMap((i) => i.targets)[0] ?? design.title
    if (!this.ctx.codexomics.available) {
      design.constructSuggestions = [
        {
          label: `Forward primer for ${target}`,
          detail: 'Anneal Tm ≈ 60°C; add 40 nt homology arms for recombineering.',
          source: 'model'
        },
        {
          label: `Reverse primer for ${target}`,
          detail: 'Pair with the forward primer to amplify the edit/cassette.',
          source: 'model'
        }
      ]
    } else {
      const primers = await this.ctx.codexomics.designPrimers(target)
      if (primers && primers.length) {
        design.constructSuggestions = primers.map((p) => ({
          label: p.label,
          detail: p.detail,
          sequence: p.sequence,
          source: 'codexomics'
        }))
      }
    }
    this.ctx.upsertDesign(design)
  }

  // -- Statistics & termination --------------------------------------------

  private metaFeedback(): Partial<Record<AgentRole, string>> | undefined {
    return this.ctx.store.latestMetaReview(this.campaignId)?.agentFeedback
  }

  private winRateForOrigin(active: StrainDesign[], origin: StrainDesign['origin']): number {
    const group = active.filter((d) => d.origin === origin)
    const games = group.reduce((s, d) => s + d.wins + d.losses, 0)
    const wins = group.reduce((s, d) => s + d.wins, 0)
    return games === 0 ? 0 : wins / games
  }

  private generationWinRate(active: StrainDesign[]): number {
    return this.winRateForOrigin(active, 'generated')
  }

  private evolutionWinRate(active: StrainDesign[]): number {
    return this.winRateForOrigin(active, 'evolved')
  }

  private recordStatistics(campaign: Campaign, cycle: number): SystemStatistics {
    const designs = this.ctx.store.getDesigns(campaign.id)
    const snapshot = this.ctx.store.getSnapshot(campaign.id)
    const active = designs.filter((d) => d.status === 'active' || d.status === 'flagged')
    const sortedElo = [...active].sort((a, b) => b.elo - a.elo)
    const top10 = sortedElo.slice(0, 10)
    const topEloAvg10 = top10.length
      ? Math.round(top10.reduce((s, d) => s + d.elo, 0) / top10.length)
      : 1200
    const bestElo = sortedElo.length ? sortedElo[0].elo : 1200

    const byStatus = {
      draft: 0,
      reviewing: 0,
      active: 0,
      rejected: 0,
      flagged: 0
    } as Record<DesignStatus, number>
    for (const d of designs) byStatus[d.status] = (byStatus[d.status] ?? 0) + 1

    const tasks = snapshot?.tasks ?? []
    const agentWeights: Partial<Record<AgentRole, number>> = {}
    for (const t of tasks) agentWeights[t.agent] = (agentWeights[t.agent] ?? 0) + 1

    this.bestEloByCycle[cycle] = bestElo

    const stats: SystemStatistics = {
      campaignId: campaign.id,
      cycle,
      at: Date.now(),
      designsTotal: designs.length,
      designsByStatus: byStatus,
      reviewsTotal: snapshot?.reviews.length ?? 0,
      matchesTotal: snapshot?.matches.length ?? 0,
      topEloAvg10,
      bestElo,
      queueDepth: this.queue.queueDepth,
      agentWeights,
      generationWinRate: round2(this.generationWinRate(active)),
      evolutionWinRate: round2(this.evolutionWinRate(active)),
      terminalProgress: this.terminalProgress(campaign, cycle)
    }
    this.ctx.addStatistics(stats)
    return stats
  }

  private terminalProgress(campaign: Campaign, cycle: number): number {
    const cycleP = cycle / campaign.computeBudget.maxCycles
    const designs = this.ctx.store.getDesigns(campaign.id).filter((d) => d.status !== 'rejected')
    const designP = designs.length / campaign.computeBudget.targetDesigns
    return Math.min(1, Math.max(cycleP, designP * 0.9))
  }

  private isTerminal(campaign: Campaign, cycle: number): boolean {
    if (cycle >= campaign.computeBudget.maxCycles) return true
    const designs = this.ctx.store.getDesigns(campaign.id)
    const nonRejected = designs.filter((d) => d.status !== 'rejected')
    const active = designs.filter((d) => d.status === 'active' || d.status === 'flagged')
    const drafts = designs.filter((d) => d.status === 'draft')

    // Reached the design budget and Elo has plateaued, with no pending drafts.
    if (nonRejected.length >= campaign.computeBudget.targetDesigns && drafts.length === 0 && active.length >= 2) {
      const recent = this.bestEloByCycle.slice(Math.max(0, cycle - 3), cycle + 1).filter((x) => x != null)
      if (recent.length >= 3) {
        const spread = Math.max(...recent) - Math.min(...recent)
        if (spread < 12) return true
      }
    }
    return false
  }

  private async finalize(campaign: Campaign, cycle: number): Promise<void> {
    // Always produce a final meta-review / research overview.
    const active = this.ctx.store.getDesigns(campaign.id).filter((d) => d.status !== 'rejected')
    if (active.length >= 1) {
      try {
        await this.metaReview.synthesize(campaign, cycle)
      } catch (err) {
        this.ctx.log(campaign.id, 'meta-review', 'warning', `Final meta-review failed: ${String(err)}`)
      }
    }
    this.recordStatistics(campaign, cycle)
    this.ctx.log(campaign.id, 'supervisor', 'success', `Campaign reached terminal state after ${cycle} cycles`)
  }
}

function truncate(s: string, n = 40): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
