import type { AppSettings } from '@shared/domain'
import type { LLMClient } from './types'
import { AnthropicClient } from './AnthropicClient'
import { OpenAICompatibleClient } from './OpenAICompatibleClient'

export * from './types'

/**
 * Pick the right LLM client for the current settings.
 *
 *   - 'anthropic' → AnthropicClient (uses the native Anthropic SDK, which
 *     supports adaptive thinking + `output_config.effort`).
 *   - anything else → OpenAICompatibleClient (chat-completions over
 *     OpenAI-compatible HTTP, including OpenAI, DeepSeek, OpenRouter,
 *     SiliconFlow, MiniMax, Google, GLM, local and custom endpoints).
 */
export function createLLMClient(settings: AppSettings): LLMClient {
  return settings.llm.provider === 'anthropic'
    ? new AnthropicClient(settings)
    : new OpenAICompatibleClient(settings)
}

/** Robust extraction of a JSON value embedded in model prose. */
export function parseJsonLoose<T = unknown>(text: string): T | null {
  if (!text) return null
  // Strip code fences — tolerate an *unterminated* fence (truncated output).
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i)
  const candidate = fenced ? fenced[1] : text
  // 1) Direct parse.
  try {
    return JSON.parse(candidate) as T
  } catch {
    // 2) First fully-balanced { ... } or [ ... ] span.
    const span = extractBalanced(candidate)
    if (span) {
      try {
        return JSON.parse(span) as T
      } catch {
        // fall through to salvage
      }
    }
    // 3) For a truncated *top-level array*, salvage the complete leading
    //    elements — the common "model hit max_tokens mid-array" case. Gated to
    //    a genuine top-level array so it can't grab a nested array (e.g. an
    //    object's first array field) out of a truncated object.
    const firstObj = candidate.indexOf('{')
    const firstArr = candidate.indexOf('[')
    const topIsArray = firstArr !== -1 && (firstObj === -1 || firstArr < firstObj)
    if (topIsArray) {
      const salvaged = salvageArray(candidate)
      if (salvaged) return salvaged as unknown as T
    }
    // 4) Salvage a truncated top-level object (e.g. a research overview cut off
    //    mid-stream): close the dangling string/brackets and re-parse. A bad
    //    repair simply fails JSON.parse and falls through to null.
    const repaired = repairTruncated(candidate)
    if (repaired) {
      try {
        return JSON.parse(repaired) as T
      } catch {
        // give up
      }
    }
    return null
  }
}

/**
 * Best-effort repair of a JSON value truncated mid-stream (model hit
 * max_tokens). Closes an unterminated string, drops a dangling key / trailing
 * comma, and balances any still-open brackets. The caller re-parses the result,
 * so an imperfect repair is harmless — it just fails and yields null.
 */
function repairTruncated(text: string): string | null {
  const start = text.search(/[{[]/)
  if (start === -1) return null
  let inStr = false
  let esc = false
  const stack: string[] = []
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') stack.push('}')
    else if (ch === '[') stack.push(']')
    else if (ch === '}' || ch === ']') stack.pop()
  }
  let out = text.slice(start)
  if (inStr) out += '"' // close an unterminated string
  // Drop a trailing fragment that can't close cleanly: a dangling "key": with
  // no value, a partial trailing key, or a trailing comma.
  out = out
    .replace(/,\s*$/, '')
    .replace(/"[^"]*"\s*:\s*$/, '')
    .replace(/[,{]\s*"[^"]*"$/, (m) => (m[0] === '{' ? '{' : ''))
    .replace(/,\s*$/, '')
  while (stack.length) out += stack.pop()
  return out
}

/**
 * Recover the complete leading objects from a (possibly truncated) JSON array
 * of objects. Walks the first `[`, collects every top-level `{ ... }` element
 * that closes cleanly, and drops a trailing partial element. Returns null if
 * there is no array or no complete element.
 */
function salvageArray(text: string): unknown[] | null {
  const start = text.indexOf('[')
  if (start === -1) return null
  const out: unknown[] = []
  let depth = 0
  let inStr = false
  let esc = false
  let objStart = -1
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') {
      if (depth === 0) objStart = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && objStart !== -1) {
        try {
          out.push(JSON.parse(text.slice(objStart, i + 1)))
        } catch {
          // skip an element we can't parse
        }
        objStart = -1
      } else if (depth < 0) {
        break // unbalanced
      }
    } else if (ch === ']' && depth === 0) {
      break // clean end of array
    }
  }
  return out.length ? out : null
}

function extractBalanced(text: string): string | null {
  const startObj = text.indexOf('{')
  const startArr = text.indexOf('[')
  let start = -1
  let open = '{'
  let close = '}'
  if (startObj === -1 && startArr === -1) return null
  if (startArr === -1 || (startObj !== -1 && startObj < startArr)) {
    start = startObj
    open = '{'
    close = '}'
  } else {
    start = startArr
    open = '['
    close = ']'
  }
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}
