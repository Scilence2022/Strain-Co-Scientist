/**
 * Domain model for Strain Co-Scientist.
 *
 * Adapts the Co-Scientist architecture (Gottweis et al., Nature 2026) from
 * biomedical hypothesis generation to the rational engineering of industrial
 * strains. A "research goal" becomes a strain-engineering Campaign; a
 * "hypothesis" becomes a StrainDesign (a concrete engineering strategy).
 *
 * These types are shared verbatim between the Electron main process (engine +
 * persistence) and the renderer (UI), so they are intentionally free of any
 * runtime dependency.
 */

// ---------------------------------------------------------------------------
// Hosts / chassis
// ---------------------------------------------------------------------------

/** Built-in chassis presets plus escape hatches for custom / host-agnostic. */
export type HostPresetId =
  | 'ecoli'
  | 'scerevisiae'
  | 'cglutamicum'
  | 'bsubtilis'
  | 'pputida'
  | 'ppastoris'
  | 'custom'
  | 'agnostic'

export interface HostPreset {
  id: HostPresetId
  /** Display name, e.g. "Escherichia coli". */
  name: string
  /** Short common name, e.g. "E. coli". */
  shortName: string
  /** Gram stain / domain note used to steer design idioms. */
  lineage: string
  /** Strengths the chassis is conventionally used for. */
  strengths: string
  /** Genetic-engineering idioms the agents should prefer for this host. */
  toolingNotes: string
}

/** The host context attached to a campaign. */
export interface HostContext {
  preset: HostPresetId
  /** Free-text organism name when preset === 'custom'. */
  customName?: string
  /** Strain background, e.g. "BL21(DE3)", "CEN.PK113-7D". */
  strainBackground?: string
  /** Any extra host context the scientist wants the agents to honour. */
  notes?: string
}

// ---------------------------------------------------------------------------
// Campaign (= research goal + research-plan configuration)
// ---------------------------------------------------------------------------

export type EngineeringObjective =
  | 'increase-titer'
  | 'increase-rate'
  | 'increase-yield'
  | 'broaden-substrate'
  | 'improve-tolerance'
  | 'reduce-byproduct'
  | 'improve-stability'
  | 'other'

export const OBJECTIVE_LABELS: Record<EngineeringObjective, string> = {
  'increase-titer': 'Increase titer',
  'increase-rate': 'Increase rate',
  'increase-yield': 'Increase yield',
  'broaden-substrate': 'Broaden substrate scope',
  'improve-tolerance': 'Improve tolerance',
  'reduce-byproduct': 'Reduce byproduct',
  'improve-stability': 'Improve genetic stability',
  other: 'Other'
}

export type BiosafetyLevel = 'BSL-1' | 'BSL-2' | 'unspecified'

/**
 * The evaluation criteria, adapted from the paper's defaults (alignment,
 * plausibility, novelty, testability, safety) to strain engineering, plus an
 * explicit `effectiveness` axis (how much the modification target is expected
 * to move the desired phenotype — distinct from feasibility/plausibility).
 *
 * These doubly serve as the per-campaign tournament judge weights: the Ranking
 * agent scores both designs in a match on each criterion and the higher
 * weighted total wins. See {@link TournamentConfig}.
 */
export interface CriteriaWeights {
  alignment: number
  effectiveness: number // predicted impact of the target on titer/rate/yield
  plausibility: number // metabolic / thermodynamic feasibility
  novelty: number
  testability: number // genetic tractability + assay availability
  hostCompatibility: number // burden, toxicity, genetic stability
  safety: number // biosafety / dual-use
}

/**
 * Default judge weights. `effectiveness` dominates (3×) because for a production
 * strain the impact of the modification target usually matters more than
 * novelty; every weight is tunable per campaign.
 */
export const DEFAULT_CRITERIA_WEIGHTS: CriteriaWeights = {
  alignment: 1,
  effectiveness: 3,
  plausibility: 1,
  novelty: 1,
  testability: 1,
  hostCompatibility: 1,
  safety: 1
}

export const CRITERIA_KEYS = [
  'alignment',
  'effectiveness',
  'plausibility',
  'novelty',
  'testability',
  'hostCompatibility',
  'safety'
] as const
export type CriterionKey = (typeof CRITERIA_KEYS)[number]

