import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { IconCheck, IconRefresh } from '../components/Icons'
import {
  AGENT_LABELS,
  type AgentRole,
  type AppSettings,
  type LLMProvider,
  type ModelRef,
  type UiTheme
} from '@shared/domain'
import { modelCapabilities } from '@shared/models'
import type { LlmPingResult, McpTestResult, McpTool, ModelListResult } from '@shared/ipc'
import {
  PROVIDERS,
  PROVIDERS_ORDERED,
  defaultFastTierModel,
  defaultHighTierModel,
  getProvider,
  providerModelOptions,
  type ProviderDefinition
} from '@shared/providers'

const OVERRIDABLE: AgentRole[] = ['generation', 'reflection', 'ranking', 'proximity', 'evolution', 'meta-review']

const THEME_OPTIONS: { value: UiTheme; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' }
]

type TabKey = 'providers' | 'models' | 'appearance' | 'engine' | 'grounding'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'providers', label: 'Providers' },
  { key: 'models', label: 'Model Selection' },
  { key: 'appearance', label: 'Appearance' },
  { key: 'engine', label: 'Engine' },
  { key: 'grounding', label: 'MCP Servers' }
]

/** Human-readable token count, e.g. 128000 → "128K", 1000000 → "1M". */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

function ModelLimitsHint({ model }: { model: string }): JSX.Element {
  const caps = modelCapabilities(model)
  return (
    <span className="hint">
      Detected limits: {fmtTokens(caps.contextWindow)} context · {fmtTokens(caps.maxOutput)} max output. Requests are clamped to
      this automatically.
    </span>
  )
}

