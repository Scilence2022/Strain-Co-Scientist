/**
 * Provider catalogue.
 *
 * Single source of truth for every LLM provider the app can talk to. The
 * renderer reads from it to render the Settings form; the main process reads
 * from it to resolve the base URL, default models and required headers for
 * the OpenAI-compatible client.
 *
 * Notes
 *  - `anthropic` is special-cased and uses the Anthropic SDK; everything else
 *    is routed through the OpenAI-compatible chat-completions client.
 *  - `openai-compatible` is kept as a flexible escape hatch (user supplies
 *    baseUrl + model id).
 *  - `local` defaults to Ollama's local OpenAI-compat endpoint, but the user
 *    can point the baseUrl at LM Studio, vLLM, llama.cpp's server, etc.
 *  - Provider `id` values are persisted in `AppSettings.llm.provider` and
 *    form the runtime LLMProvider union — adding a new provider means
 *    adding it to the catalogue below and to `LLMProvider` in
 *    `domain.ts`.
 */

import type { LLMProvider, ModelRef } from './domain'

export type ProviderGroup = 'official' | 'openai-compatible' | 'regional' | 'self-hosted' | 'custom'

export interface ModelPreset {
  /** Suggested model id, e.g. "deepseek-chat" or "claude-opus-4-8". */
  id: string
  /** Short label shown in the model dropdown. */
  label: string
  /** One-line description of the model's character/scale. */
  hint?: string
}

export interface ProviderDefinition {
  id: LLMProvider
  /** Display name in the dropdown (e.g. "DeepSeek"). */
  label: string
  /** Group used to visually cluster providers in the dropdown. */
  group: ProviderGroup
  /** OpenAI-compat base URL, e.g. "https://api.deepseek.com/v1". */
  baseUrl: string
  docsUrl?: string
  /** API key environment variable hint, for UX. */
  envHint?: string
  /** Whether the provider requires a non-empty API key. */
  requiresApiKey: boolean
  /** Whether the user can override the base URL. */
  customBaseUrl: boolean
  /** Whether the user can type a custom model id (in addition to the presets). */
  customModels: boolean
  /** Suggested high-tier model(s). */
  highTierModels: ModelPreset[]
  /** Suggested fast-tier model(s). */
  fastTierModels: ModelPreset[]
  /** One-line description shown under the dropdown. */
  description: string
}

