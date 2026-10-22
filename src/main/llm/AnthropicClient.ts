import Anthropic from '@anthropic-ai/sdk'
import { resolveMaxOutputTokens } from '@shared/models'
import type { ClientConfig, LLMClient, LLMRequest, LLMResponse } from './types'

/**
 * Anthropic-backed LLM client.
 *
 * Notes for Claude 4.x (Opus 4.8 / Sonnet 4.6):
 * - Sampling params (temperature/top_p/top_k) are removed on Opus 4.8 and 400.
 *   We steer depth via `effort` + adaptive thinking instead.
 * - We always stream and collect the final message to stay clear of HTTP
 *   timeouts on longer generations (research overviews, full reviews).
 *
 * Built from a {@link ClientConfig} for a single provider account; the model id
 * for each request is supplied by the router via `req.model`.
 */
export class AnthropicClient implements LLMClient {
  private client: Anthropic
  private cfg: ClientConfig

  constructor(cfg: ClientConfig) {
    this.cfg = cfg
    this.client = new Anthropic({
      apiKey: cfg.apiKey,
      ...(cfg.baseUrl ? { baseURL: cfg.baseUrl } : {})
    })
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const model = req.model ?? ''
    // Adaptive output budget: honour the per-agent request but never exceed
    // what this specific model can actually emit in one response.
    const maxTokens = resolveMaxOutputTokens(model, req.maxTokens ?? this.cfg.maxTokensFallback)

    // Built as `any` so newer API fields (output_config.effort, adaptive
    // thinking) pass through regardless of the installed SDK's static types.
    const params: any = {
      model,
      max_tokens: maxTokens,
      system: req.system,
      messages: [{ role: 'user', content: req.prompt }],
      // effort is GA on Opus 4.6+/Sonnet 4.6 (no beta header needed).
      output_config: { effort: req.effort ?? 'high' },
      ...(req.think ? { thinking: { type: 'adaptive' } } : {})
    }

    const stream = this.client.messages.stream(params, { signal: req.signal, timeout: 120_000, maxRetries: 1 })
    const message = await stream.finalMessage()

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')

    return {
      text,
      model: message.model,
      stopReason: message.stop_reason ?? undefined,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens
      }
    }
  }

  async ping(model = ''): Promise<string> {
    const res = await this.client.messages.create({
      model,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Reply with the single word: ready' }]
    }, { timeout: 30_000, maxRetries: 0 })
    const block = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
    return block?.text?.trim() ?? ''
  }
}