export const CRITERION_LABELS: Record<CriterionKey, string> = {
  alignment: 'Alignment',
  effectiveness: 'Effectiveness',
  plausibility: 'Plausibility',
  novelty: 'Novelty',
  testability: 'Testability',
  hostCompatibility: 'Host compatibility',
  safety: 'Safety'
}

export type CampaignStatus = 'draft' | 'running' | 'paused' | 'completed' | 'stopped' | 'error'

/** How aggressively to spend test-time compute (number of cycles + breadth). */
export interface ComputeBudget {
  /** Target number of distinct designs to generate before convergence. */
  targetDesigns: number
  /** Maximum supervisor cycles before forced termination. */
  maxCycles: number
  /** Designs to seed in the first generation pass. */
  initialGeneration: number
}

export const DEFAULT_COMPUTE_BUDGET: ComputeBudget = {
  targetDesigns: 24,
  maxCycles: 30,
  initialGeneration: 6
}

/**
 * Per-campaign tournament configuration. The Ranking agent scores BOTH designs
 * in a match across the weighted criteria; the winner is the higher weighted
 * total, so raising a criterion's weight makes the tournament — and therefore
 * the final ranking the scientist sees — prioritise that dimension.
 *
 * Weights are editable mid-campaign: re-weighting replays the Elo ladder from
 * the per-match sub-scores stored on each {@link Match}, with no LLM matches
 * re-run.
 */
export interface TournamentConfig {
  /** Per-criterion judge weights (0 = ignore this dimension entirely). */
  weights: CriteriaWeights
  /** Top-vs-top multi-turn debate matches scheduled per cycle. */
  topDebates: number
  /** Single-turn matches for the newest designs per cycle. */
  singleTurnMatches: number
  /** Hard cap on matches scheduled in a single cycle. */
  maxPairsPerCycle: number
  /** Present designs to the judge in randomised A/B order to cancel position bias. */
  randomizeOrder: boolean
  /** How to resolve an exact weighted-total tie. */
  tieHandling: 'higher-elo' | 'draw'
  /** Elo K-factor (rating volatility per match). */
  kFactor: number
}

export const DEFAULT_TOURNAMENT_CONFIG: TournamentConfig = {
  weights: { ...DEFAULT_CRITERIA_WEIGHTS },
  topDebates: 2,
  singleTurnMatches: 3,
  maxPairsPerCycle: 6,
  randomizeOrder: true,
  tieHandling: 'higher-elo',
  kFactor: 32
}

export interface Campaign {
  id: string
  createdAt: number
  updatedAt: number
  status: CampaignStatus

  /** The product / phenotype the scientist wants to engineer toward. */
  productTarget: string
  /** One-line title shown in lists. */
  title: string
  host: HostContext
  objective: EngineeringObjective
  /** Full natural-language goal (may be long; mirrors the paper's free-form goal). */
  goal: string

  /** Constraints the agents must honour. */
  constraints: {
    availableTools: string[] // e.g. ["CRISPR-Cas9", "lambda-Red", "plasmid overexpression"]
    forbiddenInterventions: string[]
    biosafety: BiosafetyLevel
    regulatoryNotes?: string
    onlyNovel: boolean // mirrors "exclusively propose novel hypotheses"
  }

  preferences: string // free-text desirable attributes
  tournamentConfig: TournamentConfig
  computeBudget: ComputeBudget

  /** Derived by the Supervisor at parse time (research-plan configuration). */
  researchPlan?: ResearchPlanConfig
}

/**
 * The Supervisor parses the goal into this structured plan, mirroring the
 * paper's "research plan configuration".
 */
export interface ResearchPlanConfig {
  restatedGoal: string
  focusAreas: string[]
  derivedConstraints: string[]
  evaluationRubric: string
  recommendedChassis?: string // populated for host-agnostic campaigns
  parsedAt: number
}

// ---------------------------------------------------------------------------
// StrainDesign (= hypothesis / research proposal)
// ---------------------------------------------------------------------------

