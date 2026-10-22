import { create } from 'zustand'
import type {
  AppSettings,
  Campaign,
  CampaignSnapshot
} from '@shared/domain'
import type { EngineEvent, PreloadBridge } from '@shared/ipc'

export type ViewKey =
  | 'dashboard'
  | 'campaigns'
  | 'designs'
  | 'tournament'
  | 'proximity'
  | 'overview'
  | 'experiments'
  | 'expert'
  | 'log'
  | 'settings'

interface State {
  ready: boolean
  error: string | null
  loadingSnapshot: boolean
  settings: AppSettings | null
  campaigns: Campaign[]
  selectedId: string | null
  snapshot: CampaignSnapshot | null
  view: ViewKey
  selectedDesignId: string | null

  init: () => Promise<void>
  dispose: () => void
  clearError: () => void
  reportError: (error: unknown) => void
  setView: (v: ViewKey) => void
  selectCampaign: (id: string | null) => Promise<void>
  refreshCampaigns: () => Promise<void>
  refreshSnapshot: () => Promise<void>
  setSettings: (s: AppSettings) => void
  openDesign: (id: string | null) => void
  applyEvent: (e: EngineEvent) => void
}

const MAX_EVENTS = 600

/** A factory keeps subscriptions and request versions scoped to one app instance. */
export function createAppStore(bridge: () => PreloadBridge) {
  let initialization: Promise<void> | null = null
  let unsubscribe: (() => void) | null = null
  let requestVersion = 0
  let pending: { id: string; events: EngineEvent[] } | null = null
  let starting: EngineEvent[] | null = null

  return create<State>((set, get) => {
    const loadSnapshot = async (id: string | null, clear: boolean): Promise<void> => {
      const version = ++requestVersion
      pending = id ? { id, events: [] } : null
      set({ selectedId: id, loadingSnapshot: !!id, error: null, ...(clear ? { snapshot: null, selectedDesignId: null } : {}) })
      if (!id) {
        set({ snapshot: null })
        return
      }
      try {
        let snapshot = await bridge().getSnapshot(id)
        if (version !== requestVersion) return
        for (const event of pending?.events ?? []) {
          if (snapshot) snapshot = patchSnapshot(snapshot, event)
        }
        set({ snapshot, loadingSnapshot: false })
      } catch (err) {
        if (version === requestVersion) set({ error: messageOf(err), loadingSnapshot: false })
      } finally {
        if (version === requestVersion) pending = null
      }
    }

    return {
      ready: false,
      error: null,
      loadingSnapshot: false,
      settings: null,
      campaigns: [],
      selectedId: null,
      snapshot: null,
      view: 'dashboard',
      selectedDesignId: null,

      init: () => {
        if (initialization) return initialization
        // Subscribe before reading, and replay events received while loading.
        // React StrictMode calls init twice; both calls share this promise.
        starting = []
        unsubscribe ??= bridge().onEngineEvent((event) => get().applyEvent(event))
        initialization = (async () => {
          try {
            const [settings, campaigns] = await Promise.all([bridge().getSettings(), bridge().listCampaigns()])
            set({ settings, campaigns, error: null })
            await loadSnapshot(campaigns[0]?.id ?? null, true)
            const events = starting ?? []
            starting = null
            for (const event of events) get().applyEvent(event)
            set({ ready: true })
          } catch (err) {
            starting = null
            unsubscribe?.()
            unsubscribe = null
            initialization = null
            set({ error: messageOf(err) })
          }
        })()
        return initialization
      },

      dispose: () => {
        unsubscribe?.()
        unsubscribe = null
        initialization = null
        starting = null
        pending = null
        requestVersion++
      },
      clearError: () => set({ error: null }),
      reportError: (error) => set({ error: messageOf(error) }),
      setView: (view) => set({ view }),
      selectCampaign: (id) => loadSnapshot(id, true),
      refreshSnapshot: () => loadSnapshot(get().selectedId, false),
      refreshCampaigns: async () => {
        try {
          set({ campaigns: await bridge().listCampaigns() })
        } catch (err) {
          set({ error: messageOf(err) })
        }
      },
      setSettings: (settings) => set({ settings }),
      openDesign: (selectedDesignId) => set({ selectedDesignId }),

      applyEvent: (event) => {
        if (starting) {
          starting.push(event)
          return
        }
        if (pending?.id === event.campaignId) pending.events.push(event)
        set((state) => {
          let campaigns = state.campaigns
          if (event.kind === 'campaign-upsert') campaigns = upsert(campaigns, event.campaign)
          if (event.kind === 'campaign-status') {
            campaigns = campaigns.map((c) => c.id === event.campaignId ? { ...c, status: event.status } : c)
          }
          return {
            campaigns,
            snapshot: state.snapshot?.campaign.id === event.campaignId
              ? patchSnapshot(state.snapshot, event)
              : state.snapshot
          }
        })
      }
    }
  })
}

export const useStore = createAppStore(() => window.api)

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const index = list.findIndex((entry) => entry.id === item.id)
  return index < 0 ? [...list, item] : list.map((entry, i) => i === index ? item : entry)
}

/** Idempotent so replaying a snapshot's overlapping event tail is safe. */
function patchSnapshot(snap: CampaignSnapshot, event: EngineEvent): CampaignSnapshot {
  switch (event.kind) {
    case 'campaign-upsert': return { ...snap, campaign: event.campaign }
    case 'campaign-status': return { ...snap, campaign: { ...snap.campaign, status: event.status } }
    case 'activity': return { ...snap, events: upsert(snap.events, event.event).slice(-MAX_EVENTS) }
    case 'statistics': return {
      ...snap,
      statistics: [...snap.statistics.filter((s) => s.at !== event.stats.at || s.cycle !== event.stats.cycle), event.stats]
    }
    case 'design-upsert': return { ...snap, designs: upsert(snap.designs, event.design) }
    case 'review-added': return { ...snap, reviews: upsert(snap.reviews, event.review) }
    case 'match-added': return { ...snap, matches: upsert(snap.matches, event.match) }
    case 'meta-review': return { ...snap, metaReviews: upsert(snap.metaReviews, event.metaReview) }
    case 'task-upsert': return { ...snap, tasks: upsert(snap.tasks, event.task) }
    case 'result-added': return { ...snap, results: upsert(snap.results ?? [], event.result) }
    case 'calibration-updated': return {
      ...snap,
      calibration: [...(snap.calibration ?? []).filter((c) => c.at !== event.calibration.at || c.cycle !== event.calibration.cycle), event.calibration]
    }
  }
}
