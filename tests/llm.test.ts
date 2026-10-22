import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleClient } from '../src/main/llm/OpenAICompatibleClient'
import { LlmRouter } from '../src/main/llm'
import { DEFAULT_SETTINGS } from '../src/shared/domain'

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