export const PROVIDERS: ProviderDefinition[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    group: 'official',
    baseUrl: 'https://api.anthropic.com',
    requiresApiKey: true,
    customBaseUrl: true,
    customModels: true,
    highTierModels: [
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', hint: 'Highest quality — generation, reflection, meta-review' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', hint: 'Strong quality / cost balance' }
    ],
    fastTierModels: [
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', hint: 'Fastest, lowest cost' }
    ],
    description: 'Native Anthropic SDK — sampling parameters removed on Opus 4.8 (use effort + adaptive thinking instead).'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    group: 'official',
    baseUrl: 'https://api.openai.com/v1',
    requiresApiKey: true,
    customBaseUrl: true,
    customModels: true,
    highTierModels: [
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4.1', label: 'GPT-4.1' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
      { id: 'o3', label: 'o3 (reasoning)' },
      { id: 'o3-mini', label: 'o3-mini (reasoning)' }
    ],
    fastTierModels: [
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini' }
    ],
    description: 'OpenAI native endpoint. Supports sampling parameters and JSON mode.'
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    group: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    envHint: 'DEEPSEEK_API_KEY',
    requiresApiKey: true,
    customBaseUrl: true,
    customModels: true,
    highTierModels: [
      { id: 'deepseek-chat', label: 'DeepSeek-V3 (chat)', hint: 'Strong general model, 128K context' },
      { id: 'deepseek-reasoner', label: 'DeepSeek-R1 (reasoner)', hint: 'Reasoning-tuned, chain-of-thought' }
    ],
    fastTierModels: [
      { id: 'deepseek-chat', label: 'DeepSeek-V3 (chat)' }
    ],
    description: 'DeepSeek OpenAI-compatible API. Excellent quality / cost ratio.'
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    group: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    envHint: 'OPENROUTER_API_KEY',
    requiresApiKey: true,
    customBaseUrl: true,
    customModels: true,
    highTierModels: [
      { id: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
      { id: 'openai/gpt-4o', label: 'GPT-4o' },
      { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'deepseek/deepseek-chat-v3', label: 'DeepSeek V3' }
    ],
    fastTierModels: [
      { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini' },
      { id: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku' },
      { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' }
    ],
    description: 'Unified router across many providers. Use the "openrouter/" model id syntax.'
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow',
    group: 'openai-compatible',
    baseUrl: 'https://api.siliconflow.cn/v1',
    envHint: 'SILICONFLOW_API_KEY',
    requiresApiKey: true,
    customBaseUrl: true,
    customModels: true,
    highTierModels: [
      { id: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek-V3' },
      { id: 'Qwen/Qwen2.5-72B-Instruct', label: 'Qwen 2.5 72B Instruct' },
      { id: 'meta-llama/Meta-Llama-3.1-70B-Instruct', label: 'Llama 3.1 70B Instruct' }
    ],
    fastTierModels: [
      { id: 'Qwen/Qwen2.5-7B-Instruct', label: 'Qwen 2.5 7B Instruct' },
      { id: 'meta-llama/Meta-Llama-3.1-8B-Instruct', label: 'Llama 3.1 8B Instruct' }
    ],
    description: 'SiliconFlow hosted OpenAI-compatible inference. Many open-source models.'
  },
  {
    id: 'zhongkeyu',
    label: 'Zhongkeyu (中科云)',
    group: 'openai-compatible',
    baseUrl: 'https://zhongkeyu.com/v1',
    docsUrl: 'https://zhongkeyu.com/docs',
    requiresApiKey: true,
    customBaseUrl: true,
    customModels: true,
    highTierModels: [],
    fastTierModels: [],
    description: 'Zhongkeyu model gateway. Refresh models to see the IDs available to your API token.'
  },
  {
    id: 'kimi',
    label: 'Kimi (Moonshot)',
    group: 'regional',
    baseUrl: 'https://api.moonshot.cn/v1',
    envHint: 'MOONSHOT_API_KEY',
    requiresApiKey: true,
    customBaseUrl: true,
    customModels: true,
    highTierModels: [
      { id: 'kimi-k2-0711-preview', label: 'Kimi K2', hint: 'Latest MoE flagship, long context' },
      { id: 'moonshot-v1-128k', label: 'Moonshot v1 128K' },
      { id: 'moonshot-v1-32k', label: 'Moonshot v1 32K' }
    ],
    fastTierModels: [
      { id: 'moonshot-v1-32k', label: 'Moonshot v1 32K' },
      { id: 'moonshot-v1-8k', label: 'Moonshot v1 8K' }
    ],
    description: 'Moonshot AI (Kimi) — OpenAI-compatible. Use api.moonshot.ai for the global endpoint.'
  },
  {
    id: 'minimax-cn',
    label: 'MiniMax (Local)',
    group: 'regional',
    baseUrl: 'https://api.MiniMax.chat/v1',
    envHint: 'MiniMax_API_KEY',
    requiresApiKey: true,
    customBaseUrl: true,
    customModels: true,
    highTierModels: [
      { id: 'abab6.5s-chat', label: 'ABAB 6.5s Chat' },
      { id: 'abab6.5-chat', label: 'ABAB 6.5 Chat' }
    ],
    fastTierModels: [
      { id: 'abab5.5-chat', label: 'ABAB 5.5 Chat' }
    ],
    description: 'MiniMax (MiniMax) China endpoint, OpenAI-compatible chat-completions.'
  },
  {
    id: 'minimax-global',
    label: 'MiniMax (Global)',
    group: 'regional',
    baseUrl: 'https://api.MiniMax.io/v1',
    envHint: 'MiniMax_API_KEY',
    requiresApiKey: true,
    customBaseUrl: true,
    customModels: true,
    highTierModels: [
      { id: 'abab6.5s-chat', label: 'ABAB 6.5s Chat' },
      { id: 'abab6.5-chat', label: 'ABAB 6.5 Chat' }
    ],
    fastTierModels: [
      { id: 'abab5.5-chat', label: 'ABAB 5.5 Chat' }
    ],
    description: 'MiniMax (MiniMax) Global endpoint, OpenAI-compatible chat-completions.'
  },
  {
    id: 'google',
    label: 'Google (Gemini via OpenAI-compat)',
    group: 'openai-compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    envHint: 'GOOGLE_API_KEY',
    requiresApiKey: true,
    customBaseUrl: true,
    customModels: true,
    highTierModels: [
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.0-pro-exp', label: 'Gemini 2.0 Pro (experimental)' }
    ],
    fastTierModels: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' }
    ],
    description: 'Google Gemini via the OpenAI-compat shim. Use a Google AI Studio API key.'
  },
  {
    id: 'glm',
    label: 'Zhipu GLM (BigModel)',
    group: 'regional',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    envHint: 'ZHIPUAI_API_KEY',
    requiresApiKey: true,
    customBaseUrl: true,
    customModels: true,
    highTierModels: [
      { id: 'glm-4-plus', label: 'GLM-4 Plus' },
      { id: 'glm-4-air-250414', label: 'GLM-4 Air' },
      { id: 'glm-z1-air', label: 'GLM-Z1 Air (reasoning)' }
    ],
    fastTierModels: [
      { id: 'glm-4-flash-250414', label: 'GLM-4 Flash' },
      { id: 'glm-4-air-250414', label: 'GLM-4 Air' }
    ],
    description: 'Zhipu BigModel (GLM-4) — OpenAI-compatible chat-completions. CN endpoint.'
  },
  {
    id: 'local',
    label: 'Local model (Ollama / LM Studio / vLLM)',
    group: 'self-hosted',
    baseUrl: 'http://127.0.0.1:11434/v1',
    requiresApiKey: false,
    customBaseUrl: true,
    customModels: true,
    highTierModels: [
      { id: 'qwen2.5:14b', label: 'Ollama: qwen2.5:14b' },
      { id: 'llama3.1:8b', label: 'Ollama: llama3.1:8b' },
      { id: 'deepseek-r1:14b', label: 'Ollama: deepseek-r1:14b' }
    ],
    fastTierModels: [
      { id: 'qwen2.5:7b', label: 'Ollama: qwen2.5:7b' },
      { id: 'llama3.1:8b', label: 'Ollama: llama3.1:8b' }
    ],
    description:
      'Defaults to Ollama (http://127.0.0.1:11434/v1). Override the base URL for LM Studio (1234), vLLM, llama.cpp, etc. API key is optional.'
  },
  {
    id: 'openai-compatible',
    label: 'Custom OpenAI-compatible endpoint',
    group: 'custom',
    baseUrl: '',
    requiresApiKey: true,
    customBaseUrl: true,
    customModels: true,
    highTierModels: [],
    fastTierModels: [],
    description: 'Any OpenAI-compatible chat-completions endpoint. Specify base URL and model id(s).'
  }
]

export const PROVIDER_IDS = PROVIDERS.map((p) => p.id)

/**
 * Display order for the Settings UI — roughly by industry influence, with the
 * self-hosted (Local) and Custom escape hatches last. Ids not listed here fall
 * back to the end, preserving catalogue order.
 */
const PROVIDER_DISPLAY_ORDER: string[] = [
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'openrouter',
  'zhongkeyu',
  'glm',
  'kimi',
  'minimax-global',
  'minimax-cn',
  'siliconflow',
  'local',
  'openai-compatible'
]

/** Providers in display order (see {@link PROVIDER_DISPLAY_ORDER}). */
export const PROVIDERS_ORDERED: ProviderDefinition[] = [...PROVIDERS].sort((a, b) => {
  const ia = PROVIDER_DISPLAY_ORDER.indexOf(a.id)
  const ib = PROVIDER_DISPLAY_ORDER.indexOf(b.id)
  return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib)
})

const PROVIDER_INDEX: Record<string, ProviderDefinition> = Object.fromEntries(
  PROVIDERS.map((p) => [p.id, p])
)

/** Returns the provider definition, or undefined for unknown ids (legacy settings). */
export function getProvider(id: string): ProviderDefinition | undefined {
  return PROVIDER_INDEX[id]
}

/** Group label for the Settings dropdown `<optgroup>`. */
export const PROVIDER_GROUP_LABEL: Record<ProviderGroup, string> = {
  official: 'Official APIs',
  'openai-compatible': 'OpenAI-compatible',
  regional: 'Regional providers',
  'self-hosted': 'Self-hosted / Local',
  custom: 'Custom'
}

/** Ordered groups for the Settings dropdown. */
export const PROVIDER_GROUP_ORDER: ProviderGroup[] = [
  'official',
  'openai-compatible',
  'regional',
  'self-hosted',
  'custom'
]

/** Resolves the effective base URL the LLM client should call. */
export function resolveBaseUrl(provider: ProviderDefinition, override?: string): string {
  const trimmed = override?.trim()
  if (trimmed) return trimmed.replace(/\/+$/, '')
  return provider.baseUrl.replace(/\/+$/, '')
}

/** Pick a sensible default high-tier model for a provider. */
export function defaultHighTierModel(provider: ProviderDefinition): string {
  return provider.highTierModels[0]?.id ?? ''
}

/** Pick a sensible default fast-tier model for a provider. */
export function defaultFastTierModel(provider: ProviderDefinition): string {
  return provider.fastTierModels[0]?.id ?? provider.highTierModels[0]?.id ?? ''
}

/** Build the default {@link ModelRef} for a provider's high or fast tier. */
export function defaultModelRef(provider: ProviderDefinition, tier: 'high' | 'fast'): ModelRef {
  return {
    provider: provider.id,
    model: tier === 'high' ? defaultHighTierModel(provider) : defaultFastTierModel(provider)
  }
}

/** Max models selected by default after a refresh. */
export const MAX_DEFAULT_SELECTED = 5

/** De-duped catalogue preset ids for a provider (high + fast tier suggestions). */
function presetIds(provider: ProviderDefinition | undefined): string[] {
  if (!provider) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of [...provider.highTierModels, ...provider.fastTierModels]) {
    if (!seen.has(m.id)) {
      out.push(m.id)
      seen.add(m.id)
    }
  }
  return out
}

