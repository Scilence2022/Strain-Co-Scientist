import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore, type ViewKey } from './store/useStore'
import {
  IconCampaigns,
  IconDashboard,
  IconExpert,
  IconExperiment,
  IconGraph,
  IconLog,
  IconOverview,
  IconBeaker,
  IconTournament
} from './components/Icons'
import { Sidebar } from './views/Sidebar'
import { TopBar } from './views/TopBar'
import { Dashboard } from './views/Dashboard'
import { Campaigns } from './views/Campaigns'
import { Workbench } from './views/Workbench'
import { DesignsExplorer, DesignDrawer } from './views/DesignsExplorer'
import { TournamentView } from './views/TournamentView'
import { ProximityView } from './views/ProximityView'
import { ResearchOverview } from './views/ResearchOverview'
import { ExperimentsView } from './views/ExperimentsView'
import { ExpertView } from './views/ExpertView'
import { ActivityLog } from './views/ActivityLog'
import { Settings } from './views/Settings'

export const NAV: {
  key: ViewKey
  label: string
  group: string
  icon: (p: { size?: number }) => JSX.Element
}[] = [
  { key: 'dashboard', label: 'Research workbench', group: 'Lab workflow', icon: IconDashboard },
  { key: 'campaigns', label: 'Research projects', group: 'Lab workflow', icon: IconCampaigns },
  { key: 'designs', label: 'Design strategies', group: 'Lab workflow', icon: IconBeaker },
  {
    key: 'experiments',
    label: 'Experiments & results',
    group: 'Lab workflow',
    icon: IconExperiment
  },
  { key: 'overview', label: 'Engineering roadmap', group: 'Lab workflow', icon: IconOverview },
  { key: 'expert', label: 'Scientist input', group: 'Lab workflow', icon: IconExpert },
  { key: 'monitor', label: 'Research monitor', group: 'Research details', icon: IconDashboard },
  { key: 'tournament', label: 'AI comparisons', group: 'Research details', icon: IconTournament },
  { key: 'proximity', label: 'Strategy map', group: 'Research details', icon: IconGraph },
  { key: 'log', label: 'Activity log', group: 'Research details', icon: IconLog }
]

const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 420
const SIDEBAR_KEY = 'sidebar-width'

export default function App(): JSX.Element {
  const {
    ready,
    view,
    init,
    settings,
    error,
    clearError,
    loadingSnapshot,
    refreshSnapshot,
    snapshot,
    selectedId,
    selectedDesignId,
    openDesign
  } = useStore()
  const { width: sidebarW, startResize, resizing } = useSidebarWidth()

  useEffect(() => {
    void init()
    document.body.classList.add(`platform-${navigatorPlatform()}`)
    const onError = (event: PromiseRejectionEvent) => {
      useStore.getState().reportError(event.reason)
    }
    window.addEventListener('unhandledrejection', onError)
    return () => window.removeEventListener('unhandledrejection', onError)
  }, [init])

  // Apply the selected colour theme to the document root.
  useEffect(() => {
    const theme = settings?.ui.theme ?? 'dark'
    document.documentElement.setAttribute('data-theme', theme)
  }, [settings?.ui.theme])

  if (!ready) {
    return (
      <div className="app" style={{ gridTemplateColumns: '1fr', gridTemplateAreas: '"main"' }}>
        <div className="empty" style={{ height: '100vh' }}>
          {error ? (
            <div className="col gap-sm" role="alert">
              <p>Could not load Strain Co-Scientist: {error}</p>
              <button className="btn btn-primary" onClick={() => void init()}>
                Retry
              </button>
            </div>
          ) : (
            'Loading Strain Co-Scientist…'
          )}
        </div>
      </div>
    )
  }

  const selected = snapshot?.designs.find((d) => d.id === selectedDesignId)

  return (
    <div className="app" style={{ gridTemplateColumns: `${sidebarW}px 1fr` }}>
      <Sidebar />
      <TopBar />
      <main className="main">
        {error && (
          <div className="card row gap-sm" role="alert">
            <span>{error}</span>
            <button className="btn btn-sm" onClick={() => void refreshSnapshot()}>
              Retry
            </button>
            <button className="btn btn-sm btn-ghost" onClick={clearError}>
              Dismiss
            </button>
          </div>
        )}
        {loadingSnapshot ? (
          <div className="empty" role="status">
            Loading project…
          </div>
        ) : (
          <div key={selectedId}>{renderView(view)}</div>
        )}
      </main>
      {selected && !loadingSnapshot && (
        <DesignDrawer key={selected.id} design={selected} onClose={() => openDesign(null)} />
      )}
      <div
        className={`splitter${resizing ? ' dragging' : ''}`}
        style={{ left: sidebarW }}
        onPointerDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
      />
    </div>
  )
}

/** Persisted, drag-resizable sidebar width. */
function useSidebarWidth(): {
  width: number
  resizing: boolean
  startResize: (e: React.PointerEvent) => void
} {
  const [width, setWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(SIDEBAR_KEY))
    return saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX ? saved : 216
  })
  const [resizing, setResizing] = useState(false)
  const frame = useRef<number | null>(null)

  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    setResizing(true)
    document.body.classList.add('is-resizing')

    const onMove = (ev: PointerEvent) => {
      if (frame.current != null) return
      frame.current = requestAnimationFrame(() => {
        frame.current = null
        const next = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, ev.clientX))
        setWidth(next)
      })
    }
    const onUp = () => {
      setResizing(false)
      document.body.classList.remove('is-resizing')
      if (frame.current != null) {
        cancelAnimationFrame(frame.current)
        frame.current = null
      }
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setWidth((w) => {
        localStorage.setItem(SIDEBAR_KEY, String(w))
        return w
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [])

  return { width, resizing, startResize }
}

function renderView(view: ViewKey): JSX.Element {
  switch (view) {
    case 'dashboard':
      return <Workbench />
    case 'monitor':
      return <Dashboard />
    case 'campaigns':
      return <Campaigns />
    case 'designs':
      return <DesignsExplorer />
    case 'tournament':
      return <TournamentView />
    case 'proximity':
      return <ProximityView />
    case 'overview':
      return <ResearchOverview />
    case 'experiments':
      return <ExperimentsView />
    case 'expert':
      return <ExpertView />
    case 'log':
      return <ActivityLog />
    case 'settings':
      return <Settings />
  }
}

function navigatorPlatform(): string {
  return navigator.userAgent.includes('Mac') ? 'darwin' : 'other'
}
