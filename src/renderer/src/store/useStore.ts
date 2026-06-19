import { create } from 'zustand'
import type {
  AppSettings,
  Campaign,
  CampaignSnapshot,
  StrainDesign
} from '@shared/domain'
import type { EngineEvent } from '@shared/ipc'

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
  settings: AppSettings | null
  campaigns: Campaign[]
  selectedId: string | null
  snapshot: CampaignSnapshot | null
  view: ViewKey
  selectedDesignId: string | null

  init: () => Promise<void>
  setView: (v: ViewKey) => void
  selectCampaign: (id: string | null) => Promise<void>
  refreshCampaigns: () => Promise<void>
  refreshSnapshot: () => Promise<void>
  setSettings: (s: AppSettings) => void
  openDesign: (id: string | null) => void
  applyEvent: (e: EngineEvent) => void
}

const MAX_EVENTS = 600

export const useStore = create<State>((set, get) => ({
  ready: false,
  settings: null,
  campaigns: [],
  selectedId: null,
  snapshot: null,
  view: 'dashboard',
  selectedDesignId: null,

  init: async () => {
    const [settings, campaigns] = await Promise.all([
      window.api.getSettings(),
      window.api.listCampaigns()
    ])
    const selectedId = campaigns[0]?.id ?? null
    let snapshot: CampaignSnapshot | null = null
    if (selectedId) snapshot = await window.api.getSnapshot(selectedId)
    set({ ready: true, settings, campaigns, selectedId, snapshot })
    window.api.onEngineEvent((e) => get().applyEvent(e))
  },

  setView: (v) => set({ view: v }),

  selectCampaign: async (id) => {
    set({ selectedId: id, selectedDesignId: null })
    if (id) {
      const snapshot = await window.api.getSnapshot(id)
      set({ snapshot })
    } else {
      set({ snapshot: null })
    }
  },

  refreshCampaigns: async () => {
    const campaigns = await window.api.listCampaigns()
    set({ campaigns })
  },

  refreshSnapshot: async () => {
    const id = get().selectedId
    if (!id) return
    const snapshot = await window.api.getSnapshot(id)
    set({ snapshot })
  },

  setSettings: (s) => set({ settings: s }),

  openDesign: (id) => set({ selectedDesignId: id }),

  applyEvent: (e) => {
    const state = get()
    // Always keep the campaign list status current.
    if (e.kind === 'campaign-status') {
      set({
        campaigns: state.campaigns.map((c) =>
          c.id === e.campaignId ? { ...c, status: e.status } : c
        )
      })
      if (state.snapshot && state.snapshot.campaign.id === e.campaignId) {
        set({
          snapshot: {
            ...state.snapshot,
            campaign: { ...state.snapshot.campaign, status: e.status }
          }
        })
      }
      return
    }

    // Only patch the snapshot when the event targets the selected campaign.
    if (!state.snapshot || e.campaignId !== state.snapshot.campaign.id) return
    const snap = state.snapshot

    switch (e.kind) {
      case 'activity': {
        const events = [...snap.events, e.event]
        if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
        set({ snapshot: { ...snap, events } })
        break
      }
      case 'statistics':
        set({ snapshot: { ...snap, statistics: [...snap.statistics, e.stats] } })
        break
      case 'design-upsert':
        set({ snapshot: { ...snap, designs: upsert(snap.designs, e.design) } })
        break
      case 'review-added':
        set({ snapshot: { ...snap, reviews: [...snap.reviews, e.review] } })
        break
      case 'match-added':
        set({ snapshot: { ...snap, matches: [...snap.matches, e.match] } })
        break
      case 'meta-review':
        set({ snapshot: { ...snap, metaReviews: [...snap.metaReviews, e.metaReview] } })
        break
      case 'task-upsert': {
        const tasks = upsertTask(snap.tasks, e.task)
        set({ snapshot: { ...snap, tasks } })
        break
      }
      case 'result-added':
        // Upsert by id so a dispute/restore (same id) replaces in place.
        set({ snapshot: { ...snap, results: upsertById(snap.results ?? [], e.result) } })
        break
      case 'calibration-updated':
        set({ snapshot: { ...snap, calibration: [...(snap.calibration ?? []), e.calibration] } })
        break
    }
  }
}))

function upsert(list: StrainDesign[], item: StrainDesign): StrainDesign[] {
  const idx = list.findIndex((d) => d.id === item.id)
  if (idx === -1) return [...list, item]
  const copy = list.slice()
  copy[idx] = item
  return copy
}

function upsertTask<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex((t) => t.id === item.id)
  if (idx === -1) return [...list, item]
  const copy = list.slice()
  copy[idx] = item
  return copy
}

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex((t) => t.id === item.id)
  if (idx === -1) return [...list, item]
  const copy = list.slice()
  copy[idx] = item
  return copy
}
