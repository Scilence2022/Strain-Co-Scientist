import type { AgentRole, TaskRecord } from '@shared/domain'
import type { EngineContext } from './context'

export interface AgentTask {
  agent: AgentRole
  label: string
  cycle: number
  run: () => Promise<string[] | void>
}

/**
 * The asynchronous task-execution framework. Runs queued agent tasks with
 * bounded concurrency, recording each as a TaskRecord in context memory and
 * streaming state transitions to the UI. Mirrors the paper's worker pool.
 */
export class TaskQueue {
  private cancelled = false

  constructor(
    private ctx: EngineContext,
    private campaignId: string
  ) {}

  cancel(): void {
    this.cancelled = true
  }

  reset(): void {
    this.cancelled = false
  }

  get queueDepth(): number {
    return this.ctx.store
      .getSnapshot(this.campaignId)
      ?.tasks.filter((t) => t.state === 'queued' || t.state === 'running').length ?? 0
  }

  /** Run a batch of tasks with the configured concurrency limit. */
  async runBatch(tasks: AgentTask[]): Promise<void> {
    const configured = this.ctx.settings.run.concurrency
    const concurrency = Number.isFinite(configured) ? Math.max(1, Math.min(32, Math.floor(configured))) : 1
    const records = tasks.map((t) => this.createRecord(t))

    let cursor = 0
    const worker = async (): Promise<void> => {
      while (cursor < tasks.length && !this.cancelled) {
        const idx = cursor++
        await this.execute(tasks[idx], records[idx])
      }
    }
    const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker())
    await Promise.all(workers)

    // Any not-yet-run records when cancelled are marked cancelled.
    if (this.cancelled) {
      for (const r of records) {
        if (r.state === 'queued') {
          r.state = 'cancelled'
          r.finishedAt = Date.now()
          this.ctx.upsertTask(r)
        }
      }
    }
  }

  private createRecord(task: AgentTask): TaskRecord {
    const record: TaskRecord = {
      id: this.ctx.newId(),
      campaignId: this.campaignId,
      agent: task.agent,
      label: task.label,
      state: 'queued',
      cycle: task.cycle,
      createdAt: Date.now()
    }
    this.ctx.upsertTask(record)
    return record
  }

  private async execute(task: AgentTask, record: TaskRecord): Promise<void> {
    if (this.cancelled) {
      record.state = 'cancelled'
      record.finishedAt = Date.now()
      this.ctx.upsertTask(record)
      return
    }
    record.state = 'running'
    record.startedAt = Date.now()
    this.ctx.upsertTask(record)
    try {
      const result = await task.run()
      record.state = this.cancelled ? 'cancelled' : 'done'
      record.finishedAt = Date.now()
      if (Array.isArray(result)) record.resultDesignIds = result
      this.ctx.upsertTask(record)
    } catch (err) {
      record.state = this.cancelled ? 'cancelled' : 'failed'
      record.finishedAt = Date.now()
      record.error = err instanceof Error ? err.message : String(err)
      this.ctx.upsertTask(record)
      if (!this.cancelled) this.ctx.log(this.campaignId, task.agent, 'error', `${task.label} failed: ${record.error}`)
    }
  }
}
