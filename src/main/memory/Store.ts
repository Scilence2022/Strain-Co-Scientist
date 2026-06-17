/**
 * Persistent context memory.
 *
 * Mirrors the paper's "persistent context memory" component: it stores and
 * retrieves the full state of every campaign (designs, reviews, tournament,
 * statistics, tasks, events) so long-horizon reasoning survives restarts.
 *
 * Backed by atomic JSON files under Electron's userData directory. An
 * in-memory cache front-runs reads; writes are debounced and flushed
 * atomically (temp file + rename). The repository surface is deliberately
 * narrow so it could later be swapped for SQLite without touching callers.
 */
import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ActivityEvent,
  AppSettings,
  Campaign,
  CampaignSnapshot,
  Match,
  MetaReview,
  Review,
  StrainDesign,
  SystemStatistics,
  TaskRecord
} from '@shared/domain'
import { DEFAULT_SETTINGS } from '@shared/domain'

const MAX_EVENTS = 2000

function emptySnapshot(campaign: Campaign): CampaignSnapshot {
  return {
    campaign,
    designs: [],
    reviews: [],
    matches: [],
    metaReviews: [],
    statistics: [],
    tasks: [],
    events: []
  }
}

export class Store {
  private root: string
  private campaignsDir: string
  private settingsPath: string
  private cache = new Map<string, CampaignSnapshot>()
  private dirty = new Set<string>()
  private flushTimer: NodeJS.Timeout | null = null
  private settings: AppSettings = DEFAULT_SETTINGS

  constructor(rootOverride?: string) {
    this.root = rootOverride ?? join(app.getPath('userData'), 'data')
    this.campaignsDir = join(this.root, 'campaigns')
    this.settingsPath = join(this.root, 'settings.json')
    mkdirSync(this.campaignsDir, { recursive: true })
    this.loadAll()
  }

  // -- Settings -------------------------------------------------------------

  getSettings(): AppSettings {
    return this.settings
  }

  async saveSettings(settings: AppSettings): Promise<AppSettings> {
    this.settings = settings
    await this.atomicWrite(this.settingsPath, settings)
    return settings
  }

  // -- Loading --------------------------------------------------------------

  private loadAll(): void {
    if (existsSync(this.settingsPath)) {
      try {
        const raw = JSON.parse(readFileSync(this.settingsPath, 'utf8'))
        // Merge to tolerate older settings files missing new keys.
        this.settings = mergeSettings(DEFAULT_SETTINGS, raw)
      } catch {
        this.settings = DEFAULT_SETTINGS
      }
    }
    if (!existsSync(this.campaignsDir)) return
    for (const dir of readdirSync(this.campaignsDir)) {
      const file = join(this.campaignsDir, dir, 'snapshot.json')
      if (!existsSync(file)) continue
      try {
        const snap = JSON.parse(readFileSync(file, 'utf8')) as CampaignSnapshot
        this.cache.set(snap.campaign.id, snap)
      } catch {
        // skip corrupt campaign
      }
    }
  }

  // -- Campaign-level access ------------------------------------------------

