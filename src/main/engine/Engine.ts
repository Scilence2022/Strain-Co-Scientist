import { genId } from '../util/id'
import type {
  AppSettings,
  Campaign,
  CampaignSnapshot,
  CampaignStatus,
  ExperimentalResult,
  LLMProvider,
  Review,
  StrainDesign
} from '@shared/domain'
import { DEFAULT_TOURNAMENT_CONFIG, evidenceGradeFor, type TournamentConfig } from '@shared/domain'
import { hostDisplayName } from '@shared/hosts'
import type {
  CreateCampaignInput,
  EngineEvent,
  ExpertDesignInput,
  ExpertReviewInput,
  McpTestResult,
  ModelListResult,
  RecordResultInput
} from '@shared/ipc'
import { computeCalibration } from './learn/Calibration'
import { getProvider } from '@shared/providers'
import { Store } from '../memory/Store'
import { createLLMClient, listModels, type LLMClient } from '../llm'
import { McpManager } from '../mcp/McpManager'
import { DeepResearchClient } from '../mcp/DeepResearchClient'
import { CodexomicsClient } from '../mcp/CodexomicsClient'
import { EngineContext } from './context'
import { Supervisor } from './Supervisor'
import { MetaReviewAgent, isEmptyOverview } from './agents/MetaReviewAgent'
import { decideMatch, INITIAL_ELO, updateElo, weightedTotal } from './tournament/Elo'

/**
 * Top-level engine. Owns the context-memory store, settings, the MCP manager,
 * and the live LLM client, and manages the lifecycle of every campaign's
 * Supervisor. The single entry point the IPC layer talks to.
 */
export class Engine {
  private store: Store
  private mcp: McpManager
  private llm: LLMClient
  private ctx: EngineContext
  private running = new Map<string, { supervisor: Supervisor; done: Promise<void> }>()
  private closing = false
  private deleting = new Set<string>()
  private lifecycleVersions = new Map<string, number>()

  constructor(
    private emit: (event: EngineEvent) => void,
    storeRootOverride?: string
  ) {
    this.store = new Store(storeRootOverride)
    const settings = this.store.getSettings()
    this.mcp = new McpManager(settings.mcp.deepResearch, settings.mcp.codexomics)
    this.llm = createLLMClient(settings)
    this.ctx = this.buildContext(settings)
  }

  private buildContext(settings: AppSettings): EngineContext {
    return new EngineContext(
      this.store,
      this.llm,
      new DeepResearchClient(this.mcp.deepResearch),
      new CodexomicsClient(this.mcp.codexomics),
      settings,
      this.emit
    )
  }

  // -- Settings -------------------------------------------------------------

  getSettings(): AppSettings {
    return this.store.getSettings()
  }

  async saveSettings(settings: AppSettings): Promise<AppSettings> {
    const saved = await this.store.saveSettings(settings)
    this.mcp.update(saved.mcp.deepResearch, saved.mcp.codexomics)
    this.llm = createLLMClient(saved)
    this.ctx = this.buildContext(saved)
    return saved
  }

  async testMcp(server: 'deepResearch' | 'codexomics'): Promise<McpTestResult> {
    const settings = this.store.getSettings()
    this.mcp.update(settings.mcp.deepResearch, settings.mcp.codexomics)
    const conn = server === 'deepResearch' ? this.mcp.deepResearch : this.mcp.codexomics
    const res = await conn.test()
    return { server, ok: res.ok, message: res.message, toolCount: res.toolCount, tools: res.tools }
  }