/** Human label for a model id — the catalogue preset label if known, else the id. */
export function modelLabelFor(provider: ProviderDefinition | undefined, id: string): string {
  if (!provider) return id
  const hit = [...provider.highTierModels, ...provider.fastTierModels].find((m) => m.id === id)
  return hit?.label ?? id
}

/**
 * Default curated selection after a refresh: the provider's known preset models
 * that are actually available, topped up from the discovered list to at most
 * {@link MAX_DEFAULT_SELECTED}. Falls back to the first few discovered ids when
 * no presets match (e.g. a local server with custom model names).
 */
export function defaultSelectedModels(provider: ProviderDefinition | undefined, fetched: string[]): string[] {
  const available = new Set(fetched)
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of presetIds(provider)) {
    if (available.has(id) && !seen.has(id)) {
      out.push(id)
      seen.add(id)
    }
  }
  for (const id of fetched) {
    if (out.length >= MAX_DEFAULT_SELECTED) break
    if (!seen.has(id)) {
      out.push(id)
      seen.add(id)
    }
  }
  return out.slice(0, MAX_DEFAULT_SELECTED)
}

/**
 * Models offered on the Model Selection tab for a provider:
 *   - the curated subset chosen on the Providers tab, when present;
 *   - otherwise the full discovered list;
 *   - otherwise the catalogue preset ids (provider never refreshed).
 */
export function effectiveModelIds(
  provider: ProviderDefinition | undefined,
  account: { selectedModels?: string[]; fetchedModels?: string[] } | undefined
): string[] {
  if (account?.selectedModels) return account.selectedModels
  if (account?.fetchedModels?.length) return account.fetchedModels
  return presetIds(provider)
}
