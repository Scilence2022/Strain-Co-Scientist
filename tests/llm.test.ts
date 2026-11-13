import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleClient } from '../src/main/llm/OpenAICompatibleClient'
import { listModels, LlmRouter } from '../src/main/llm'
import { DEFAULT_SETTINGS } from '../src/shared/domain'
import { effectiveModelIds, getProvider } from '../src/shared/providers'
import { ipcArguments, settingsSchema } from '../src/shared/validation'

const request = { agent: 'generation' as const, system: 'Test', prompt: 'Test', model: 'test-model' }
function client() {
  return new OpenAICompatibleClient({ provider: 'local', apiKey: '', baseUrl: 'http://localhost:11434/v1', temperature: 0.5, maxTokensFallback: 1000 })
}
afterEach(() => vi.unstubAllGlobals())
describe('LLM request reliability', () => {
  it('uses a bounded abortable request and supports keyless local servers', async () => {
    const fetch = vi.fn(async (_url, init: RequestInit) => {
      expect(init.signal).toBeInstanceOf(AbortSignal)
      expect(init.headers).not.toHaveProperty('Authorization')
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Ready' }, finish_reason: 'stop' }] }))
    })
    vi.stubGlobal('fetch', fetch)
    expect(await client().complete(request)).toMatchObject({ text: 'Ready', stopReason: 'stop' })
  })

  it('propagates cancellation to the network request', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => {
      await new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true }))
    }))
    const controller = new AbortController()
    const result = client().complete({ ...request, signal: controller.signal })
    controller.abort()
    await expect(result).rejects.toThrow()
  })

  it('rejects empty and error responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{"choices":[]}')).mockResolvedValueOnce(new Response('Rate limited', { status: 429 })))
    await expect(client().complete(request)).rejects.toThrow('no text content')
    await expect(client().complete(request)).rejects.toThrow('429')
  })

  it('does not call a disabled provider', async () => {
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.llm.providers.anthropic!.enabled = false
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(new LlmRouter(settings).complete(request)).rejects.toThrow('disabled')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('Zhongkeyu provider', () => {
  const provider = getProvider('zhongkeyu')!
  const endpoint = 'https://zhongkeyu.com/v1'

  it('discovers token-scoped model IDs and routes completions through the documented API', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [
        { id: 'test-chat' }, { id: 'test-chat' }, { id: 'another-chat' }
      ] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'Ready' } }] })))
    vi.stubGlobal('fetch', fetch)
    expect(await listModels(provider.id, 'fixture-key', provider.baseUrl))
      .toMatchObject({ ok: true, models: ['another-chat', 'test-chat'] })
    expect(fetch.mock.calls[0]).toEqual([`${endpoint}/models`, {
      headers: { Authorization: 'Bearer fixture-key' }, signal: expect.any(AbortSignal)
    }])

    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.llm.providers.zhongkeyu = { enabled: true, apiKey: ' fixture-key ' }
    settings.llm.tiers.highTier = { provider: 'zhongkeyu', model: 'test-chat' }
    expect(settingsSchema.safeParse(settings).success).toBe(true)
    expect(await new LlmRouter(settings).complete(request)).toMatchObject({ model: 'test-chat', text: 'Ready' })
    const [url, init] = fetch.mock.calls[1]
    expect(url).toBe(`${endpoint}/chat/completions`)
    expect(init.headers).toMatchObject({ Authorization: 'Bearer fixture-key' })
    expect(JSON.parse(init.body).model).toBe('test-chat')
  })

  it('reserves the output budget for final text on the Zhongkeyu Flash alias', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"choices":[{"message":{"content":"ready"}}]}'))
    vi.stubGlobal('fetch', fetch)
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.llm.providers.zhongkeyu = { enabled: true, apiKey: 'fixture-key' }
    settings.llm.tiers.fastTier = { provider: 'zhongkeyu', model: 'deepseek-v4.1-flash' }
    await expect(new LlmRouter(settings).ping()).resolves.toBe('ready')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      thinking: { type: 'disabled' }, reasoning_effort: 'none', max_tokens: 16
    })
  })

  it('explains discovery authentication errors without exposing the response body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('fixture-key', { status: 401 })))
    const result = await listModels(provider.id, 'fixture-key', endpoint)
    expect(result).toMatchObject({ ok: false, models: [] })
    expect(result.message).toContain('Check the API key')
    expect(result.message).not.toContain('fixture-key')
  })

  it('accepts both saved and draft credentials and validates draft endpoints', () => {
    expect(ipcArguments.listProviderModels.safeParse(['zhongkeyu']).success).toBe(true)
    expect(ipcArguments.listProviderModels.safeParse(['zhongkeyu', { apiKey: 'key', baseUrl: endpoint }]).success).toBe(true)
    expect(ipcArguments.listProviderModels.safeParse(['zhongkeyu', { apiKey: 'key', baseUrl: 'file:///tmp' }]).success).toBe(false)
  })

  it('respects a cleared shortlist without dropping the discovered catalog', () => {
    const fetchedModels = ['test-chat']
    expect(effectiveModelIds(provider, { fetchedModels })).toEqual(fetchedModels)
    expect(effectiveModelIds(provider, { fetchedModels, selectedModels: [] })).toEqual([])
  })
})
