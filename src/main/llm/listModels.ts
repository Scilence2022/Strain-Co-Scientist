import Anthropic from '@anthropic-ai/sdk'
import type { LLMProvider } from '@shared/domain'
import type { ModelListResult } from '@shared/ipc'
import { getProvider } from '@shared/providers'

const DISCOVERY_TIMEOUT_MS = 30_000

function failure(message: string): ModelListResult {
  return { ok: false, models: [], message }
}

function describeStatus(status: number): string {
  if (status === 401 || status === 403) return `HTTP ${status}. Check the API key and its permissions.`
  if (status === 404) return 'HTTP 404. Check the Base URL and whether the provider exposes a model list.'
  if (status === 429) return 'HTTP 429. The provider rate-limited the request. Try again shortly.'
  return `Model discovery failed with HTTP ${status}.`
}

/** Read the catalogue without changing the configured provider or running a model. */
export async function listModels(
  provider: LLMProvider,
  apiKey: string,
  baseUrl: string
): Promise<ModelListResult> {
  if (getProvider(provider)?.requiresApiKey && !apiKey) return failure('Enter an API key first.')
  try {
    let raw: unknown[]
    if (provider === 'anthropic') {
      const client = new Anthropic({ apiKey, baseURL: baseUrl || undefined, timeout: DISCOVERY_TIMEOUT_MS, maxRetries: 0 })
      raw = (await client.models.list({ limit: 1000 })).data
    } else {
      const root = baseUrl.trim().replace(/\/+$/, '')
      if (!root) return failure('Enter the API Base URL first.')

      const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined
      const res = await fetch(`${root}/models`, { headers, signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS) })
      if (!res.ok) {
        await res.body?.cancel().catch(() => {})
        return failure(describeStatus(res.status))
      }
      const json = await res.json() as { data?: unknown; models?: unknown } | null
      raw = Array.isArray(json?.data) ? json.data
        : Array.isArray(json?.models) ? json.models
          : Array.isArray(json) ? json : []
    }
    const ids = raw.map((item) => {
      if (typeof item === 'string') return item.trim()
      if (!item || typeof item !== 'object') return ''
      const id = 'id' in item ? item.id : 'name' in item ? item.name : ''
      return typeof id === 'string' ? id.trim() : ''
    }).filter(Boolean)
    const models = [...new Set(ids)].sort()
    return models.length
      ? { ok: true, models, message: `${models.length} models returned` }
      : failure('The provider returned an empty model list. Check token permissions or enter a model ID manually.')
  } catch (err) {
    if (err instanceof Anthropic.APIError && err.status) return failure(describeStatus(err.status))
    if (err instanceof Anthropic.APIConnectionTimeoutError || (err instanceof Error && err.name === 'TimeoutError')) {
      return failure('The model catalog request timed out. Check the Base URL and try again.')
    }
    if (err instanceof SyntaxError) return failure('The server returned invalid JSON. Check that the Base URL points to its API.')
    return failure('Could not reach the model catalog. Check the Base URL and network connection.')
  }
}
