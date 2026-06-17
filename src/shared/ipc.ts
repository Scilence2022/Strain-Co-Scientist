/**
 * IPC contract shared between the Electron main process and the renderer.
 *
 * The renderer never touches Node APIs directly; it calls these channels via
 * the typed `window.api` bridge exposed in the preload script.
 */
import type {
  AppSettings,
  Campaign,
  CampaignSnapshot,
  Review,
  StrainDesign,
  ActivityEvent,
  SystemStatistics,
  TaskRecord,
  MetaReview,
  Match
} from './domain'

/** Payload to create a campaign (id/timestamps assigned by main). */
export type CreateCampaignInput = Omit<
  Campaign,
  'id' | 'createdAt' | 'updatedAt' | 'status' | 'researchPlan'
>

/** A manually-authored design contributed by the scientist (expert-in-the-loop). */
export type ExpertDesignInput = Pick<
  StrainDesign,
  | 'title'
  | 'summary'
  | 'chassis'
  | 'interventions'
  | 'mechanism'
  | 'predictedEffect'
> & { campaignId: string }

export type ExpertReviewInput = {
  designId: string
  campaignId: string
  verdict: Review['verdict']
  narrative: string
  scores: Review['scores']
  author: string
}

/** Result of testing an MCP connection. */
export interface McpTestResult {
  ok: boolean
  server: 'deepResearch' | 'codexomics'
  message: string
  toolCount?: number
}

/** Result of pinging the configured LLM provider. */
export interface LlmPingResult {
  ok: boolean
  message: string
  model?: string
}

/** Result of a manual research-overview (re)generation. */
export interface OverviewGenResult {
  ok: boolean
  message: string
}

/** Request to write text content to a user-chosen file (native save dialog). */
export interface ExportFileInput {
  /** Suggested file name (with extension) shown in the save dialog. */
  defaultName: string
  /** File contents to write. */
  contents: string
  /** Filters for the save dialog, e.g. Markdown / plain text. */
  filters?: { name: string; extensions: string[] }[]
}

/** Result of an export-file request. */
export interface ExportFileResult {
  ok: boolean
  /** Absolute path written, when ok. Absent if the user cancelled. */
  path?: string
  /** False with no path means the user cancelled the dialog. */
  cancelled?: boolean
  message?: string
}

/** Invoke channels: renderer → main, request/response. */
export interface IpcApi {
  // Settings
  getSettings(): Promise<AppSettings>
  saveSettings(settings: AppSettings): Promise<AppSettings>
  testMcp(server: 'deepResearch' | 'codexomics'): Promise<McpTestResult>
  pingLlm(): Promise<LlmPingResult>

  // Research overview
  regenerateOverview(campaignId: string): Promise<OverviewGenResult>

  // File export (native save dialog)
  exportFile(input: ExportFileInput): Promise<ExportFileResult>

  // Campaign lifecycle
  listCampaigns(): Promise<Campaign[]>
  createCampaign(input: CreateCampaignInput): Promise<Campaign>
  deleteCampaign(id: string): Promise<void>
  getSnapshot(campaignId: string): Promise<CampaignSnapshot | null>

  // Engine control
  startCampaign(campaignId: string): Promise<void>
  pauseCampaign(campaignId: string): Promise<void>
  resumeCampaign(campaignId: string): Promise<void>
  stopCampaign(campaignId: string): Promise<void>

  // Expert-in-the-loop
  refineGoal(campaignId: string, addendum: string): Promise<Campaign>
  submitExpertDesign(input: ExpertDesignInput): Promise<StrainDesign>
  submitExpertReview(input: ExpertReviewInput): Promise<Review>
  flagDesign(designId: string, flagged: boolean): Promise<StrainDesign>
}

export type IpcApiChannel = keyof IpcApi

/** Event channels: main → renderer, push. */
export type EngineEvent =
  | { kind: 'activity'; campaignId: string; event: ActivityEvent }
  | { kind: 'statistics'; campaignId: string; stats: SystemStatistics }
  | { kind: 'design-upsert'; campaignId: string; design: StrainDesign }
  | { kind: 'review-added'; campaignId: string; review: Review }
  | { kind: 'match-added'; campaignId: string; match: Match }
  | { kind: 'meta-review'; campaignId: string; metaReview: MetaReview }
  | { kind: 'task-upsert'; campaignId: string; task: TaskRecord }
  | { kind: 'campaign-status'; campaignId: string; status: Campaign['status'] }

export const ENGINE_EVENT_CHANNEL = 'engine:event'

/** The bridge surface exposed on `window`. */
export interface PreloadBridge extends IpcApi {
  onEngineEvent(handler: (event: EngineEvent) => void): () => void
}

declare global {
  interface Window {
    api: PreloadBridge
  }
}
