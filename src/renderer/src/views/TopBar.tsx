import { useState } from 'react'
import { useStore } from '../store/useStore'
import { NAV } from '../App'
import { CampaignStatusPill } from '../components/ui'
import { IconPause, IconPlay, IconStop } from '../components/Icons'
import { getProvider } from '@shared/providers'

export function TopBar(): JSX.Element {
  const { campaigns, selectedId, selectCampaign, view, snapshot, settings, setView } = useStore()
  const [busy, setBusy] = useState(false)
  const control = async (action: () => Promise<void> | null | undefined) => {
    if (busy) return
    setBusy(true)
    try {
      await action()
    } catch (err) {
      useStore.getState().reportError(err)
    } finally {
      setBusy(false)
    }
  }
  const campaign = snapshot?.campaign
  const status = campaign?.status

  const title = NAV.find((n) => n.key === view)?.label ?? 'Settings'

  const onStart = () => (selectedId ? window.api.startCampaign(selectedId) : undefined)
  const onPause = () => (selectedId ? window.api.pauseCampaign(selectedId) : undefined)
  const onResume = () => (selectedId ? window.api.resumeCampaign(selectedId) : undefined)
  const onStop = () => (selectedId ? window.api.stopCampaign(selectedId) : undefined)

  // Usable when the providers serving the configured tiers have a key (or are
  // keyless local servers).
  const llm = settings?.llm
  const hasApiKey =
    !!llm &&
    [llm.tiers.highTier, llm.tiers.fastTier].every((ref) => {
      const acct = llm.providers[ref.provider]
      return (
        !!acct?.enabled &&
        (!!acct.apiKey?.trim() || getProvider(ref.provider)?.requiresApiKey === false)
      )
    })

  return (
    <header className="topbar">
      <div className="topbar-title">{title}</div>
      <div className="topbar-spacer" />

      <select
        aria-label="Current research project"
        value={selectedId ?? ''}
        onChange={(e) => selectCampaign(e.target.value || null)}
        style={{ width: 280 }}
      >
        {campaigns.length === 0 && <option value="">No research projects yet</option>}
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
              <button
                className="btn btn-sm"
                disabled={busy}
                onClick={() => void control(onPause)}
                title="Pause"
              >
                <IconPause size={14} /> Pause
              </button>
              <button
                className="btn btn-sm btn-danger"
                disabled={busy}
                aria-label="Stop research"
                onClick={() => void control(onStop)}
                title="Stop"
              >
                <IconStop size={14} />
              </button>
            </>
          ) : status === 'paused' ? (
            <>
              <button
                className="btn btn-sm btn-primary"
                disabled={busy}
                onClick={() => (hasApiKey ? void control(onResume) : setView('settings'))}
              >
                <IconPlay size={14} /> Resume
              </button>
              <button
                className="btn btn-sm btn-danger"
                disabled={busy}
                aria-label="Stop research"
                onClick={() => void control(onStop)}
              >
                <IconStop size={14} />
              </button>
            </>
          ) : (
            <button
              className="btn btn-sm btn-primary"
              disabled={busy}
              onClick={() => (hasApiKey ? void control(onStart) : setView('settings'))}
            >
              <IconPlay size={14} />{' '}
              {!hasApiKey
                ? 'Set up research'
                : status === 'completed' || status === 'stopped'
                  ? 'Research again'
                  : 'Start research'}
            </button>
          )}
        </div>
      )}

      {status && <CampaignStatusPill status={status} />}

      <button
        className="btn btn-sm btn-ghost"
        onClick={() => setView('settings')}
        title="Configure models and evidence sources"
      >
        {hasApiKey ? 'Research configured' : 'Setup needed'}
      </button>
    </header>
  )
}
