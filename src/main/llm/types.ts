import type { AgentRole, LLMProvider } from '@shared/domain'

export type Effort = 'low' | 'medium' | 'high' | 'max'

export interface LLMRequest {
  system: string
  /** The user turn. */
  prompt: string
  /** Which agent is calling — used by the router to pick a model. */
  agent: AgentRole
  /**
   * Resolved model id to call. Set by the router from the agent's tier/override
   * ModelRef; a client falls back to its config default if absent.
   */
  model?: string
  /** Reasoning depth / token spend. */
  effort?: Effort
  /** Enable adaptive thinking (recommended for reasoning-heavy steps). */
  think?: boolean
  /** Upper bound on output tokens. */
  maxTokens?: number
  /** Cancels a campaign's in-flight network request. */
  signal?: AbortSignal
}

/**
 * Per-provider configuration a single client instance is built from. The router
 * derives one of these per provider account from {@link AppSettings}.
 */
export interface ClientConfig {
  provider: LLMProvider
  apiKey: string
  /** Resolved base URL (override or catalogue default). */
  baseUrl?: string
  /** Sampling temperature (OpenAI-compatible only). */
  temperature: number
  /** Fallback output ceiling when a request doesn't supply its own. */
  maxTokensFallback: number
}

export interface LLMUsage {
  inputTokens: number
  outputTokens: number
}

export interface LLMResponse {
  text: string
  usage: LLMUsage
  model: string
  /**
   * Why generation stopped (e.g. 'end_turn', 'max_tokens', 'refusal' for
   * Anthropic; 'stop', 'length' for OpenAI-compatible). Surfaced so agents can
   * diagnose truncation when parsing yields nothing.
   */
  stopReason?: string
}

/** Provider-agnostic client used by all agents. */
export interface LLMClient {
  complete(req: LLMRequest): Promise<LLMResponse>
  /**
   * A cheap health/connectivity check. The router resolves the model itself, so
   * `model` is optional at the interface boundary; concrete clients require one.
   */
  ping(model?: string): Promise<string>
}