  listCampaigns(): Campaign[] {
    return Array.from(this.cache.values())
      .map((s) => s.campaign)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  getSnapshot(campaignId: string): CampaignSnapshot | null {
    const snap = this.cache.get(campaignId)
    return snap ? structuredClone(snap) : null
  }

  /** Live (non-cloned) campaign reference for internal engine use. */
  getCampaign(id: string): Campaign | undefined {
    return this.cache.get(id)?.campaign
  }

  upsertCampaign(campaign: Campaign): Campaign {
    const existing = this.cache.get(campaign.id)
    if (existing) {
      existing.campaign = campaign
    } else {
      this.cache.set(campaign.id, emptySnapshot(campaign))
    }
    this.markDirty(campaign.id)
    return campaign
  }

  deleteCampaign(id: string): void {
    this.cache.delete(id)
    this.dirty.delete(id)
    const dir = join(this.campaignsDir, id)
    if (existsSync(dir)) {
      fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }

  // -- Designs --------------------------------------------------------------

  upsertDesign(design: StrainDesign): void {
    const snap = this.cache.get(design.campaignId)
    if (!snap) return
    const idx = snap.designs.findIndex((d) => d.id === design.id)
    if (idx >= 0) snap.designs[idx] = design
    else snap.designs.push(design)
    snap.campaign.updatedAt = Date.now()
    this.markDirty(design.campaignId)
  }

  getDesign(campaignId: string, designId: string): StrainDesign | undefined {
    return this.cache.get(campaignId)?.designs.find((d) => d.id === designId)
  }

  getDesigns(campaignId: string): StrainDesign[] {
    return this.cache.get(campaignId)?.designs ?? []
  }

  /** Live (non-cloned) matches for the campaign — used by the Elo replay. */
  getMatches(campaignId: string): Match[] {
    return this.cache.get(campaignId)?.matches ?? []
  }

  // -- Reviews / matches / meta-reviews / stats / tasks / events ------------

  addReview(review: Review): void {
    const snap = this.cache.get(review.campaignId)
    if (!snap) return
    snap.reviews.push(review)
    this.markDirty(review.campaignId)
  }

  addMatch(match: Match): void {
    const snap = this.cache.get(match.campaignId)
    if (!snap) return
    snap.matches.push(match)
    this.markDirty(match.campaignId)
  }

  addMetaReview(metaReview: MetaReview): void {
    const snap = this.cache.get(metaReview.campaignId)
    if (!snap) return
    snap.metaReviews.push(metaReview)
    this.markDirty(metaReview.campaignId)
  }

  addStatistics(stats: SystemStatistics): void {
    const snap = this.cache.get(stats.campaignId)
    if (!snap) return
    snap.statistics.push(stats)
    this.markDirty(stats.campaignId)
  }

  upsertTask(task: TaskRecord): void {
    const snap = this.cache.get(task.campaignId)
    if (!snap) return
    const idx = snap.tasks.findIndex((t) => t.id === task.id)
    if (idx >= 0) snap.tasks[idx] = task
    else snap.tasks.push(task)
    this.markDirty(task.campaignId)
  }

  addEvent(event: ActivityEvent): void {
    const snap = this.cache.get(event.campaignId)
    if (!snap) return
    snap.events.push(event)
    if (snap.events.length > MAX_EVENTS) {
      snap.events.splice(0, snap.events.length - MAX_EVENTS)
    }
    this.markDirty(event.campaignId)
  }

  /** Latest meta-review feedback (used to inject into agent prompts). */
  latestMetaReview(campaignId: string): MetaReview | undefined {
    const list = this.cache.get(campaignId)?.metaReviews ?? []
    return list[list.length - 1]
  }

  // -- Persistence plumbing -------------------------------------------------

  private markDirty(campaignId: string): void {
    this.dirty.add(campaignId)
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.flush()
    }, 400)
  }

  async flush(): Promise<void> {
    const ids = Array.from(this.dirty)
    this.dirty.clear()
    await Promise.all(
      ids.map(async (id) => {
        const snap = this.cache.get(id)
        if (!snap) return
        const dir = join(this.campaignsDir, id)
        await fs.mkdir(dir, { recursive: true })
        await this.atomicWrite(join(dir, 'snapshot.json'), snap)
      })
    )
  }

  private async atomicWrite(path: string, value: unknown): Promise<void> {
    const tmp = `${path}.${process.pid}.tmp`
    await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
    await fs.rename(tmp, path)
  }
}

/** Deep-ish merge so older settings files gain new default keys. */
function mergeSettings(base: AppSettings, raw: Partial<AppSettings>): AppSettings {
  return {
    llm: {
      ...base.llm,
      ...raw.llm,
      tiers: { ...base.llm.tiers, ...raw.llm?.tiers },
      overrides: { ...base.llm.overrides, ...raw.llm?.overrides }
    },
    mcp: {
      deepResearch: { ...base.mcp.deepResearch, ...raw.mcp?.deepResearch },
      codexomics: { ...base.mcp.codexomics, ...raw.mcp?.codexomics }
    },
    run: { ...base.run, ...raw.run },
    safety: { ...base.safety, ...raw.safety },
    ui: { ...base.ui, ...raw.ui }
  }
}