export function Settings(): JSX.Element {
  const { settings, setSettings } = useStore()
  const [draft, setDraft] = useState<AppSettings | null>(settings ? structuredClone(settings) : null)
  const [saved, setSaved] = useState(false)
  const [tab, setTab] = useState<TabKey>('providers')
  const [tests, setTests] = useState<Record<string, McpTestResult | 'loading'>>({})
  const [llmTest, setLlmTest] = useState<LlmPingResult | 'loading' | null>(null)
  const [modelFetch, setModelFetch] = useState<Record<string, ModelListResult | 'loading'>>({})

  // Reset the LLM ping result when the selected tier providers/models change so
  // stale green badges don't linger.
  const tierKey = draft
    ? `${draft.llm.tiers.highTier.provider}:${draft.llm.tiers.highTier.model}|${draft.llm.tiers.fastTier.provider}:${draft.llm.tiers.fastTier.model}`
    : ''
  useEffect(() => {
    setLlmTest(null)
  }, [tierKey])

  if (!draft) return <div className="page">Loading…</div>

  const patch = (fn: (d: AppSettings) => void) => {
    const next = structuredClone(draft)
    fn(next)
    setDraft(next)
    setSaved(false)
  }

  const save = async () => {
    const result = await window.api.saveSettings(draft)
    setSettings(result)
    setDraft(structuredClone(result))
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const testMcp = async (server: 'deepResearch' | 'codexomics') => {
    await window.api.saveSettings(draft)
    setSettings(draft)
    setTests((t) => ({ ...t, [server]: 'loading' }))
    const res = await window.api.testMcp(server)
    setTests((t) => ({ ...t, [server]: res }))
  }

  const testLlm = async () => {
    await window.api.saveSettings(draft)
    setSettings(draft)
    setLlmTest('loading')
    const res = await window.api.pingLlm()
    setLlmTest(res)
  }

  /** Refresh a provider's available models, persisting credentials + result. */
  const refreshModels = async (id: LLMProvider) => {
    // Persist current edits so the main process tests with fresh credentials.
    const persisted = await window.api.saveSettings(draft)
    setSettings(persisted)
    setModelFetch((s) => ({ ...s, [id]: 'loading' }))
    const res = await window.api.listProviderModels(id)
    setModelFetch((s) => ({ ...s, [id]: res }))
    if (res.ok) {
      const next = structuredClone(draft)
      const acct = (next.llm.providers[id] ??= { enabled: true, apiKey: '' })
      acct.fetchedModels = res.models
      acct.enabled = true
      setDraft(next)
      const saved2 = await window.api.saveSettings(next)
      setSettings(saved2)
    }
  }

  /** Mutate (creating if needed) a provider account in the draft. */
  const mutateAccount = (id: LLMProvider, fn: (a: NonNullable<AppSettings['llm']['providers'][LLMProvider]>) => void) =>
    patch((d) => {
      const a = (d.llm.providers[id] ??= { enabled: false, apiKey: '' })
      fn(a)
    })

  return (
    <div className="page page-narrow col gap-lg">
      <div className="row">
        <h2 style={{ fontSize: 'var(--fs-xl)' }}>Settings</h2>
        <span className="spacer" />
        {saved && (
          <span className="badge ok">
            <IconCheck size={12} /> Saved
          </span>
        )}
        <button className="btn btn-primary" onClick={save}>
          Save changes
        </button>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`tab${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'providers' && (
        <ProvidersTab draft={draft} modelFetch={modelFetch} mutateAccount={mutateAccount} onRefresh={refreshModels} />
      )}
      {tab === 'models' && (
        <ModelsTab draft={draft} patch={patch} llmTest={llmTest} onTest={testLlm} />
      )}
      {tab === 'appearance' && <AppearanceTab draft={draft} patch={patch} />}
      {tab === 'engine' && <EngineTab draft={draft} patch={patch} />}
      {tab === 'grounding' && <GroundingTab draft={draft} patch={patch} tests={tests} onTestMcp={testMcp} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Providers tab — configure each provider's credentials & discovered models
// ---------------------------------------------------------------------------

function ProvidersTab({
  draft,
  modelFetch,
  mutateAccount,
  onRefresh
}: {
  draft: AppSettings
  modelFetch: Record<string, ModelListResult | 'loading'>
  mutateAccount: (id: LLMProvider, fn: (a: NonNullable<AppSettings['llm']['providers'][LLMProvider]>) => void) => void
  onRefresh: (id: LLMProvider) => void
}): JSX.Element {
  return (
    <div className="col gap-md">
      <p className="faint" style={{ fontSize: 'var(--fs-sm)', margin: 0 }}>
        Enable the providers you want to use and add their credentials. Use <strong>Refresh models</strong> to fetch each
        provider's live model list — those models then become selectable on the Model Selection tab.
      </p>
      {PROVIDERS_ORDERED.map((provider) => (
        <div key={provider.id} className="card pad-lg">
          <ProviderCard
            provider={provider}
            account={draft.llm.providers[provider.id as LLMProvider]}
            fetchState={modelFetch[provider.id]}
            onToggle={(v) => mutateAccount(provider.id as LLMProvider, (a) => (a.enabled = v))}
            onKey={(v) => mutateAccount(provider.id as LLMProvider, (a) => (a.apiKey = v))}
            onUrl={(v) => mutateAccount(provider.id as LLMProvider, (a) => (a.baseUrl = v || undefined))}
            onRefresh={() => onRefresh(provider.id as LLMProvider)}
          />
        </div>
      ))}
    </div>
  )
}

function ProviderCard({
  provider,
  account,
  fetchState,
  onToggle,
  onKey,
  onUrl,
  onRefresh
}: {
  provider: ProviderDefinition
  account: AppSettings['llm']['providers'][LLMProvider]
  fetchState?: ModelListResult | 'loading'
  onToggle: (v: boolean) => void
  onKey: (v: string) => void
  onUrl: (v: string) => void
  onRefresh: () => void
}): JSX.Element {
  const enabled = account?.enabled ?? false
  return (
    <div>
      <div className="row" style={{ alignItems: 'center' }}>
        <label className="checkbox-row" style={{ fontWeight: 600 }}>
          <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
          {provider.label}
        </label>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={onRefresh} disabled={fetchState === 'loading'}>
          <IconRefresh size={13} /> {fetchState === 'loading' ? 'Refreshing…' : 'Refresh models'}
        </button>
      </div>
      <p className="hint" style={{ marginTop: 4, marginBottom: enabled ? 12 : 0 }}>
        {provider.description}
      </p>
      {enabled && (
        <>
          <div className="grid grid-2">
            <div className="field">
              <label>
                API key
                {provider.envHint && (
                  <span className="hint" style={{ marginLeft: 6 }}>
                    ({provider.envHint})
                  </span>
                )}
              </label>
              <input
                type="password"
                value={account?.apiKey ?? ''}
                onChange={(e) => onKey(e.target.value)}
                placeholder={provider.requiresApiKey === false ? 'optional' : 'sk-…'}
              />
              {provider.requiresApiKey === false && (
                <span className="hint">Optional for local servers without auth.</span>
              )}
            </div>
            <div className="field">
              <label>Base URL</label>
              <div className="row" style={{ gap: 6 }}>
                <input
                  value={account?.baseUrl ?? ''}
                  onChange={(e) => onUrl(e.target.value)}
                  placeholder={provider.baseUrl || 'https://your-endpoint/v1'}
                />
                {provider.baseUrl && (
                  <button type="button" className="btn btn-sm" title="Reset to provider default" onClick={() => onUrl('')}>
                    Reset
                  </button>
                )}
              </div>
              {provider.baseUrl && <span className="hint">Default: {provider.baseUrl}</span>}
            </div>
          </div>
          {fetchState && fetchState !== 'loading' && (
            <div className={`badge ${fetchState.ok ? 'ok' : 'err'}`} style={{ display: 'inline-flex' }}>
              {fetchState.ok ? `Connected · ${fetchState.models.length} models` : `Failed: ${fetchState.message}`}
            </div>
          )}
          {account?.fetchedModels?.length ? (
            <span className="hint" style={{ display: 'block', marginTop: 6 }}>
              {account.fetchedModels.length} models cached and available for selection.
            </span>
          ) : null}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Model Selection tab — assign tier defaults & per-agent overrides
// ---------------------------------------------------------------------------

function ModelsTab({
  draft,
  patch,
  llmTest,
  onTest
}: {
  draft: AppSettings
  patch: (fn: (d: AppSettings) => void) => void
  llmTest: LlmPingResult | 'loading' | null
  onTest: () => void
}): JSX.Element {
  // Providers offered in the selectors: all enabled ones, plus any already
  // referenced by a tier/override (so an existing selection never disappears).
  const selectable = useMemo<ProviderDefinition[]>(() => {
    const ids = new Set<LLMProvider>()
    for (const p of PROVIDERS) if (draft.llm.providers[p.id as LLMProvider]?.enabled) ids.add(p.id as LLMProvider)
    ids.add(draft.llm.tiers.highTier.provider)
    ids.add(draft.llm.tiers.fastTier.provider)
    for (const a of OVERRIDABLE) {
      const r = draft.llm.overrides[a]
      if (r) ids.add(r.provider)
    }
    return PROVIDERS_ORDERED.filter((p) => ids.has(p.id as LLMProvider))
  }, [draft])

  const noneEnabled = !PROVIDERS.some((p) => draft.llm.providers[p.id as LLMProvider]?.enabled)

  return (
    <div className="col gap-lg">
      <div className="card pad-lg">
        <div className="row" style={{ marginBottom: 14 }}>
          <div className="card-title">Tier models</div>
          <span className="spacer" />
          <button className="btn btn-sm" onClick={onTest} disabled={llmTest === 'loading'}>
            <IconRefresh size={13} /> {llmTest === 'loading' ? 'Testing…' : 'Test connection'}
          </button>
        </div>
        {noneEnabled && (
          <div className="badge warn" style={{ display: 'inline-flex', marginBottom: 14 }}>
            No providers enabled — enable one on the Providers tab first.
          </div>
        )}
        {llmTest && llmTest !== 'loading' && (
          <div className={`badge ${llmTest.ok ? 'ok' : 'err'}`} style={{ marginBottom: 14, display: 'inline-flex' }}>
            {llmTest.ok
              ? `Connected · "${llmTest.message}"${llmTest.model ? ` · ${llmTest.model}` : ''}`
              : `Failed: ${llmTest.message}`}
          </div>
        )}

        <div className="grid grid-2">
          <ModelRefField
            label="High-tier model (Generation / Reflection / Meta-review)"
            value={draft.llm.tiers.highTier}
            selectable={selectable}
            accounts={draft.llm.providers}
            defaultTier="high"
            onChange={(ref) => patch((d) => (d.llm.tiers.highTier = ref))}
          />
          <ModelRefField
            label="Fast-tier model (Ranking / Proximity / Evolution)"
            value={draft.llm.tiers.fastTier}
            selectable={selectable}
            accounts={draft.llm.providers}
            defaultTier="fast"
            onChange={(ref) => patch((d) => (d.llm.tiers.fastTier = ref))}
          />
        </div>

        <div className="grid grid-2">
          <div className="field">
            <label>Max output tokens (fallback)</label>
            <input
              type="number"
              min={512}
              max={384000}
              value={draft.llm.maxTokens}
              onChange={(e) => patch((d) => (d.llm.maxTokens = +e.target.value))}
            />
            <span className="hint">Default ceiling when an agent doesn't request its own; always clamped to the model's max output.</span>
          </div>
          <div className="field">
            <label>Temperature (OpenAI-compatible only)</label>
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={draft.llm.temperature}
              onChange={(e) => patch((d) => (d.llm.temperature = +e.target.value))}
            />
            <span className="hint">Honoured by OpenAI-compatible providers. Ignored for Claude (Opus 4.8 removes sampling params).</span>
          </div>
        </div>
      </div>

      <div className="card pad-lg">
        <div className="card-title" style={{ marginBottom: 6 }}>
          Per-agent model overrides
        </div>
        <p className="faint" style={{ fontSize: 'var(--fs-sm)', marginTop: 0, marginBottom: 14 }}>
          Optionally route an individual agent to a specific provider + model. Leave the model blank to use the tier default.
        </p>
        <div className="grid grid-2">
          {OVERRIDABLE.map((a) => {
            const ref = draft.llm.overrides[a]
            return (
              <ModelRefField
                key={a}
                label={AGENT_LABELS[a]}
                value={ref ?? { provider: draft.llm.tiers.highTier.provider, model: '' }}
                selectable={selectable}
                accounts={draft.llm.providers}
                defaultTier="high"
                placeholder="(use tier default)"
                onChange={(next) =>
                  patch((d) => {
                    if (next.model.trim()) d.llm.overrides[a] = next
                    else delete d.llm.overrides[a]
                  })
                }
                onClear={ref ? () => patch((d) => delete d.llm.overrides[a]) : undefined}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

function ModelRefField({
  label,
  value,
  selectable,
  accounts,
  defaultTier,
  placeholder,
  onChange,
  onClear
}: {
  label: string
  value: ModelRef
  selectable: ProviderDefinition[]
  accounts: AppSettings['llm']['providers']
  defaultTier: 'high' | 'fast'
  placeholder?: string
  onChange: (ref: ModelRef) => void
  onClear?: () => void
}): JSX.Element {
  const listId = useMemo(() => `models-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`, [label])
  const provDef = getProvider(value.provider)
  const options = providerModelOptions(provDef, accounts[value.provider]?.fetchedModels)

  const changeProvider = (id: LLMProvider) => {
    const def = getProvider(id)
    const model = def ? (defaultTier === 'high' ? defaultHighTierModel(def) : defaultFastTierModel(def)) : ''
    onChange({ provider: id, model })
  }

  return (
    <div className="field">
      <label>{label}</label>
      <div className="row" style={{ gap: 6 }}>
        <select
          value={value.provider}
          onChange={(e) => changeProvider(e.target.value as LLMProvider)}
          style={{ flex: '0 0 36%' }}
        >
          {selectable.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <input
          list={options.length > 0 ? listId : undefined}
          value={value.model}
          onChange={(e) => onChange({ provider: value.provider, model: e.target.value })}
          placeholder={placeholder ?? 'model id'}
        />
        {onClear && (
          <button type="button" className="btn btn-sm" title="Clear override (use tier default)" onClick={onClear}>
            Default
          </button>
        )}
      </div>
      {options.length > 0 && (
        <datalist id={listId}>
          {options.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </datalist>
      )}
      {value.model.trim() ? <ModelLimitsHint model={value.model} /> : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Appearance tab
// ---------------------------------------------------------------------------

function AppearanceTab({
  draft,
  patch
}: {
  draft: AppSettings
  patch: (fn: (d: AppSettings) => void) => void
}): JSX.Element {
  return (
    <div className="card pad-lg">
      <div className="card-title" style={{ marginBottom: 6 }}>
        Appearance
      </div>
      <p className="faint" style={{ fontSize: 'var(--fs-sm)', marginTop: 0, marginBottom: 14 }}>
        Choose the interface colour theme. Applies instantly.
      </p>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>UI style</label>
        <div className="row gap-sm" role="radiogroup" aria-label="UI style">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={draft.ui.theme === opt.value}
              className={`btn${draft.ui.theme === opt.value ? ' btn-primary' : ''}`}
              onClick={() => {
                patch((d) => (d.ui.theme = opt.value))
                document.documentElement.setAttribute('data-theme', opt.value)
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <span className="hint">Light theme uses the same teal accent on bright surfaces.</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Engine tab
// ---------------------------------------------------------------------------

function EngineTab({
  draft,
  patch
}: {
  draft: AppSettings
  patch: (fn: (d: AppSettings) => void) => void
}): JSX.Element {
  return (
    <div className="card pad-lg">
      <div className="card-title" style={{ marginBottom: 14 }}>
        Engine
      </div>
      <div className="field">
        <label>Worker concurrency</label>
        <input
          type="number"
          min={1}
          max={8}
          value={draft.run.concurrency}
          onChange={(e) => patch((d) => (d.run.concurrency = +e.target.value))}
        />
        <span className="hint">Max simultaneous agent tasks.</span>
      </div>
      <label className="checkbox-row" style={{ marginTop: 6 }}>
        <input
          type="checkbox"
          checked={draft.safety.enforceBiosafety}
          onChange={(e) => patch((d) => (d.safety.enforceBiosafety = e.target.checked))}
        />
        Enforce biosafety gate (auto-reject low-safety designs)
      </label>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Grounding tab — MCP servers
// ---------------------------------------------------------------------------

function GroundingTab({
  draft,
  patch,
  tests,
  onTestMcp
}: {
  draft: AppSettings
  patch: (fn: (d: AppSettings) => void) => void
  tests: Record<string, McpTestResult | 'loading'>
  onTestMcp: (server: 'deepResearch' | 'codexomics') => void
}): JSX.Element {
  return (
    <div className="card pad-lg">
      <div className="card-title" style={{ marginBottom: 6 }}>
        Grounding — MCP servers
      </div>
      <p className="faint" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>
        Optional. Connect the deep-research server for literature grounding and CodeXomics for genomic data &amp; construct
        design.
      </p>
      <McpRow
          label="Deep Research (literature)"
          cfg={draft.mcp.deepResearch}
          onToggle={(v) => patch((d) => (d.mcp.deepResearch.enabled = v))}
          onUrl={(v) => patch((d) => (d.mcp.deepResearch.url = v))}
          onToken={(v) => patch((d) => (d.mcp.deepResearch.accessToken = v || undefined))}
          result={tests.deepResearch}
          onTest={() => onTestMcp('deepResearch')}
        />
        <div className="divider" />
        <McpRow
          label="CodeXomics (genomics)"
          cfg={draft.mcp.codexomics}
          onToggle={(v) => patch((d) => (d.mcp.codexomics.enabled = v))}
          onUrl={(v) => patch((d) => (d.mcp.codexomics.url = v))}
          onToken={(v) => patch((d) => (d.mcp.codexomics.accessToken = v || undefined))}
          result={tests.codexomics}
          onTest={() => onTestMcp('codexomics')}
        />
    </div>
  )
}

function ToolList({ tools }: { tools: McpTool[] }): JSX.Element {
  return (
    <div className="tool-list">
      {tools.map((t) => (
        <div key={t.name} className="tool-item">
          <span className="tool-name">{t.name}</span>
          {t.description && <span className="tool-desc">{t.description}</span>}
        </div>
      ))}
    </div>
  )
}

function McpRow({
  label,
  cfg,
  onToggle,
  onUrl,
  onToken,
  result,
  onTest
}: {
  label: string
  cfg: { enabled: boolean; url: string; accessToken?: string }
  onToggle: (v: boolean) => void
  onUrl: (v: string) => void
  onToken: (v: string) => void
  result?: McpTestResult | 'loading'
  onTest: () => void
}): JSX.Element {
  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <label className="checkbox-row" style={{ fontWeight: 600 }}>
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => onToggle(e.target.checked)} />
          {label}
        </label>
        <span className="spacer" />
        <button className="btn btn-sm" disabled={!cfg.enabled || result === 'loading'} onClick={onTest}>
          <IconRefresh size={13} /> {result === 'loading' ? 'Testing…' : 'Test connection'}
        </button>
      </div>
      <div className="grid grid-2">
        <div className="field" style={{ marginBottom: 8 }}>
          <input value={cfg.url} onChange={(e) => onUrl(e.target.value)} placeholder="server URL" disabled={!cfg.enabled} />
        </div>
        <div className="field" style={{ marginBottom: 8 }}>
          <input
            type="password"
            value={cfg.accessToken ?? ''}
            onChange={(e) => onToken(e.target.value)}
            placeholder="access token (optional)"
            disabled={!cfg.enabled}
          />
        </div>
      </div>
      {result && result !== 'loading' && (
        <>
          <div className={`badge ${result.ok ? 'ok' : 'err'}`} style={{ marginBottom: result.ok && result.tools?.length ? 10 : 0 }}>
            {result.ok ? `Connected · ${result.toolCount ?? 0} tools` : `Failed: ${result.message}`}
          </div>
          {result.ok && result.tools?.length ? (
            <ToolList tools={result.tools} />
          ) : null}
        </>
      )}
    </div>
  )
}
