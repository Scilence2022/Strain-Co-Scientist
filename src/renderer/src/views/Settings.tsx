import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { IconCheck, IconRefresh } from '../components/Icons'
import { ProviderSettings, type ModelDiscovery } from './ProviderSettings'
import {
  AGENT_LABELS,
  type AgentRole,
  type AppSettings,
  type LLMProvider,
  type ModelRef,
  type ProviderAccountConfig,
  type UiTheme
} from '@shared/domain'
import { modelCapabilities } from '@shared/models'
import type { LlmPingResult, McpTestResult, McpTool, ProviderCredentials, ProviderModelProbe } from '@shared/ipc'
import {
  PROVIDERS,
  PROVIDERS_ORDERED,
  defaultFastTierModel,
  defaultHighTierModel,
  defaultSelectedModels,
  effectiveModelIds,
  getProvider,
  modelLabelFor,
  resolveBaseUrl,
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

function credentials(account?: ProviderAccountConfig): ProviderCredentials {
  return { apiKey: account?.apiKey.trim() ?? '', baseUrl: account?.baseUrl?.trim() || undefined }
}

export function Settings(): JSX.Element {
  const { settings, setSettings } = useStore()
  const [draft, setDraft] = useState<AppSettings | null>(settings ? structuredClone(settings) : null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string>()
  const [tab, setTab] = useState<TabKey>('providers')
  const [providerId, setProviderId] = useState<LLMProvider>(settings?.llm.tiers.fastTier.provider ?? 'anthropic')
  const [tests, setTests] = useState<Record<string, McpTestResult | 'loading'>>({})
  const [llmTest, setLlmTest] = useState<{ probe: ProviderModelProbe; result: LlmPingResult | 'loading' }>()
  const [modelFetch, setModelFetch] = useState<ModelDiscovery>({})
  const requests = useRef(new Map<LLMProvider, symbol>())

  if (!draft) return <div className="page">Loading…</div>

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings)
  const fastTier = draft.llm.tiers.fastTier
  const fastAccount = draft.llm.providers[fastTier.provider]
  const fastProbe = { ...fastTier, ...credentials(fastAccount) }
  const testResult = fastAccount?.enabled && JSON.stringify(llmTest?.probe) === JSON.stringify(fastProbe)
    ? llmTest?.result ?? null
    : null

  const patch = (fn: (d: AppSettings) => void) => {
    setDraft((current) => {
      if (!current) return current
      const next = structuredClone(current)
      fn(next)
      return next
    })
    setSaved(false)
    setSaveError(undefined)
  }

  const save = async () => {
    if (saving || !dirty) return
    setSaving(true)
    setSaveError(undefined)
    try {
      const result = await window.api.saveSettings(draft)
      setSettings(result)
      setDraft((current) => current === draft ? structuredClone(result) : current)
      setSaved(true)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const testMcp = async (server: 'deepResearch' | 'codexomics') => {
    setTests((t) => ({ ...t, [server]: 'loading' }))
    try {
      const res = await window.api.testMcp(server, draft.mcp[server])
      setTests((t) => ({ ...t, [server]: res }))
    } catch (err) {
      setTests((t) => ({ ...t, [server]: { server, ok: false, message: String(err) } }))
    }
  }

  const testLlm = async () => {
    if (testResult === 'loading') return
    setLlmTest({ probe: fastProbe, result: 'loading' })
    const result = await window.api.pingLlm(fastProbe).catch((err: unknown) => ({ ok: false, message: String(err) }))
    setLlmTest((current) => current?.probe === fastProbe ? { probe: fastProbe, result } : current)
  }

  const refreshModels = async (id: LLMProvider) => {
    if (requests.current.has(id)) return
    const request = Symbol()
    requests.current.set(id, request)
    setModelFetch((s) => ({ ...s, [id]: 'loading' }))
    try {
      const res = await window.api.listProviderModels(id, credentials(draft.llm.providers[id]))
      if (requests.current.get(id) !== request) return
      setModelFetch((s) => ({ ...s, [id]: res }))
      if (res.ok) mutateAccount(id, (account) => {
        const available = new Set(res.models)
        account.fetchedModels = res.models
        account.selectedModels = account.selectedModels
          ? account.selectedModels.filter((model) => available.has(model))
          : defaultSelectedModels(getProvider(id), res.models)
      })
    } catch (err) {
      if (requests.current.get(id) === request) {
        setModelFetch((s) => ({ ...s, [id]: { ok: false, models: [], message: String(err) } }))
      }
    } finally {
      if (requests.current.get(id) === request) requests.current.delete(id)
    }
  }

  const mutateAccount = (id: LLMProvider, fn: (account: ProviderAccountConfig) => void) =>
    patch((d) => fn(d.llm.providers[id] ??= { enabled: false, apiKey: '' }))

  const changeConnection = (id: LLMProvider, changes: Partial<ProviderCredentials>) => {
    const provider = getProvider(id)!
    const account = draft.llm.providers[id]
    const next = { ...credentials(account), ...changes }
    const matches = (candidate?: ProviderAccountConfig) =>
      next.apiKey.trim() === credentials(candidate).apiKey &&
      resolveBaseUrl(provider, next.baseUrl) === resolveBaseUrl(provider, candidate?.baseUrl)
    const changed = !matches(account)
    if (changed) {
      requests.current.delete(id)
      setModelFetch((state) => ({ ...state, [id]: undefined }))
      setLlmTest((current) => current?.probe.provider === id ? undefined : current)
    }
    mutateAccount(id, (a) => {
      Object.assign(a, changes)
      if (changed) {
        const persisted = settings?.llm.providers[id]
        const matchingAccount = matches(persisted) ? persisted : undefined
        a.fetchedModels = matchingAccount?.fetchedModels
        a.selectedModels = matchingAccount?.selectedModels
      }
    })
  }

  return (
    <div className="page settings-page col gap-lg">
      <div className="row wrap gap-sm">
        <h1>Settings</h1>
        <span className="spacer" />
        {dirty ? <span className="hint" role="status">Unsaved changes</span> : saved && (
          <span className="badge ok" role="status"><IconCheck size={12} /> Saved</span>
        )}
        <button className="btn btn-primary" onClick={save} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>

      {saveError && <p className="form-error" role="alert">{saveError}</p>}

      <div className="tabs" role="tablist" aria-label="Settings sections">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key}
            className={`tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'providers' && (
        <ProviderSettings llm={draft.llm} activeId={providerId} onSelect={setProviderId} discovery={modelFetch}
          onConnection={changeConnection}
          onToggle={(id, enabled) => mutateAccount(id, (account) => { account.enabled = enabled })}
          onRefresh={refreshModels}
          onShortlist={(id, models) => mutateAccount(id, (account) => { account.selectedModels = models })}
          onAssign={(provider, model, tier) => patch((d) => { d.llm.tiers[tier] = { provider, model } })}
          onOpenModels={() => setTab('models')} />
      )}
      {tab === 'models' && (
        <ModelsTab draft={draft} patch={patch} llmTest={testResult} onTest={testLlm} />
      )}
      {tab === 'appearance' && <AppearanceTab draft={draft} patch={patch} />}
      {tab === 'engine' && <EngineTab draft={draft} patch={patch} />}
      {tab === 'grounding' && <GroundingTab draft={draft} patch={patch} tests={tests} onTestMcp={testMcp} />}
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
    for (const p of PROVIDERS) if (draft.llm.providers[p.id]?.enabled) ids.add(p.id)
    ids.add(draft.llm.tiers.highTier.provider)
    ids.add(draft.llm.tiers.fastTier.provider)
    for (const a of OVERRIDABLE) {
      const r = draft.llm.overrides[a]
      if (r) ids.add(r.provider)
    }
    return PROVIDERS_ORDERED.filter((p) => ids.has(p.id))
  }, [draft])

  const noneEnabled = !PROVIDERS.some((p) => draft.llm.providers[p.id]?.enabled)

  return (
    <div className="col gap-lg">
      <div className="card pad-lg">
        <div className="row" style={{ marginBottom: 14 }}>
          <div className="card-title">Tier models</div>
          <span className="spacer" />
          <button className="btn btn-sm" onClick={onTest} disabled={llmTest === 'loading' ||
            !draft.llm.providers[draft.llm.tiers.fastTier.provider]?.enabled || !draft.llm.tiers.fastTier.model.trim()}>
            <IconRefresh size={13} /> {llmTest === 'loading' ? 'Testing…' : 'Test fast-tier model'}
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
            <label>Max output tokens</label>
            <label className="checkbox-row" style={{ marginBottom: draft.llm.maxTokens > 0 ? 8 : 0 }}>
              <input
                type="checkbox"
                checked={draft.llm.maxTokens <= 0}
                onChange={(e) => patch((d) => (d.llm.maxTokens = e.target.checked ? 0 : 8192))}
              />
              Auto — use each model's detected max output
            </label>
            {draft.llm.maxTokens > 0 && (
              <input
                type="number"
                min={512}
                max={384000}
                value={draft.llm.maxTokens}
                onChange={(e) => patch((d) => (d.llm.maxTokens = +e.target.value))}
              />
            )}
            <span className="hint">
              {draft.llm.maxTokens > 0
                ? "Caps the output budget when an agent doesn't request its own — still clamped down to the model's detected max output."
                : "Each request uses the model's full detected max output. Uncheck to cap it lower (e.g. to reduce cost or latency)."}
            </span>
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
  const isOverride = placeholder !== undefined
  // For overrides with no committed model, the provider is held locally so the
  // dropdown doesn't snap back to the tier default before a model is picked.
  const [prov, setProv] = useState<LLMProvider>(value.provider)
  const [custom, setCustom] = useState(false)
  useEffect(() => {
    if (value.model) setProv(value.provider)
  }, [value.provider, value.model])

  const activeProvider = value.model ? value.provider : prov
  const activeDef = getProvider(activeProvider)
  const ids = effectiveModelIds(activeDef, accounts[activeProvider])
  const curModel = value.provider === activeProvider ? value.model : ''
  // Keep a committed-but-unlisted model (e.g. a custom id) visible in the list.
  const listedIds = curModel && !ids.includes(curModel) ? [curModel, ...ids] : ids
  const allowCustom = activeDef?.customModels ?? true

  const changeProvider = (id: LLMProvider) => {
    setCustom(false)
    setProv(id)
    const def = getProvider(id)
    if (isOverride) {
      onChange({ provider: id, model: '' })
      return
    }
    const next = effectiveModelIds(def, accounts[id])
    const preferred = def ? (defaultTier === 'high' ? defaultHighTierModel(def) : defaultFastTierModel(def)) : ''
    const model = next.includes(preferred) ? preferred : next[0] ?? ''
    if (!model && def?.customModels) setCustom(true)
    onChange({ provider: id, model })
  }

  const changeModel = (v: string) => {
    if (v === '__custom__') {
      setCustom(true)
      return
    }
    setCustom(false)
    onChange({ provider: activeProvider, model: v })
  }

  return (
    <div className="field">
      <label>{label}</label>
      <div className="row" style={{ gap: 6 }}>
        <select value={activeProvider} onChange={(e) => changeProvider(e.target.value as LLMProvider)} style={{ flex: '0 0 36%' }}>
          {selectable.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <select value={custom ? '__custom__' : curModel} onChange={(e) => changeModel(e.target.value)} style={{ flex: 1 }}>
          {isOverride && <option value="">{placeholder ?? '(use tier default)'}</option>}
          {listedIds.length === 0 && !isOverride && (
            <option value="" disabled>
              No models — refresh on Providers tab
            </option>
          )}
          {listedIds.map((id) => (
            <option key={id} value={id}>
              {modelLabelFor(activeDef, id)}
            </option>
          ))}
          {allowCustom && <option value="__custom__">Custom model id…</option>}
        </select>
        {onClear && (
          <button type="button" className="btn btn-sm" title="Clear override (use tier default)" onClick={onClear}>
            Default
          </button>
        )}
      </div>
      {custom && (
        <input
          value={curModel}
          autoFocus
          placeholder="custom model id (e.g. gpt-4o, deepseek-chat)"
          onChange={(e) => onChange({ provider: activeProvider, model: e.target.value })}
        />
      )}
      {curModel.trim() ? <ModelLimitsHint model={curModel} /> : null}
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
