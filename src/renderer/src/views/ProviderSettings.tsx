import { useId, useRef, useState } from 'react'
import { AGENT_LABELS, type AppSettings, type LLMProvider, type ProviderAccountConfig } from '@shared/domain'
import {
  PROVIDER_GROUP_LABEL,
  PROVIDER_GROUP_ORDER,
  PROVIDERS_ORDERED,
  defaultSelectedModels,
  effectiveModelIds,
  getProvider,
  modelLabelFor,
  resolveBaseUrl,
  type ProviderDefinition
} from '@shared/providers'
import { providerCredentialsSchema } from '@shared/validation'
import type { ModelListResult, ProviderCredentials } from '@shared/ipc'
import { IconRefresh } from '../components/Icons'

export type ModelDiscovery = Partial<Record<LLMProvider, ModelListResult | 'loading'>>
type Tier = keyof AppSettings['llm']['tiers']
type Filter = 'all' | 'enabled' | 'assigned'

interface ProviderSettingsProps {
  llm: AppSettings['llm']
  activeId: LLMProvider
  onSelect: (id: LLMProvider) => void
  discovery: ModelDiscovery
  onConnection: (id: LLMProvider, changes: Partial<ProviderCredentials>) => void
  onToggle: (id: LLMProvider, enabled: boolean) => void
  onRefresh: (id: LLMProvider) => void
  onShortlist: (id: LLMProvider, models: string[]) => void
  onAssign: (id: LLMProvider, model: string, tier: Tier) => void
  onOpenModels: () => void
}

const TIERS: { key: Tier; label: string }[] = [
  { key: 'highTier', label: 'High tier' },
  { key: 'fastTier', label: 'Fast tier' }
]

function accountStatus(provider: ProviderDefinition, account?: ProviderAccountConfig) {
  if (!account?.enabled) return { label: 'Disabled', tone: '' }
  if (!resolveBaseUrl(provider, account.baseUrl) || (provider.requiresApiKey && !account.apiKey.trim()) ||
    !providerCredentialsSchema.safeParse(account).success) {
    return { label: 'Setup needed', tone: 'warn' }
  }
  return { label: 'Enabled', tone: 'ok' }
}

