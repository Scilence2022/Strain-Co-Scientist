import type { AppSettings } from '@shared/domain'
import type { LLMClient } from './types'
import { AnthropicClient } from './AnthropicClient'
import { OpenAICompatibleClient } from './OpenAICompatibleClient'

export * from './types'

export function createLLMClient(settings: AppSettings): LLMClient {
  return settings.llm.provider === 'openai-compatible'
    ? new OpenAICompatibleClient(settings)
    : new AnthropicClient(settings)
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
    // 3) Salvage the complete leading objects from a truncated array — the
    //    common "model hit max_tokens mid-array" case, which otherwise loses
    //    every already-complete element.
    const salvaged = salvageArray(candidate)
    if (salvaged) return salvaged as unknown as T
    return null
  }
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
