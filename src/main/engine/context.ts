import { genId } from '../util/id'
import type {
  ActivityEvent,
  ActivitySeverity,
  AgentRole,
  AppSettings,
  Match,
  MetaReview,
  Review,
  StrainDesign,
  SystemStatistics,
  TaskRecord
} from '@shared/domain'
import type { EngineEvent } from '@shared/ipc'
import type { Store } from '../memory/Store'
import type { LLMClient } from '../llm'
import type { DeepResearchClient } from '../mcp/DeepResearchClient'
import type { CodexomicsClient } from '../mcp/CodexomicsClient'

/**
 * Shared services and persistence/emit helpers handed to every agent. Centralises
 * id assignment, writing to context memory, and pushing live events to the UI.
 */
export class EngineContext {
  constructor(
    public store: Store,
    public llm: LLMClient,
    public deepResearch: DeepResearchClient,
    public codexomics: CodexomicsClient,
    public settings: AppSettings,
    private emitter: (event: EngineEvent) => void
  ) {}

  emit(event: EngineEvent): void {
    this.emitter(event)
  }

  log(
    campaignId: string,
    agent: AgentRole | 'system' | 'expert',
    severity: ActivitySeverity,
    message: string,
    meta?: Record<string, unknown>
  ): ActivityEvent {
    const event: ActivityEvent = {
      id: genId(10),
      campaignId,
      at: Date.now(),
      agent,
      severity,
      message,
      meta
    }
    this.store.addEvent(event)
    this.emit({ kind: 'activity', campaignId, event })
    return event
  }

  upsertDesign(design: StrainDesign): void {
    design.updatedAt = Date.now()
    this.store.upsertDesign(design)
    this.emit({ kind: 'design-upsert', campaignId: design.campaignId, design })
  }

  addReview(review: Review): void {
    this.store.addReview(review)
    this.emit({ kind: 'review-added', campaignId: review.campaignId, review })
  }

  addMatch(match: Match): void {
    this.store.addMatch(match)
    this.emit({ kind: 'match-added', campaignId: match.campaignId, match })
  }

  addMetaReview(metaReview: MetaReview): void {
    this.store.addMetaReview(metaReview)
    this.emit({ kind: 'meta-review', campaignId: metaReview.campaignId, metaReview })
  }

  addStatistics(stats: SystemStatistics): void {
    this.store.addStatistics(stats)
    this.emit({ kind: 'statistics', campaignId: stats.campaignId, stats })
  }

  upsertTask(task: TaskRecord): void {
    this.store.upsertTask(task)
    this.emit({ kind: 'task-upsert', campaignId: task.campaignId, task })
  }

  newId(): string {
    return genId(12)
  }
}