export type InterventionType =
  | 'knockout'
  | 'overexpression'
  | 'knockdown'
  | 'promoter-swap'
  | 'rbs-tuning'
  | 'heterologous-pathway'
  | 'transporter-engineering'
  | 'cofactor-balancing'
  | 'dynamic-regulation'
  | 'enzyme-engineering'
  | 'other'

export const INTERVENTION_LABELS: Record<InterventionType, string> = {
  knockout: 'Knockout',
  overexpression: 'Overexpression',
  knockdown: 'Knockdown',
  'promoter-swap': 'Promoter swap',
  'rbs-tuning': 'RBS tuning',
  'heterologous-pathway': 'Heterologous pathway',
  'transporter-engineering': 'Transporter engineering',
  'cofactor-balancing': 'Cofactor balancing',
  'dynamic-regulation': 'Dynamic regulation',
  'enzyme-engineering': 'Enzyme engineering',
  other: 'Other'
}

export interface Intervention {
  type: InterventionType
  /** Target gene(s)/operon(s); free-text, e.g. "ldhA", "MVA pathway (mvaE,mvaS)". */
  targets: string[]
  /** What is done and why, at the molecular level. */
  details: string
}

/** A single Design→Build→Test→Learn step (from Robin's DBTL loop). */
export interface DBTLStep {
  phase: 'design' | 'build' | 'test' | 'learn'
  description: string
}

/**
 * A structured, comparable prediction the design commits to, so a measured
 * outcome can be scored against it (prediction calibration). Authored by the
 * Generation/Evolution agents alongside the free-text `predictedEffect`; fully
 * optional so a parse miss never blocks design creation.
 */
export interface QuantPrediction {
  /** Which phenotype the prediction is about. */
  metric: 'titer' | 'rate' | 'yield' | 'tolerance' | 'other'
  /** Direction of the expected change vs the unmodified baseline. */
  direction: 'increase' | 'decrease'
  /** Predicted relative change vs baseline as a fraction, e.g. 0.3 = ±30%. */
  relativeChange?: number
  /** 0-1 self-assessed confidence in the prediction (used for Brier calibration). */
  confidence?: number
  /** What the change is measured against, e.g. "wild-type BL21 in shake flask". */
  baselineNote?: string
}

export interface ConstructSuggestion {
  label: string // e.g. "Forward primer for ldhA deletion cassette"
  detail: string
  /** Sequence if CodeXomics produced one. */
  sequence?: string
  source: 'codexomics' | 'model'
}

export interface Citation {
  title: string
  url?: string
  note?: string
}

export type DesignOrigin = 'generated' | 'evolved' | 'expert'

export type DesignStatus =
  | 'draft' // freshly generated, not yet reviewed
  | 'reviewing'
  | 'active' // in the tournament
  | 'rejected' // failed initial review
  | 'flagged' // marked by the scientist for wet-lab

/**
 * Outcome of building + testing a design in the wet lab (the DBTL "Test"/
 * "Learn" step). `build-failed`/`inconclusive` are recorded but never downgrade
 * a design below `predicted-only` — only a decisive measured outcome moves the
 * evidence grade.
 */
export type ResultOutcome =
  | 'confirmed' // measured improvement met or beat the prediction
  | 'partial' // some improvement, below the prediction
  | 'refuted' // no improvement, or worse than baseline
  | 'inconclusive' // assay failed or too noisy to call
  | 'build-failed' // the strain could not be constructed

export const RESULT_OUTCOME_LABELS: Record<ResultOutcome, string> = {
  confirmed: 'Confirmed',
  partial: 'Partial',
  refuted: 'Refuted',
  inconclusive: 'Inconclusive',
  'build-failed': 'Build failed'
}

/**
 * The authoritative empirical standing of a design, derived purely from its
 * {@link ExperimentalResult}s. This is the top-level ordering key — a
 * measured-confirmed design always sorts above a predicted-only one regardless
 * of Elo, and a refuted design sinks below everything. See {@link compareDesigns}.
 */
export type EvidenceGrade =
  | 'measured-confirmed'
  | 'measured-partial'
  | 'predicted-only' // the default for every design with no wet-lab data
  | 'measured-refuted'

