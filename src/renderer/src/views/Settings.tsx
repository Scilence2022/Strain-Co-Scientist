import { useState } from 'react'
import { useStore } from '../store/useStore'
import { IconCheck, IconRefresh } from '../components/Icons'
import { AGENT_LABELS, type AgentRole, type AppSettings, type LLMProvider } from '@shared/domain'
import { modelCapabilities } from '@shared/models'
import type { McpTestResult } from '@shared/ipc'

const OVERRIDABLE: AgentRole[] = ['generation', 'reflection', 'ranking', 'proximity', 'evolution', 'meta-review']

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
  const [tests, setTests] = useState<Record<string, McpTestResult | 'loading'>>({})

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

  const test = async (server: 'deepResearch' | 'codexomics') => {
    await window.api.saveSettings(draft) // ensure current URLs are persisted before testing
    setSettings(draft)
    setTests((t) => ({ ...t, [server]: 'loading' }))
    const res = await window.api.testMcp(server)
    setTests((t) => ({ ...t, [server]: res }))
  }

  return (
    <div className="page page-narrow col gap-lg">
      <div className="row">
        <h2 style={{ fontSize: 'var(--fs-xl)' }}>Settings</h2>
        <span className="spacer" />
        {saved && <span className="badge ok"><IconCheck size={12} /> Saved</span>}
        <button className="btn btn-primary" onClick={save}>Save changes</button>
      </div>

      {/* LLM */}
      <div className="card pad-lg">
        <div className="card-title" style={{ marginBottom: 14 }}>Language model</div>
        <div className="grid grid-2">
          <div className="field">
            <label>Provider</label>
            <select value={draft.llm.provider} onChange={(e) => patch((d) => (d.llm.provider = e.target.value as LLMProvider))}>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai-compatible">OpenAI-compatible</option>
            </select>
          </div>
          <div className="field">
            <label>API key</label>
            <input
              type="password"
              value={draft.llm.apiKey}
              onChange={(e) => patch((d) => (d.llm.apiKey = e.target.value))}
              placeholder="sk-…"
            />
          </div>
        </div>
        <div className="field">
          <label>Base URL (optional)</label>
          <input
            value={draft.llm.baseUrl ?? ''}
            onChange={(e) => patch((d) => (d.llm.baseUrl = e.target.value || undefined))}
            placeholder="e.g. proxy or OpenAI-compatible endpoint"
          />
        </div>
        <div className="grid grid-2">
          <div className="field">
            <label>High-tier model (Generation / Reflection / Meta-review)</label>
            <input value={draft.llm.tiers.highTierModel} onChange={(e) => patch((d) => (d.llm.tiers.highTierModel = e.target.value))} />
            <ModelLimitsHint model={draft.llm.tiers.highTierModel} />
          </div>
          <div className="field">
            <label>Fast-tier model (Ranking / Proximity / Evolution)</label>
            <input value={draft.llm.tiers.fastTierModel} onChange={(e) => patch((d) => (d.llm.tiers.fastTierModel = e.target.value))} />
            <ModelLimitsHint model={draft.llm.tiers.fastTierModel} />
          </div>
        </div>
        <div className="grid grid-2">
          <div className="field">
            <label>Max output tokens (fallback)</label>
            <input type="number" min={512} max={384000} value={draft.llm.maxTokens} onChange={(e) => patch((d) => (d.llm.maxTokens = +e.target.value))} />
            <span className="hint">Default ceiling when an agent doesn't request its own; always clamped to the model's max output.</span>
          </div>
          <div className="field">
            <label>Temperature (OpenAI-compatible only)</label>
            <input type="number" min={0} max={2} step={0.1} value={draft.llm.temperature} onChange={(e) => patch((d) => (d.llm.temperature = +e.target.value))} />
            <span className="hint">Ignored for Claude (Opus 4.8 removes sampling params).</span>
          </div>
        </div>

        <details style={{ marginTop: 6 }}>
          <summary className="muted" style={{ cursor: 'pointer', fontSize: 'var(--fs-sm)' }}>Per-agent model overrides</summary>
          <div className="grid grid-2" style={{ marginTop: 12 }}>
            {OVERRIDABLE.map((a) => (
              <div key={a} className="field">
                <label>{AGENT_LABELS[a]}</label>
                <input
                  value={draft.llm.overrides[a] ?? ''}
                  placeholder="(use tier default)"
                  onChange={(e) => patch((d) => (d.llm.overrides[a] = e.target.value || undefined))}
                />
              </div>
            ))}
          </div>
        </details>
      </div>

      {/* Run */}
      <div className="card pad-lg">
        <div className="card-title" style={{ marginBottom: 14 }}>Engine</div>
        <div className="field">
          <label>Worker concurrency</label>
          <input type="number" min={1} max={8} value={draft.run.concurrency} onChange={(e) => patch((d) => (d.run.concurrency = +e.target.value))} />
          <span className="hint">Max simultaneous agent tasks.</span>
        </div>
        <label className="checkbox-row" style={{ marginTop: 6 }}>
          <input type="checkbox" checked={draft.safety.enforceBiosafety} onChange={(e) => patch((d) => (d.safety.enforceBiosafety = e.target.checked))} />
          Enforce biosafety gate (auto-reject low-safety designs)
        </label>
      </div>

      {/* MCP */}
      <div className="card pad-lg">
        <div className="card-title" style={{ marginBottom: 6 }}>Grounding — MCP servers</div>
        <p className="faint" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>
          Optional. Connect the deep-research server for literature grounding and CodeXomics for genomic data &amp; construct design.
        </p>
        <McpRow
          label="Deep Research (literature)"
          cfg={draft.mcp.deepResearch}
          onToggle={(v) => patch((d) => (d.mcp.deepResearch.enabled = v))}
          onUrl={(v) => patch((d) => (d.mcp.deepResearch.url = v))}
          onToken={(v) => patch((d) => (d.mcp.deepResearch.accessToken = v || undefined))}
          result={tests.deepResearch}
          onTest={() => test('deepResearch')}
        />
        <div className="divider" />
        <McpRow
          label="CodeXomics (genomics)"
          cfg={draft.mcp.codexomics}
          onToggle={(v) => patch((d) => (d.mcp.codexomics.enabled = v))}
          onUrl={(v) => patch((d) => (d.mcp.codexomics.url = v))}
          onToken={(v) => patch((d) => (d.mcp.codexomics.accessToken = v || undefined))}
          result={tests.codexomics}
          onTest={() => test('codexomics')}
        />
      </div>
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
        <div className={`badge ${result.ok ? 'ok' : 'err'}`}>
          {result.ok ? `Connected · ${result.toolCount ?? 0} tools` : `Failed: ${result.message}`}
        </div>
      )}
    </div>
  )
}
