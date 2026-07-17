/**
 * Cleans up SQL copied out of a JSON/query-history export (e.g. a
 * QUERY_TEXT field copied along with sibling JSON keys) so it can be
 * formatted as plain SQL:
 * - strips a leading wrapping quote left over from copying a JSON string value
 * - truncates at the point trailing JSON sibling fields begin, e.g.
 *   `...;", "QUERY_TYPE": "MERGE", ...` copied along with a query_history row
 * - unescapes JSON-style escapes (\n, \t, \", \\) used for the embedded
 *   newlines in the original JSON string, since real SQL never contains a
 *   literal backslash-n pair
 */
export function cleanSqlInput(raw: string): string {
  let text = raw.trim()

  if (text.length > 1 && text[0] === '"' && text[text.length - 1] !== '"') {
    text = text.slice(1)
  }

  const jsonTailMatch = text.match(/",\s*"[A-Za-z0-9_]+"\s*:/)
  if (jsonTailMatch && jsonTailMatch.index !== undefined) {
    text = text.slice(0, jsonTailMatch.index)
  }

  text = text
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')

  return text.trim()
}