export const EVIDENCE_GRADE_LABELS: Record<EvidenceGrade, string> = {
  'measured-confirmed': 'Confirmed in lab',
  'measured-partial': 'Partially supported',
  'predicted-only': 'Predicted only',
  'measured-refuted': 'Refuted in lab'
}

/** Sort rank for evidence grades; higher = more authoritative. */
export const EVIDENCE_RANK: Record<EvidenceGrade, number> = {
  'measured-confirmed': 3,
  'measured-partial': 2,
  'predicted-only': 1,
  'measured-refuted': 0
}

export interface EloSnapshot {
  cycle: number
  at: number
  elo: number
}

export interface DesignLineage {
  parentIds: string[]
  /** Which Evolution strategy produced this design, if evolved. */
  strategy?: EvolutionStrategy
}

export interface StrainDesign {
  id: string
  campaignId: string
  createdAt: number
  updatedAt: number

  title: string
  /** One-paragraph summary categorising the core idea (paper: agent summarises each). */
  summary: string
  chassis: string

  interventions: Intervention[]
  mechanism: string
  /** Qualitative predicted effect on titer/rate/yield + rationale. */
  predictedEffect: string
  /** Structured, calibratable prediction (optional; complements predictedEffect). */
  quantPrediction?: QuantPrediction
  experimentalPlan: DBTLStep[]
  constructSuggestions: ConstructSuggestion[]
  risks: string[]
  citations: Citation[]

  /** 0-10 self/assessed novelty, refined by Reflection with literature search. */
  novelty: number

  origin: DesignOrigin
  status: DesignStatus
  /**
   * Cached evidence grade derived from this design's {@link ExperimentalResult}s.
   * Kept in sync by the engine whenever a result is recorded/disputed and
   * recomputed on store load, so comparators can read it without re-aggregating.
   * Absent (treated as `predicted-only`) on legacy designs and designs with no
   * wet-lab data.
   */
  evidence?: EvidenceGrade
  lineage: DesignLineage

  // Tournament state
  elo: number
  eloHistory: EloSnapshot[]
  wins: number
  losses: number
  reviewCount: number

  /** Proximity clustering assignment (set by Proximity agent). */
  clusterId?: number
}

// ---------------------------------------------------------------------------
// Experimental results (DBTL "Test"/"Learn" — closes the feedback loop)
// ---------------------------------------------------------------------------

/**
 * A wet-lab (or external dataset) measurement returned for a design. This is the
 * ground-truth signal that closes the Design-Build-Test-Learn loop: results are
 * authoritative over the model's predicted merit. A design may accrue several
 * results (replicate batches, re-tests); the evidence grade is derived from the
 * aggregate of its `recorded` results.
 */
export interface ExperimentalResult {
  id: string
  campaignId: string
  designId: string
  createdAt: number
  outcome: ResultOutcome
  /** Which phenotype was measured (for calibration against the prediction). */
  metric?: QuantPrediction['metric']
  /** Measured value and its baseline (same unit) — enables a calibration delta. */
  measuredValue?: number
  baselineValue?: number
  unit?: string
  /** Replicate count, so a single noisy point isn't over-trusted. */
  replicates?: number
  /** Observations — especially failure modes, the high-value negative signal. */
  observations: string
  /** Who reported it + provenance (lab, dataset, paper). */
  author: string
  /**
   * An expert can dispute a result; `disputed`/`superseded` results drop out of
   * the authoritative evidence grade and calibration until resolved.
   */
  status: 'recorded' | 'disputed' | 'superseded'
}

/**
 * Per-cycle prediction-calibration snapshot: how well the campaign's structured
 * predictions matched what the lab measured. The whole point of the feedback
 * loop is that these numbers improve over time — the system learns to predict
 * better. Computed purely from designs + their results.
 */
export interface CalibrationProfile {
  campaignId: string
  cycle: number
  at: number
  /** Number of (prediction, measurement) pairs the profile is computed from. */
  nPairs: number
  /** Mean signed error (predicted − measured relative change). >0 = over-optimism. */
  signedBias: number
  /** Mean absolute error of the predicted relative change. */
  meanAbsError: number
  /** Spearman rank correlation between predicted and measured effect (−1..1). */
  spearman: number
  /** Brier score on the predicted-direction hit, when confidences are present (0..1, lower better). */
  brier?: number
  /** Mean signed error broken down by intervention type, to expose class-specific bias. */
  biasByInterventionType: Partial<Record<InterventionType, number>>
}

