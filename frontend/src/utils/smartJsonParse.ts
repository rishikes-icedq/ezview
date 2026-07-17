export interface SmartParseResult {
  value?: unknown
  error?: string
  /** How many layers of quote-wrapping / re-stringification had to be peeled off. */
  unwrapped: number
}

function stripOuterQuotes(text: string): string | null {
  if (text.length < 2) return null
  const first = text[0]
  const last = text[text.length - 1]
  if ((first === '"' || first === "'") && last === first) {
    return text.slice(1, -1)
  }
  return null
}

function unescapeLoose(text: string): string {
  // JSON has no escape for a single quote — copy-pasted Python/log text
  // sometimes backslash-escapes them anyway (e.g. \'ICEDQ_DB\'), which
  // breaks strict JSON parsing. Safe to normalize: JSON never needs \'.
  return text.replace(/\\'/g, "'")
}

/**
 * Parses `raw` as JSON, tolerating common copy-paste artifacts:
 * - plain JSON, parsed as-is
 * - JSON that's itself wrapped in an extra pair of quotes (stringified JSON)
 * - JSON double/triple-encoded as a string value
 * - stray backslash-escaped single quotes that aren't valid JSON escapes
 */
export function smartParseJson(raw: string): SmartParseResult {
  const text = raw.trim()
  if (!text) return { error: 'Nothing to format.', unwrapped: 0 }

  const candidates = [text]
  let current = text
  for (let i = 0; i < 5; i++) {
    let next = current
    const stripped = stripOuterQuotes(next)
    if (stripped !== null) next = stripped
    next = unescapeLoose(next)
    if (next === current) break
    candidates.push(next)
    current = next
  }

  let lastError = 'Could not parse as JSON.'
  for (let i = 0; i < candidates.length; i++) {
    let value: unknown
    try {
      value = JSON.parse(candidates[i])
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
      continue
    }
    let unwrapped = i
    while (typeof value === 'string' && unwrapped < 8) {
      try {
        value = JSON.parse(value)
        unwrapped++
      } catch {
        break
      }
    }
    return { value, unwrapped }
  }
  return { error: lastError, unwrapped: 0 }
}
