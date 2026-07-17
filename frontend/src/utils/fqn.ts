export interface ParsedFqn {
  type: 'column' | 'table' | 'schema' | 'database' | 'dataprocess' | 'unresolved'
  raw: string
  system?: string
  database?: string
  schema?: string
  table?: string
  column?: string
  process_id?: string
}

export function parseFqn(fqn: string): ParsedFqn {
  if (!fqn || fqn.toUpperCase().startsWith('UNRESOLVED') || !fqn.startsWith('/')) {
    return { type: 'unresolved', raw: fqn }
  }

  const parts = fqn.split('/').filter(Boolean)
  if (parts.length < 2) return { type: 'unresolved', raw: fqn }

  const [system, ...rest] = parts

  if (rest[0]?.toLowerCase() === 'dataprocess') {
    return { type: 'dataprocess', system, process_id: rest[1] ?? '', raw: fqn }
  }

  if (rest.length === 4) {
    return { type: 'column', system, database: rest[0], schema: rest[1], table: rest[2], column: rest[3], raw: fqn }
  }
  if (rest.length === 3) {
    return { type: 'table', system, database: rest[0], schema: rest[1], table: rest[2], raw: fqn }
  }
  if (rest.length === 2) {
    return { type: 'schema', system, database: rest[0], schema: rest[1], raw: fqn }
  }
  if (rest.length === 1) {
    return { type: 'database', system, database: rest[0], raw: fqn }
  }

  return { type: 'unresolved', raw: fqn }
}

/** Split FQN into colored segments for display. Shades are picked separately
 * per theme since the dark-mode "-400" pastels don't have enough contrast
 * against a light/white background. */
export const FQN_SEGMENT_COLORS = [
  'text-slate-600 dark:text-slate-400',    // system
  'text-orange-600 dark:text-orange-400',  // database
  'text-green-700 dark:text-green-400',    // schema
  'text-cyan-700 dark:text-cyan-400',      // table
  'text-purple-700 dark:text-purple-400',  // column
]

export function isFqn(value: string): boolean {
  return typeof value === 'string' && value.startsWith('/') && value.split('/').length >= 3
}