// ---------------------------------------------------------------------------
// Reviews (Reflection agent) — the six review modes from the paper
// ---------------------------------------------------------------------------

export type ReviewType =
  | 'initial'
  | 'full'
  | 'deep-verification'
  | 'observation'
  | 'simulation'
  | 'tournament'
  | 'expert'
  | 'calibration'

export const REVIEW_TYPE_LABELS: Record<ReviewType, string> = {
  initial: 'Initial review',
  full: 'Full review',
  'deep-verification': 'Deep verification',
  observation: 'Observation review',
  simulation: 'Simulation review',
  tournament: 'Tournament review',
  expert: 'Expert review',
  calibration: 'Calibration review'
}

export interface Review {
  id: string
  designId: string
  campaignId: string
  type: ReviewType
  createdAt: number
  /** Per-criterion 0-10 scores (subset present depending on review type). */
  scores: Partial<Record<CriterionKey, number>>
  /** Overall recommendation. */
  verdict: 'pass' | 'revise' | 'reject'
  narrative: string
  /** Evidence gathered from tools (literature / genomic), for grounding. */
  evidence: string[]
  /** Who produced it: an agent or a named expert. */
  author: string
}

// ---------------------------------------------------------------------------
// Tournament (Ranking agent)
// ---------------------------------------------------------------------------

export interface Match {
  id: string
  campaignId: string
  cycle: number
  createdAt: number
  designAId: string
  designBId: string
  winnerId: string
  /** Multi-turn debate for top designs, single-turn for lower-ranked. */
  mode: 'debate' | 'single-turn'
  transcript: string
  rationale: string
  eloDelta: number
  /**
   * Per-criterion 0-10 judge scores for each design. Persisted so the Elo
   * ladder can be deterministically replayed under new weights without
   * re-running the match. Absent on legacy matches (pre multi-dimensional
   * scoring) — replay falls back to the stored winnerId for those.
   */
  scoresA?: Partial<Record<CriterionKey, number>>
  scoresB?: Partial<Record<CriterionKey, number>>
  /** Weighted totals that decided the winner, for audit in the UI. */
  weightedTotalA?: number
  weightedTotalB?: number
}

// ---------------------------------------------------------------------------
// Evolution agent
// ---------------------------------------------------------------------------

export type EvolutionStrategy =
  | 'grounding-enhancement'
  | 'feasibility'
  | 'inspiration'
  | 'combination'
  | 'simplification'
  | 'out-of-box'
  | 'empirical-refinement'

export const EVOLUTION_STRATEGY_LABELS: Record<EvolutionStrategy, string> = {
  'grounding-enhancement': 'Enhancement through grounding',
  feasibility: 'Coherence & feasibility',
  inspiration: 'Inspiration from top designs',
  combination: 'Combination',
  simplification: 'Simplification',
  'out-of-box': 'Out-of-box thinking',
  'empirical-refinement': 'Empirical refinement (from results)'
}

// ---------------------------------------------------------------------------
// Meta-review agent
// ---------------------------------------------------------------------------

export interface ResearchOverviewArea {
  title: string
  justification: string
  exampleExperiments: string[]
  relatedDesignIds: string[]
}

export interface SuggestedExpert {
  name: string
  expertise: string
  rationale: string
}

export interface MetaReview {
  id: string
  campaignId: string
  cycle: number
  createdAt: number
  /** Recurring critique patterns synthesised from all reviews + debates. */
  critiquePatterns: string[]
  /** Feedback strings appended to each agent's prompt next cycle (no backprop). */
  agentFeedback: Partial<Record<AgentRole, string>>
  /** The synthesised engineering-campaign roadmap. */
  overview: {
    summary: string
    areas: ResearchOverviewArea[]
  }
  suggestedExperts: SuggestedExpert[]
}

// ---------------------------------------------------------------------------
// Agents / tasks / statistics (asynchronous task framework)
// ---------------------------------------------------------------------------

