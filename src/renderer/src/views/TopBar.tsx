import { useStore } from '../store/useStore'
import { NAV } from '../App'
import { CampaignStatusPill } from '../components/ui'
import { IconPause, IconPlay, IconStop } from '../components/Icons'

export function TopBar(): JSX.Element {
  const { campaigns, selectedId, selectCampaign, view, snapshot, settings } = useStore()
  const campaign = snapshot?.campaign
  const status = campaign?.status

  const title = NAV.find((n) => n.key === view)?.label ?? ''

  const onStart = () => selectedId && window.api.startCampaign(selectedId)
  const onPause = () => selectedId && window.api.pauseCampaign(selectedId)
  const onResume = () => selectedId && window.api.resumeCampaign(selectedId)
  const onStop = () => selectedId && window.api.stopCampaign(selectedId)

  const mcpOn =
    (settings?.mcp.deepResearch.enabled ? 1 : 0) + (settings?.mcp.codexomics.enabled ? 1 : 0)
  const hasApiKey = !!settings?.llm.apiKey

  return (
    <header className="topbar">
      <div className="topbar-title">{title}</div>
      <div className="topbar-spacer" />

      <select
        value={selectedId ?? ''}
        onChange={(e) => selectCampaign(e.target.value || null)}
        style={{ width: 280 }}
      >
        {campaigns.length === 0 && <option value="">No campaigns yet</option>}
        {campaigns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
      </select>

      {campaign && (
        <div className="row gap-sm">
          {status === 'running' ? (
            <>
              <button className="btn btn-sm" onClick={onPause} title="Pause">
                <IconPause size={14} /> Pause
              </button>
              <button className="btn btn-sm btn-danger" onClick={onStop} title="Stop">
                <IconStop size={14} />
              </button>
            </>
          ) : status === 'paused' ? (
            <>
              <button className="btn btn-sm btn-primary" onClick={onResume}>
                <IconPlay size={14} /> Resume
              </button>
              <button className="btn btn-sm btn-danger" onClick={onStop}>
                <IconStop size={14} />
              </button>
            </>
          ) : (
            <button className="btn btn-sm btn-primary" onClick={onStart}>
              <IconPlay size={14} /> {status === 'completed' || status === 'stopped' ? 'Run again' : 'Run'}
            </button>
          )}
        </div>
      )}

      {status && <CampaignStatusPill status={status} />}

      <span className="badge" title={hasApiKey ? 'LLM configured' : 'Add an API key in Settings'}>
        {hasApiKey ? 'Live LLM' : 'No API key'}
      </span>
      <span className="badge" title="MCP servers enabled">
        MCP {mcpOn}/2
      </span>
    </header>
  )
}