export function ProviderSettings(props: ProviderSettingsProps): JSX.Element {
  const { llm, activeId, onSelect } = props
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const query = search.trim().toLowerCase()
  const assigned = new Set([
    llm.tiers.highTier.provider,
    llm.tiers.fastTier.provider,
    ...Object.values(llm.overrides).map((ref) => ref?.provider)
  ])
  const visible = PROVIDERS_ORDERED.filter((provider) => {
    const matches = [provider.label, provider.id, provider.baseUrl, llm.providers[provider.id]?.baseUrl]
      .some((value) => value?.toLowerCase().includes(query))
    if (filter === 'enabled') return matches && llm.providers[provider.id]?.enabled
    if (filter === 'assigned') return matches && assigned.has(provider.id)
    return matches
  })
  const selected = getProvider(activeId) ?? PROVIDERS_ORDERED[0]

  return (
    <div className="provider-settings">
      <div className="provider-workspace">
        <section className="card provider-directory" aria-label="Provider directory">
          <div className="provider-directory-tools col gap-sm">
            <div className="row wrap gap-sm">
              <h2>Providers</h2>
              <span className="spacer" />
              <span className="hint">{Object.values(llm.providers).filter((account) => account?.enabled).length} enabled</span>
            </div>
            <input type="search" aria-label="Search providers" placeholder="Find a provider…" value={search}
              onChange={(e) => setSearch(e.target.value)} />
            <div className="provider-filters" role="group" aria-label="Filter providers">
              {([['all', 'All'], ['enabled', 'Enabled'], ['assigned', 'Assigned']] as const).map(([key, label]) => (
                <button key={key} type="button" className="btn btn-sm" aria-pressed={filter === key}
                  onClick={() => setFilter(key)}>{label}</button>
              ))}
            </div>
          </div>
          <div className="provider-list">
            {PROVIDER_GROUP_ORDER.map((group) => {
              const entries = visible.filter((provider) => provider.group === group)
              if (!entries.length) return null
              return (
                <div className="provider-group" key={group}>
                  <h3>{PROVIDER_GROUP_LABEL[group]}</h3>
                  {entries.map((provider) => {
                    const status = accountStatus(provider, llm.providers[provider.id])
                    return (
                      <button key={provider.id} type="button" className="provider-entry"
                        aria-current={selected.id === provider.id ? 'true' : undefined} onClick={() => onSelect(provider.id)}>
                        <span className="provider-entry-label">{provider.label}</span>
                        <span className="provider-entry-meta">
                          <span className={`provider-dot ${status.tone}`} aria-hidden="true" />{status.label}
                          {assigned.has(provider.id) && <span> · Assigned</span>}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )
            })}
            {!visible.length && <div className="provider-empty-list col gap-sm">
              <p className="hint">No providers match these filters.</p>
              <button type="button" className="btn btn-sm" onClick={() => { setSearch(''); setFilter('all') }}>Show all providers</button>
            </div>}
          </div>
        </section>

        <ProviderDetail key={selected.id} provider={selected} {...props} />
      </div>
    </div>
  )
}

function ProviderDetail({
  provider, llm, discovery, onConnection, onToggle, onRefresh, onShortlist, onAssign, onOpenModels
}: ProviderSettingsProps & { provider: ProviderDefinition }): JSX.Element {
  const id = useId()
  const [revealKey, setRevealKey] = useState(false)
  const [modelId, setModelId] = useState('')
  const modelInput = useRef<HTMLInputElement>(null)
  const account = llm.providers[provider.id]
  const baseUrl = resolveBaseUrl(provider, account?.baseUrl)
  const fetchState = discovery[provider.id]
  const catalog = account?.fetchedModels ?? []
  const shortlist = account?.selectedModels ?? catalog
  const status = accountStatus(provider, account)
  const urlValid = providerCredentialsSchema.safeParse({ apiKey: '', baseUrl: account?.baseUrl?.trim() }).success
  const connectionReady = urlValid && !!baseUrl && (!provider.requiresApiKey || !!account?.apiKey.trim())
  const overrides = Object.entries(llm.overrides).filter(([, ref]) => ref?.provider === provider.id)
  const assignedModelIds = [
    ...TIERS.flatMap(({ key }) => llm.tiers[key].provider === provider.id ? [llm.tiers[key].model] : []),
    ...overrides.flatMap(([, ref]) => ref?.model ? [ref.model] : [])
  ]
  const modelOptions = [...new Set([...effectiveModelIds(provider, account), ...assignedModelIds])].filter(Boolean)

  return (
    <div className="provider-detail col gap-md">
      <section className="card provider-connection col gap-md">
        <header className="provider-detail-header">
          <div>
            <div className="provider-protocol">{provider.id === 'anthropic' ? 'Anthropic API' : 'OpenAI-compatible API'}</div>
            <h2>{provider.label}</h2>
          </div>
          <label className="provider-enable checkbox-row">
            <input type="checkbox" checked={account?.enabled ?? false}
              onChange={(e) => onToggle(provider.id, e.target.checked)} />
            Enable provider
          </label>
        </header>
        <p className="hint">
          {provider.description}
          {provider.docsUrl && <> <a href={provider.docsUrl} target="_blank" rel="noreferrer">API documentation ↗</a></>}
        </p>

        <div className="provider-credentials">
          <div className="field">
            <label htmlFor={`${id}-key`}>API key{!provider.requiresApiKey && ' (optional)'}</label>
            <div className="row gap-sm">
              <input id={`${id}-key`} type={revealKey ? 'text' : 'password'} value={account?.apiKey ?? ''}
                autoComplete="off" spellCheck={false} placeholder={provider.requiresApiKey ? 'Enter provider API key' : 'Keyless connection supported'}
                onChange={(e) => onConnection(provider.id, { apiKey: e.target.value })} />
              <button className="btn" type="button" aria-label={revealKey ? 'Hide API key' : 'Show API key'}
                onClick={() => setRevealKey((visible) => !visible)}>{revealKey ? 'Hide' : 'Show'}</button>
            </div>
          </div>
          <div className="field">
            <label htmlFor={`${id}-url`}>API Base URL</label>
            <div className="row gap-sm">
              <input id={`${id}-url`} type="url" value={account?.baseUrl ?? ''} placeholder={provider.baseUrl || 'https://your-endpoint/v1'}
                aria-invalid={!urlValid} autoComplete="off" spellCheck={false} readOnly={!provider.customBaseUrl}
                onChange={(e) => onConnection(provider.id, { baseUrl: e.target.value || undefined })} />
              {provider.baseUrl && account?.baseUrl && (
                <button className="btn" type="button" aria-label="Restore default Base URL"
                  onClick={() => onConnection(provider.id, { baseUrl: undefined })}>Reset</button>
              )}
            </div>
            {!urlValid && <span className="form-error">Use an HTTP or HTTPS URL without embedded credentials.</span>}
          </div>
        </div>

        <div className="provider-connection-footer">
          <div className="row wrap gap-sm">
            <span className={`badge ${status.tone}`}>{status.label}</span>
            {fetchState === 'loading' && <span className="hint" role="status">Fetching the model catalog…</span>}
            {fetchState && fetchState !== 'loading' && fetchState.ok && (
              <span className="hint" role="status">Catalog verified · {fetchState.models.length} models found</span>
            )}
          </div>
          <button className="btn btn-primary" type="button" disabled={!connectionReady || fetchState === 'loading'}
            onClick={() => onRefresh(provider.id)}>
            <IconRefresh size={14} /> {fetchState === 'loading' ? 'Refreshing…' : 'Refresh models'}
          </button>
        </div>
        {fetchState && fetchState !== 'loading' && !fetchState.ok && (
          <p className="form-error" role="alert">{fetchState.message}</p>
        )}
      </section>

      <section className="card provider-routing col gap-md">
        <header className="row wrap gap-sm">
          <h2>Model routing</h2>
          <span className="spacer" />
          <button type="button" className="btn btn-sm btn-ghost" onClick={onOpenModels}>Model Selection →</button>
        </header>
        <div className="provider-tiers">
          {TIERS.map(({ key, label }) => {
            const ref = llm.tiers[key]
            return (
              <div key={key}>
                <span className="hint">{label}</span>
                <strong title={ref.model}>{ref.provider === provider.id
                  ? ref.model || 'Choose a model'
                  : getProvider(ref.provider)?.label ?? ref.provider}</strong>
              </div>
            )
          })}
        </div>
        {overrides.length > 0 && (
          <p className="hint">Agent overrides · {overrides.map(([agent]) => AGENT_LABELS[agent as keyof typeof AGENT_LABELS]).join(', ')}</p>
        )}
        <div className="field">
          <label htmlFor={`${id}-model`}>Model ID</label>
          <input ref={modelInput} id={`${id}-model`} value={modelId} list={`${id}-models`} autoComplete="off" spellCheck={false}
            onChange={(e) => setModelId(e.target.value)} placeholder="Choose from the catalog or enter an ID" />
          <datalist id={`${id}-models`}>
            {modelOptions.slice(0, 120).map((model) => <option key={model} value={model} />)}
          </datalist>
        </div>
        <div className="row wrap gap-sm">
          {TIERS.map(({ key, label }) => (
            <button className="btn btn-sm" key={key} type="button" disabled={!account?.enabled || !modelId.trim()}
              onClick={() => onAssign(provider.id, modelId.trim(), key)}>Set {label.toLowerCase()}</button>
          ))}
          {!account?.enabled && <span className="hint">Enable this provider to assign a model.</span>}
        </div>
      </section>

      <section className="card provider-catalog col gap-md">
        <header className="row wrap gap-sm">
          <h2>Model catalog</h2>
          {catalog.length > 0 && <span className="hint">{shortlist.length} of {catalog.length} shortlisted</span>}
        </header>
        {catalog.length ? <ModelCatalog
          provider={provider} fetched={catalog} selected={shortlist} onPick={(model) => {
            setModelId(model)
            modelInput.current?.focus()
          }}
          onChange={(models) => onShortlist(provider.id, models)}
        /> : <p className="hint">Refresh models to load this token’s catalog. You can also enter a model ID directly.</p>}
      </section>
    </div>
  )
}

const MODEL_PAGE_SIZE = 60

function ModelCatalog({ provider, fetched, selected, onPick, onChange }: {
  provider: ProviderDefinition
  fetched: string[]
  selected: string[]
  onPick: (id: string) => void
  onChange: (ids: string[]) => void
}): JSX.Element {
  const [search, setSearch] = useState('')
  const [shortlistedOnly, setShortlistedOnly] = useState(false)
  const [limit, setLimit] = useState(MODEL_PAGE_SIZE)
  const selectedIds = new Set(selected)
  const query = search.trim().toLowerCase()
  const matches = fetched.filter((id) =>
    (!shortlistedOnly || selectedIds.has(id)) &&
    (id.toLowerCase().includes(query) || modelLabelFor(provider, id).toLowerCase().includes(query))
  )
  const matchedIds = new Set(matches)
  return (
    <div className="col gap-sm">
      <div className="row wrap gap-sm provider-model-tools">
        <input type="search" aria-label="Search model catalog" placeholder="Search model IDs…"
          value={search} onChange={(e) => { setSearch(e.target.value); setLimit(MODEL_PAGE_SIZE) }} />
        <label className="checkbox-row">
          <input type="checkbox" checked={shortlistedOnly}
            onChange={(e) => { setShortlistedOnly(e.target.checked); setLimit(MODEL_PAGE_SIZE) }} />
          Shortlisted only
        </label>
      </div>
      <div className="row wrap gap-sm">
        <button type="button" className="btn btn-sm btn-ghost" disabled={!matches.length}
          onClick={() => onChange([...new Set([...selected, ...matches])])}>Select matches</button>
        <button type="button" className="btn btn-sm btn-ghost" disabled={!matches.some((model) => selectedIds.has(model))}
          onClick={() => onChange(selected.filter((model) => !matchedIds.has(model)))}>Clear matches</button>
        <button type="button" className="btn btn-sm btn-ghost"
          onClick={() => onChange(defaultSelectedModels(provider, fetched))}>Suggested shortlist</button>
      </div>
      {matches.length ? (
        <div className="model-checklist" tabIndex={0} role="region" aria-label="Discovered models">
          {matches.slice(0, limit).map((model) => (
            <div key={model} className="model-check">
              <input type="checkbox" checked={selectedIds.has(model)} aria-label={`Shortlist ${model}`}
                onChange={() => onChange(selectedIds.has(model) ? selected.filter((id) => id !== model) : [...selected, model])} />
              <span className="model-check-id">{model}</span>
              <span className="spacer" />
              <button className="btn btn-sm btn-ghost" type="button" aria-label={`Use ${model} for routing`}
                onClick={() => onPick(model)}>Use ID</button>
            </div>
          ))}
        </div>
      ) : <p className="hint">No models match this filter.</p>}
      {limit < matches.length && <div>
        <button className="btn btn-sm" type="button" onClick={() => setLimit(limit + MODEL_PAGE_SIZE)}>
          Show more ({limit} of {matches.length})
        </button>
      </div>}
    </div>
  )
}