export type AgentRole =
  | 'supervisor'
  | 'generation'
  | 'reflection'
  | 'ranking'
  | 'proximity'
  | 'evolution'
  | 'meta-review'

export const AGENT_LABELS: Record<AgentRole, string> = {
  supervisor: 'Supervisor',
  generation: 'Generation',
  reflection: 'Reflection',
  ranking: 'Ranking',
  proximity: 'Proximity',
  evolution: 'Evolution',
  'meta-review': 'Meta-review'
}

export type TaskState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export interface TaskRecord {
  id: string
  campaignId: string
  agent: AgentRole
  /** Human-readable description of the unit of work. */
  label: string
  state: TaskState
  cycle: number
  createdAt: number
  startedAt?: number
  finishedAt?: number
  error?: string
  /** IDs of designs this task produced or acted on. */
  resultDesignIds?: string[]
}

/** Periodic snapshot computed by the Supervisor and written to context memory. */
export interface SystemStatistics {
  campaignId: string
  cycle: number
  at: number
  designsTotal: number
  designsByStatus: Record<DesignStatus, number>
  reviewsTotal: number
  matchesTotal: number
  topEloAvg10: number // average Elo of top-10 designs (paper's key metric)
  bestElo: number
  queueDepth: number
  /** Adaptive sampling weights the Supervisor assigns to each worker agent. */
  agentWeights: Partial<Record<AgentRole, number>>
  /** Effectiveness signal: generation vs evolution win contribution. */
  generationWinRate: number
  evolutionWinRate: number
  terminalProgress: number // 0..1 toward terminal state
}

// ---------------------------------------------------------------------------
// Activity events (live monitoring feed)
// ---------------------------------------------------------------------------

export type ActivitySeverity = 'info' | 'success' | 'warning' | 'error'

