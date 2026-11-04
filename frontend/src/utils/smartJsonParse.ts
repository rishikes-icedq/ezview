export interface SmartParseResult {
  value?: unknown
  error?: string
  /** How many layers of quote-wrapping / re-stringification had to be peeled off. */
  unwrapped: number
  /** Set when several top-level values (e.g. `{…}, {…}`) were gathered into one list: how many. */
  combined?: number
  /** The input was cut off mid-value; `value` holds only the complete items before the cut. */
  truncated?: boolean
}

interface Chunk {
  text: string
  /** Index of `text` within the string that was scanned. */
  offset: number
}

interface Scan {
  /** Complete top-level objects/arrays. */
  chunks: Chunk[]
  /** The unterminated value the input stops in the middle of, if any. */
  partial: Chunk | null
  /** Index of the first character that can't start an object/array (scanning stops there). */
  stray: number | null
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
 * Splits `text` into its top-level objects/arrays, ignoring the commas and
 * whitespace between them. Brackets inside strings don't count.
 */
function scanTopLevel(text: string, base = 0): Scan {
  const chunks: Chunk[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === ',' || /\s/.test(ch)) {
      i++
      continue
    }
    if (ch !== '{' && ch !== '[') return { chunks, partial: null, stray: base + i }

    let depth = 0
    let inString = false
    let escaped = false
    let end = -1
    for (let j = i; j < text.length; j++) {
      const c = text[j]
      if (inString) {
        if (escaped) escaped = false
        else if (c === '\\') escaped = true
        else if (c === '"') inString = false
      } else if (c === '"') {
        inString = true
      } else if (c === '{' || c === '[') {
        depth++
      } else if (c === '}' || c === ']') {
        depth--
        if (depth === 0) {
          end = j
          break
        }
      }
    }
    if (end === -1) return { chunks, partial: { text: text.slice(i), offset: base + i }, stray: null }
    chunks.push({ text: text.slice(i, end + 1), offset: base + i })
    i = end + 1
  }
  return { chunks, partial: null, stray: null }
}

/** Drops commas that sit right before a closing `}` or `]` (outside strings). */
function stripTrailingCommas(text: string): string {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
    } else if (c === '"') {
      inString = true
    } else if (c === ',') {
      let k = i + 1
      while (k < text.length && /\s/.test(text[k])) k++
      if (text[k] === '}' || text[k] === ']') continue
    }
    out += c
  }
  return out
}

function lineColumn(text: string, index: number): string {
  const before = text.slice(0, index)
  const line = before.split('\n').length
  const column = index - before.lastIndexOf('\n')
  return `line ${line}, column ${column}`
}

/**
 * Handles input that isn't one JSON document but is made of JSON objects/arrays:
 * - several of them separated by commas and/or newlines (`{…}, {…}` / NDJSON)
 * - a trailing comma after the last item
 * - a list cut off part-way through (keeps the complete items before the cut)
 * Returns null when `text` isn't that shape, so the caller keeps its own error.
 */
function parseLenient(text: string): Omit<SmartParseResult, 'unwrapped'> | null {
  const scan = scanTopLevel(text)
  if (scan.stray !== null) return null

  let chunks = scan.chunks
  let truncated = false
  let fromList = false
  if (scan.partial) {
    truncated = true
    if (chunks.length === 0 && scan.partial.text[0] === '[') {
      // The whole input is one unfinished array: keep its complete elements.
      chunks = scanTopLevel(scan.partial.text.slice(1), scan.partial.offset + 1).chunks
      fromList = true
    }
  }
  if (chunks.length === 0) return null

  const values: unknown[] = []
  for (let n = 0; n < chunks.length; n++) {
    const { text: chunk, offset } = chunks[n]
    try {
      values.push(JSON.parse(chunk))
      continue
    } catch (e) {
      try {
        values.push(JSON.parse(stripTrailingCommas(chunk)))
        continue
      } catch {
        // fall through to error handling below
      }
      // A lone value's own error already points at the right spot in the input.
      if (chunks.length === 1 && !truncated) return null
      const reason = (e instanceof Error ? e.message : String(e)).replace(/\s*at position \d+(?: \(line \d+ column \d+\))?/, '')
      return { error: `Item ${n + 1} (${lineColumn(text, offset)}) is not valid JSON: ${reason}` }
    }
  }

  if (fromList) return { value: values, truncated }
  if (values.length === 1) return { value: values[0], truncated }
  return { value: values, combined: values.length, truncated }
}

/**
 * Parses `raw` as JSON, tolerating common copy-paste artifacts:
 * - plain JSON, parsed as-is
 * - JSON that's itself wrapped in an extra pair of quotes (stringified JSON)
 * - JSON double/triple-encoded as a string value
 * - stray backslash-escaped single quotes that aren't valid JSON escapes
 * - several objects/arrays pasted side by side (comma- or newline-separated),
 *   a trailing comma, or a list cut off part-way through
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

  // Not a single JSON document — see whether it's a run of objects/arrays.
  let lenientError: string | undefined
  for (let i = 0; i < candidates.length; i++) {
    const result = parseLenient(candidates[i])
    if (!result) continue
    if (result.error) lenientError ??= result.error
    else return { ...result, unwrapped: i }
  }
  return { error: lenientError ?? lastError, unwrapped: 0 }
}
