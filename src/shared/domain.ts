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

export type BiosafetyLevel = 'BSL-1' | 'BSL-2' | 'unspecified'

/**
 * The evaluation criteria, adapted from the paper's defaults (alignment,
 * plausibility, novelty, testability, safety) to strain engineering.
 * Weights are used by the Ranking and Reflection agents.
 */
export interface CriteriaWeights {
  alignment: number
  plausibility: number // metabolic / thermodynamic feasibility
  novelty: number
  testability: number // genetic tractability + assay availability
  hostCompatibility: number // burden, toxicity, genetic stability
  safety: number // biosafety / dual-use
}

export const DEFAULT_CRITERIA_WEIGHTS: CriteriaWeights = {
  alignment: 1,
  plausibility: 1,
  novelty: 1,
  testability: 1,
  hostCompatibility: 1,
  safety: 1
}

export const CRITERIA_KEYS = [
  'alignment',
  'plausibility',
  'novelty',
  'testability',
  'hostCompatibility',
  'safety'
] as const
export type CriterionKey = (typeof CRITERIA_KEYS)[number]

export const CRITERION_LABELS: Record<CriterionKey, string> = {
  alignment: 'Alignment',
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
  criteriaWeights: CriteriaWeights
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
  experimentalPlan: DBTLStep[]
  constructSuggestions: ConstructSuggestion[]
  risks: string[]
  citations: Citation[]

  /** 0-10 self/assessed novelty, refined by Reflection with literature search. */
  novelty: number

  origin: DesignOrigin
  status: DesignStatus
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

export const REVIEW_TYPE_LABELS: Record<ReviewType, string> = {
  initial: 'Initial review',
  full: 'Full review',
  'deep-verification': 'Deep verification',
  observation: 'Observation review',
  simulation: 'Simulation review',
  tournament: 'Tournament review',
  expert: 'Expert review'
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

export const EVOLUTION_STRATEGY_LABELS: Record<EvolutionStrategy, string> = {
  'grounding-enhancement': 'Enhancement through grounding',
  feasibility: 'Coherence & feasibility',
  inspiration: 'Inspiration from top designs',
  combination: 'Combination',
  simplification: 'Simplification',
  'out-of-box': 'Out-of-box thinking'
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

export type LLMProvider = 'anthropic' | 'openai-compatible'

export interface ModelTierConfig {
  /** Model id used for quality-critical agents (generation/reflection/meta-review). */
  highTierModel: string
  /** Model id used for high-volume agents (ranking/proximity/evolution). */
  fastTierModel: string
}

export interface AgentModelOverrides {
  // Optional per-agent model id; falls back to tier defaults.
  generation?: string
  reflection?: string
  ranking?: string
  proximity?: string
  evolution?: string
  'meta-review'?: string
  supervisor?: string
}

export interface McpServerConfig {
  enabled: boolean
  url: string
  /** Optional bearer token (deep-research ACCESS_PASSWORD). */
  accessToken?: string
}

export interface AppSettings {
  llm: {
    provider: LLMProvider
    apiKey: string
    baseUrl?: string
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
}

export const DEFAULT_SETTINGS: AppSettings = {
  llm: {
    provider: 'anthropic',
    apiKey: '',
    baseUrl: undefined,
    tiers: {
      highTierModel: 'claude-opus-4-8',
      fastTierModel: 'claude-sonnet-4-6'
    },
    overrides: {},
    temperature: 0.9,
    maxTokens: 4096
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
}