  async pingLlm(): Promise<{ ok: boolean; message: string; model?: string }> {
    try {
      // Re-create the client so we always ping with the latest saved settings.
      const fresh = createLLMClient(this.store.getSettings())
      const reply = await fresh.ping()
      return { ok: true, message: reply || 'ready', model: this.store.getSettings().llm.tiers.fastTier.model }
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err)
      }
    }
  }

  /** Refresh a provider's available models using its saved credentials. */
  async listProviderModels(provider: LLMProvider): Promise<ModelListResult> {
    const settings = this.store.getSettings()
    const account = settings.llm.providers[provider]
    const def = getProvider(provider)
    const baseUrl = account?.baseUrl?.trim() || def?.baseUrl || ''
    return listModels(provider, account?.apiKey ?? '', baseUrl)
  }

  // -- Campaign CRUD --------------------------------------------------------

  listCampaigns(): Campaign[] {
    return this.store.listCampaigns()
  }

  getSnapshot(campaignId: string): CampaignSnapshot | null {
    return this.store.getSnapshot(campaignId)
  }

  createCampaign(input: CreateCampaignInput): Campaign {
    const now = Date.now()
    const campaign: Campaign = {
      ...input,
      id: genId(12),
      createdAt: now,
      updatedAt: now,
      status: 'draft',
      tournamentConfig: input.tournamentConfig ?? DEFAULT_TOURNAMENT_CONFIG
    }
    if (!campaign.title.trim()) {
      campaign.title = `${campaign.productTarget} — ${hostDisplayName(campaign.host.preset, campaign.host.customName)}`
    }
    this.store.upsertCampaign(campaign)
    this.emit({ kind: 'campaign-upsert', campaignId: campaign.id, campaign })
    this.ctx.log(campaign.id, 'system', 'info', 'Campaign created')
    return campaign
  }

  async deleteCampaign(id: string): Promise<void> {
    this.deleting.add(id)
    try {
      await this.stopCampaign(id)
      await this.store.deleteCampaign(id)
    } finally {
      this.deleting.delete(id)
    }
  }

  // -- Lifecycle ------------------------------------------------------------

  private setStatus(id: string, status: CampaignStatus): void {
    const campaign = this.store.getCampaign(id)
    if (!campaign) return
    campaign.status = status
    campaign.updatedAt = Date.now()
    this.store.upsertCampaign(campaign)
    this.emit({ kind: 'campaign-upsert', campaignId: id, campaign })
  }

  async startCampaign(id: string): Promise<void> {
    if (this.closing) throw new Error('The application is shutting down')
    if (this.deleting.has(id)) return
    const version = (this.lifecycleVersions.get(id) ?? 0) + 1
    this.lifecycleVersions.set(id, version)
    const previous = this.running.get(id)
    if (previous) {
      if (this.store.getCampaign(id)?.status === 'running') return
      // Pause/stop may still be draining their last task. Resume only after
      // that worker has left, so immediate clicks neither vanish nor overlap.
      await previous.done
    }
    if (this.closing || this.deleting.has(id) || this.lifecycleVersions.get(id) !== version || !this.store.getCampaign(id) || this.running.has(id)) return
    this.setStatus(id, 'running')
    const supervisor = new Supervisor(this.ctx, id)
    const done = Promise.resolve().then(() => this.launch(id, supervisor))
    this.running.set(id, { supervisor, done })
  }

  async resumeCampaign(id: string): Promise<void> {
    await this.startCampaign(id)
  }

  async pauseCampaign(id: string): Promise<void> {
    this.lifecycleVersions.set(id, (this.lifecycleVersions.get(id) ?? 0) + 1)
    if (!this.running.has(id)) return
    this.setStatus(id, 'paused')
    this.running.get(id)?.supervisor.cancel()
    await this.running.get(id)?.done
  }

  async stopCampaign(id: string): Promise<void> {
    this.lifecycleVersions.set(id, (this.lifecycleVersions.get(id) ?? 0) + 1)
    const sup = this.running.get(id)
    this.setStatus(id, 'stopped')
    sup?.supervisor.cancel()
    await sup?.done
  }

  private async launch(id: string, supervisor: Supervisor): Promise<void> {
    const ctx = this.ctx // capture current context for this run
    try {
      const result = await supervisor.run()
      if (this.store.getCampaign(id)?.status === 'running') {
        if (result === 'completed') this.setStatus(id, 'completed')
        else if (result === 'stopped') this.setStatus(id, 'stopped')
      }
    } catch (err) {
      if (this.store.getCampaign(id)?.status === 'running') {
        ctx.log(id, 'system', 'error', `Engine error: ${err instanceof Error ? err.message : String(err)}`)
        this.setStatus(id, 'error')
      }
    } finally {
      try {
        await this.store.flush()
      } catch (err) {
        ctx.log(id, 'system', 'error', `Could not save campaign: ${String(err)}`)
        this.setStatus(id, 'error')
      } finally {
        this.running.delete(id)
      }
    }
  }

  // -- Research overview ----------------------------------------------------

  /**
   * Manually (re)synthesise the research overview for a campaign. Used when the
   * automatic end-of-run meta-review didn't produce usable content (e.g. an LLM
   * parse failure). Only persists a result that actually contains an overview,
   * so a failed retry never overwrites a good one with a blank card.
   */
  async regenerateOverview(id: string): Promise<{ ok: boolean; message: string }> {
    const campaign = this.store.getCampaign(id)
    if (!campaign) return { ok: false, message: 'Campaign not found' }
    const snapshot = this.store.getSnapshot(id)
    const designs = (snapshot?.designs ?? []).filter((d) => d.status !== 'rejected')
    if (designs.length === 0) {
      return { ok: false, message: 'No designs to synthesise an overview from yet.' }
    }
    const stats = snapshot?.statistics ?? []
    const cycle = stats.length ? stats[stats.length - 1].cycle : 0
    try {
      const meta = await new MetaReviewAgent(this.ctx).generate(campaign, cycle)
      if (isEmptyOverview(meta)) {
        this.ctx.log(id, 'meta-review', 'warning', 'Manual overview generation returned no usable content')
        return {
          ok: false,
          message:
            "The model's response couldn't be parsed into a roadmap — it was likely truncated or malformed. Try again; see the Activity log for the stop reason."
        }
      }
      this.ctx.addMetaReview(meta)
      this.ctx.log(
        id,
        'meta-review',
        'success',
        `Research overview generated on request: ${meta.overview.areas.length} roadmap areas`
      )
      return { ok: true, message: `Generated ${meta.overview.areas.length} roadmap areas.` }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.ctx.log(id, 'meta-review', 'error', `Manual overview generation failed: ${message}`)
      return { ok: false, message }
    }
  }

  // -- Tournament configuration ---------------------------------------------

  /**
   * Update a campaign's tournament scoring config and replay the Elo ladder
   * under the new weights. Because every match persists per-criterion judge
   * sub-scores, re-ranking is a deterministic recomputation — no LLM matches
   * are re-run. Designs that lack stored sub-scores (legacy matches) keep their
   * recorded winner.
   */
  async updateTournamentConfig(id: string, config: TournamentConfig): Promise<Campaign> {
    const campaign = this.store.getCampaign(id)
    if (!campaign) throw new Error('campaign not found')
    campaign.tournamentConfig = config
    campaign.updatedAt = Date.now()
    this.store.upsertCampaign(campaign)
    this.replayElo(id, config)
    this.ctx.log(
      id,
      'ranking',
      'info',
      'Tournament weights updated — Elo ladder replayed from stored match scores'
    )
    this.emit({ kind: 'campaign-upsert', campaignId: id, campaign })
    await this.store.flush()
    return campaign
  }

  /** Recompute every design's Elo from the stored matches under `config`. */
  private replayElo(id: string, config: TournamentConfig): void {
    const designs = this.store.getDesigns(id)
    const matches = [...this.store.getMatches(id)].sort((a, b) => a.createdAt - b.createdAt)
    const byId = new Map(designs.map((d) => [d.id, d]))

    for (const d of designs) {
      d.elo = INITIAL_ELO
      d.wins = 0
      d.losses = 0
      d.eloHistory = [{ cycle: 0, at: d.createdAt, elo: INITIAL_ELO }]
    }

    for (const m of matches) {
      const a = byId.get(m.designAId)
      const b = byId.get(m.designBId)
      if (!a || !b) continue // a participant was deleted; skip

      let scoreA: number
      if (m.scoresA && m.scoresB) {
        const tA = weightedTotal(m.scoresA, config.weights)
        const tB = weightedTotal(m.scoresB, config.weights)
        m.weightedTotalA = Math.round(tA * 10) / 10
        m.weightedTotalB = Math.round(tB * 10) / 10
        scoreA = decideMatch(tA, tB, a.elo, b.elo, config.tieHandling)
      } else {
        // Legacy match without sub-scores: preserve the recorded outcome.
        scoreA = m.winnerId === null ? 0.5 : m.winnerId === a.id ? 1 : 0
      }

      const { newA, newB, delta } = updateElo(a.elo, b.elo, scoreA, config.kFactor)
      a.elo = newA
      b.elo = newB
      a.eloHistory.push({ cycle: m.cycle, at: m.createdAt, elo: newA })
      b.eloHistory.push({ cycle: m.cycle, at: m.createdAt, elo: newB })
      if (scoreA === 1) {
        a.wins += 1
        b.losses += 1
      } else if (scoreA === 0) {
        b.wins += 1
        a.losses += 1
      }
      m.winnerId = scoreA === 0.5 ? null : scoreA === 1 ? a.id : b.id
      m.eloDelta = delta
      this.emit({ kind: 'match-added', campaignId: id, match: m })
    }

    // Persist + push live updates (design-upsert dedupes; matches refresh via snapshot).
    for (const d of designs) {
      this.store.upsertDesign(d)
      this.emit({ kind: 'design-upsert', campaignId: id, design: d })
    }
  }

  // -- Expert-in-the-loop ---------------------------------------------------

  refineGoal(id: string, addendum: string): Campaign {
    const campaign = this.store.getCampaign(id)
    if (!campaign) throw new Error('campaign not found')
    campaign.goal = `${campaign.goal}\n\n[Refinement ${new Date().toISOString()}]\n${addendum}`
    campaign.researchPlan = undefined // re-parse on next run
    campaign.updatedAt = Date.now()
    this.store.upsertCampaign(campaign)
    this.ctx.log(id, 'expert', 'info', 'Scientist refined the research goal')
    this.emit({ kind: 'campaign-upsert', campaignId: id, campaign })
    return campaign
  }

  submitExpertDesign(input: ExpertDesignInput): StrainDesign {
    const campaign = this.store.getCampaign(input.campaignId)
    if (!campaign) throw new Error('campaign not found')
    const now = Date.now()
    const design: StrainDesign = {
      id: genId(12),
      campaignId: input.campaignId,
      createdAt: now,
      updatedAt: now,
      title: input.title,
      summary: input.summary,
      chassis: input.chassis || hostDisplayName(campaign.host.preset, campaign.host.customName),
      interventions: input.interventions,
      mechanism: input.mechanism,
      predictedEffect: input.predictedEffect,
      experimentalPlan: [],
      constructSuggestions: [],
      risks: [],
      citations: [],
      novelty: 5,
      origin: 'expert',
      status: 'active', // expert designs enter the tournament directly
      lineage: { parentIds: [] },
      elo: INITIAL_ELO,
      eloHistory: [{ cycle: 0, at: now, elo: INITIAL_ELO }],
      wins: 0,
      losses: 0,
      reviewCount: 0
    }
    this.ctx.upsertDesign(design)
    this.ctx.log(input.campaignId, 'expert', 'success', `Scientist contributed a design: "${design.title}"`)
    return design
  }

  submitExpertReview(input: ExpertReviewInput): Review {
    const design = this.store.getDesign(input.campaignId, input.designId)
    if (!design) throw new Error('design not found')
    const review: Review = {
      id: genId(12),
      designId: input.designId,
      campaignId: input.campaignId,
      type: 'expert',
      createdAt: Date.now(),
      scores: input.scores,
      verdict: input.verdict,
      narrative: input.narrative,
      evidence: [],
      author: input.author || 'Scientist'
    }
    this.ctx.addReview(review)
    design.reviewCount += 1
    if (design.status === 'draft' && input.verdict !== 'reject') design.status = 'active'
    if (input.verdict === 'reject') design.status = 'rejected'
    this.ctx.upsertDesign(design)
    this.ctx.log(input.campaignId, 'expert', 'info', `Scientist reviewed "${design.title}" → ${input.verdict}`)
    return review
  }

  flagDesign(designId: string, flagged: boolean): StrainDesign {
    const design = this.findDesign(designId)
    if (!design) throw new Error('design not found')
    if (design.status === 'rejected' || design.status === 'draft') throw new Error('Only reviewed, active designs can be flagged')
    design.status = flagged ? 'flagged' : 'active'
    this.ctx.upsertDesign(design)
    this.ctx.log(design.campaignId, 'expert', 'info', `${flagged ? 'Flagged' : 'Unflagged'} "${design.title}" for wet-lab`)
    return design
  }

  // -- Experimental-results feedback loop (DBTL "Learn") --------------------

  /**
   * Record a wet-lab result against a design. This is the ground-truth signal
   * that closes the DBTL loop: it re-derives the design's authoritative evidence
   * grade (so it re-ranks against purely-predicted designs) and recomputes the
   * campaign's prediction calibration. If the campaign has already terminated,
   * the result is still recorded and the scientist is prompted to re-open.
   */
  async recordExperimentalResult(input: RecordResultInput): Promise<ExperimentalResult> {
    const campaign = this.store.getCampaign(input.campaignId)
    if (!campaign) throw new Error('campaign not found')
    const design = this.store.getDesign(input.campaignId, input.designId)
    if (!design) throw new Error('design not found')

    const result: ExperimentalResult = {
      id: genId(12),
      campaignId: input.campaignId,
      designId: input.designId,
      createdAt: Date.now(),
      outcome: input.outcome,
      metric: input.metric,
      measuredValue: input.measuredValue,
      baselineValue: input.baselineValue,
      unit: input.unit,
      replicates: input.replicates,
      observations: input.observations,
      author: input.author?.trim() || 'Scientist',
      status: 'recorded'
    }
    this.ctx.addResult(result)
    this.refreshEvidence(input.campaignId, input.designId)
    this.recomputeCalibration(input.campaignId)
    this.ctx.log(
      input.campaignId,
      'expert',
      result.outcome === 'refuted' || result.outcome === 'build-failed' ? 'warning' : 'success',
      `Experimental result for "${design.title}": ${result.outcome} → evidence "${design.evidence}"`,
      { designId: design.id, resultId: result.id, outcome: result.outcome }
    )
    if (campaign.status === 'completed' || campaign.status === 'stopped' || campaign.status === 'error') {
      this.ctx.log(
        input.campaignId,
        'system',
        'info',
        'New experimental data recorded on a terminated campaign — re-open it to let the agents act on the results.'
      )
    }
    await this.store.flush()
    return result
  }

  /** Mark a result disputed (drops it from the authoritative grade) or restore it. */
  async disputeResult(campaignId: string, resultId: string, disputed: boolean): Promise<ExperimentalResult> {
    const result = this.store.getResult(campaignId, resultId)
    if (!result) throw new Error('result not found')
    result.status = disputed ? 'disputed' : 'recorded'
    result.updatedAt = Date.now()
    this.ctx.updateResult(result)
    this.refreshEvidence(campaignId, result.designId)
    this.recomputeCalibration(campaignId)
    this.ctx.log(
      campaignId,
      'expert',
      'info',
      `${disputed ? 'Disputed' : 'Restored'} an experimental result`,
      { designId: result.designId, resultId }
    )
    await this.store.flush()
    return result
  }

  /** Re-open a terminated campaign so the Supervisor runs a results-informed cycle. */
  async reopenCampaign(id: string): Promise<void> {
    const campaign = this.store.getCampaign(id)
    if (!campaign || campaign.status === 'running') return
    this.ctx.log(id, 'supervisor', 'info', 'Campaign re-opened to act on new experimental data')
    await this.startCampaign(id)
  }

  /** Re-derive and cache a design's evidence grade from its results. */
  private refreshEvidence(campaignId: string, designId: string): void {
    const design = this.store.getDesign(campaignId, designId)
    if (!design) return
    design.evidence = evidenceGradeFor(this.store.getResultsForDesign(campaignId, designId))
    this.ctx.upsertDesign(design)
  }

  /** Recompute the campaign's prediction-calibration profile from current data. */
  private recomputeCalibration(campaignId: string): void {
    const designs = this.store.getDesigns(campaignId)
    const results = this.store.getResults(campaignId)
    const stats = this.store.getSnapshot(campaignId)?.statistics ?? []
    const cycle = stats.length ? stats[stats.length - 1].cycle : 0
    const at = Date.now()
    const profile = computeCalibration(campaignId, cycle, at, designs, results) ?? {
      campaignId, cycle, at, nPairs: 0, signedBias: 0, meanAbsError: 0, spearman: 0, biasByInterventionType: {}
    }
    this.ctx.addCalibration(profile)
  }

  private findDesign(designId: string): StrainDesign | undefined {
    for (const c of this.store.listCampaigns()) {
      const d = this.store.getDesign(c.id, designId)
      if (d) return d
    }
    return undefined
  }

  async shutdown(): Promise<void> {
    this.closing = true
    const runs = [...this.running.entries()]
    for (const [id, run] of runs) {
      if (this.store.getCampaign(id)?.status === 'running') this.setStatus(id, 'paused')
      run.supervisor.cancel()
    }
    await Promise.all(runs.map(([, run]) => run.done))
    await this.mcp.close()
    await this.store.flush()
  }
}