export interface ActivityEvent {
  id: string
  campaignId: string
  at: number
  agent: AgentRole | 'system' | 'expert'
  severity: ActivitySeverity
  message: string
  /** Optional structured payload (design id, match id, etc.). */
  meta?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * LLM provider identifier. Must stay in sync with the catalogue in
 * `shared/providers.ts` (PROVIDER_IDS) and the runtime `createLLMClient`
 * selector.
 */
export type LLMProvider =
  | 'anthropic'
  | 'openai'
  | 'deepseek'
  | 'openrouter'
  | 'siliconflow'
  | 'minimax-cn'
  | 'minimax-global'
  | 'google'
  | 'glm'
  | 'kimi'
  | 'local'
  | 'openai-compatible'

/**
 * A model selection that names both the provider that serves it and the model
 * id. Tier defaults and per-agent overrides are ModelRefs, so different agents
 * can be routed to models hosted by different providers.
 */
export interface ModelRef {
  /** Which configured provider serves this model. */
  provider: LLMProvider
  /** Model id, e.g. "claude-opus-4-8" or "deepseek-chat". */
  model: string
}

export interface ModelTierConfig {
  /** Model used for quality-critical agents (generation/reflection/meta-review). */
  highTier: ModelRef
  /** Model used for high-volume agents (ranking/proximity/evolution). */
  fastTier: ModelRef
}

/** Optional per-agent model override; absent agents fall back to tier defaults. */
export type AgentModelOverrides = Partial<Record<AgentRole, ModelRef>>

/**
 * Per-provider credentials and discovered models, configured on the Providers
 * tab. The Model Selection tab assigns {@link ModelRef}s that point at these
 * accounts.
 */
export interface ProviderAccountConfig {
  /** Whether this provider is available for model selection. */
  enabled: boolean
  /** API key / token. May be empty for keyless local servers. */
  apiKey: string
  /** Base URL override; falls back to the catalogue default when empty. */
  baseUrl?: string
  /** Full model-id list discovered via the Providers-tab "Refresh models" button. */
  fetchedModels?: string[]
  /**
   * Curated subset of {@link fetchedModels} the user enabled for selection on
   * the Providers tab. Only these models are offered on the Model Selection
   * tab. Empty/undefined falls back to the discovered list, then the catalogue
   * presets.
   */
  selectedModels?: string[]
}

export interface McpServerConfig {
  enabled: boolean
  url: string
  /** Optional bearer token (deep-research ACCESS_PASSWORD). */
  accessToken?: string
}

export interface AppSettings {
  llm: {
    /** Default/active provider — seeds new model selections in the UI. */
    provider: LLMProvider
    /** Per-provider credentials & discovered models (the Providers tab). */
    providers: Partial<Record<LLMProvider, ProviderAccountConfig>>
    tiers: ModelTierConfig
    overrides: AgentModelOverrides
    /** Temperature for generation/evolution (exploration). */
    temperature: number
    maxTokens: number
  }
  mcp: {
    deepResearch: McpServerConfig
    codexomics: McpServerConfig
  }
  run: {
    /** Max concurrent worker tasks. */
    concurrency: number
  }
  safety: {
    /** Hard gate: reject designs that fail the safety criterion. */
    enforceBiosafety: boolean
  }
  ui: {
    /** Colour theme for the interface. */
    theme: UiTheme
  }
}

export type UiTheme = 'dark' | 'light'

export const DEFAULT_SETTINGS: AppSettings = {
  llm: {
    provider: 'anthropic',
    providers: {
      anthropic: { enabled: true, apiKey: '' }
    },
    tiers: {
      highTier: { provider: 'anthropic', model: 'claude-opus-4-8' },
      fastTier: { provider: 'anthropic', model: 'claude-sonnet-4-6' }
    },
    overrides: {},
    temperature: 0.9,
    maxTokens: 0
  },
  mcp: {
    deepResearch: { enabled: false, url: 'http://127.0.0.1:3000/api/mcp' },
    codexomics: { enabled: false, url: 'http://localhost:3002' }
  },
  run: {
    concurrency: 3
  },
  safety: {
    enforceBiosafety: true
  },
  ui: {
    theme: 'dark'
  }
}

// ---------------------------------------------------------------------------
// Aggregate snapshot delivered to the renderer
// ---------------------------------------------------------------------------

/** Everything the UI needs to render a campaign in detail. */
export interface CampaignSnapshot {
  campaign: Campaign
  designs: StrainDesign[]
  reviews: Review[]
  matches: Match[]
  metaReviews: MetaReview[]
  statistics: SystemStatistics[]
  tasks: TaskRecord[]
  events: ActivityEvent[]
  /** Wet-lab results recorded against designs (DBTL "Learn"). */
  results: ExperimentalResult[]
  /** Per-cycle prediction-calibration snapshots. */
  calibration: CalibrationProfile[]
}

// ---------------------------------------------------------------------------
// Evidence & ranking helpers (pure — shared by the engine and the renderer)
// ---------------------------------------------------------------------------

/**
 * Derive a design's authoritative evidence grade from its results. Only
 * `recorded` results count (disputed/superseded are ignored). The most decisive
 * recorded outcome wins, in priority order confirmed > partial > refuted;
 * `build-failed`/`inconclusive` carry no decisive signal and leave the design at
 * `predicted-only`. Pure: same inputs always yield the same grade.
 */
export function evidenceGradeFor(results: ExperimentalResult[]): EvidenceGrade {
  const decisive = results.filter((r) => r.status === 'recorded')
  if (decisive.some((r) => r.outcome === 'confirmed')) return 'measured-confirmed'
  if (decisive.some((r) => r.outcome === 'partial')) return 'measured-partial'
  if (decisive.some((r) => r.outcome === 'refuted')) return 'measured-refuted'
  return 'predicted-only'
}

/** The numeric evidence rank for a design (defaulting absent → predicted-only). */
export function evidenceRankOf(design: Pick<StrainDesign, 'evidence'>): number {
  return EVIDENCE_RANK[design.evidence ?? 'predicted-only']
}

/**
 * Authoritative "best first" comparator: evidence grade dominates, Elo breaks
 * ties within a grade. Measured ground truth therefore always outranks a purely
 * predicted design, while the speculative Elo ladder still orders the frontier.
 * Use everywhere designs are sorted for selection or display.
 */
export function compareDesigns(a: StrainDesign, b: StrainDesign): number {
  const byEvidence = evidenceRankOf(b) - evidenceRankOf(a)
  return byEvidence !== 0 ? byEvidence : b.elo - a.elo
}
