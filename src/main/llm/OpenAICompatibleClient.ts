import { resolveMaxOutputTokens } from '@shared/models'
import type { ClientConfig, LLMClient, LLMRequest, LLMResponse } from './types'
import { getProvider, resolveBaseUrl, type ProviderDefinition } from '@shared/providers'

/**
 * OpenAI-compatible chat-completions client.
 *
 * Drives every non-Anthropic provider in the catalogue. Built from a
 * {@link ClientConfig} for a single provider account; the model id for each
 * request is supplied by the router via `req.model`. Temperature is honoured
 * here (unlike the Anthropic path, where it is removed on Opus 4.8).
 */
export class OpenAICompatibleClient implements LLMClient {
  private cfg: ClientConfig
  private provider: ProviderDefinition | undefined
  private baseUrl: string
  /** Provider-specific extra headers (e.g. OpenRouter's HTTP-Referer). */
  private extraHeaders: Record<string, string>

  constructor(cfg: ClientConfig) {
    this.cfg = cfg
    this.provider = getProvider(cfg.provider)
    this.baseUrl = resolveBaseUrl(this.provider ?? ({ baseUrl: '' } as ProviderDefinition), cfg.baseUrl)
    this.extraHeaders = this.buildHeaders()
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {}
    if (this.cfg.provider === 'openrouter') {
      // OpenRouter attribution headers (recommended for higher rate limits).
      headers['HTTP-Referer'] = 'https://github.com/strain-co-scientist'
      headers['X-Title'] = 'Strain Co-Scientist'
    }
    return headers
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const model = req.model ?? ''
    // Adaptive output budget: clamp to the model's real max-output ceiling
    // (e.g. DeepSeek V4 emits up to 384K tokens, far above Claude's 128K).
    const body = {
      model,
      max_tokens: resolveMaxOutputTokens(model, req.maxTokens ?? this.cfg.maxTokensFallback),
      temperature: this.cfg.temperature,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.prompt }
      ]
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.extraHeaders
    }
    // Local servers (Ollama) often run without auth — omit the header rather
    // than send an empty string, which some servers reject.
    if (this.cfg.apiKey.trim()) {
      headers['Authorization'] = `Bearer ${this.cfg.apiKey}`
    }
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: req.signal
        ? AbortSignal.any([req.signal, AbortSignal.timeout(120_000)])
        : AbortSignal.timeout(120_000)
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(
        `LLM request failed (${this.provider?.label ?? this.cfg.provider} ${res.status}): ${errText || res.statusText}`
      )
    }
    const json: any = await res.json()
    const text = json.choices?.[0]?.message?.content
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error('LLM returned no text content')
    }
    return {
      text,
      model,
      stopReason: json.choices?.[0]?.finish_reason ?? undefined,
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0
      }
    }
  }

  async ping(model = ''): Promise<string> {
    const res = await this.complete({
      agent: 'supervisor',
      model,
      system: 'You are a connectivity probe.',
      prompt: 'Reply with the single word: ready',
      maxTokens: 16,
      effort: 'low'
    })
    return res.text.trim()
  }
}
