export interface ParsedFqn {
  type: 'column' | 'table' | 'schema' | 'database' | 'dataprocess' | 'unresolved'
  raw: string
  system?: string
  platform?: string
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

  // The pipeline inserts an explicit platform segment right after the system
  // name: /system/platform/database/schema/table[/column] — one level
  // deeper than a bare /system/database/schema/table[/column].
  if (rest.length === 5) {
    return { type: 'column', system, platform: rest[0], database: rest[1], schema: rest[2], table: rest[3], column: rest[4], raw: fqn }
  }
  if (rest.length === 4) {
    return { type: 'table', system, platform: rest[0], database: rest[1], schema: rest[2], table: rest[3], raw: fqn }
  }
  if (rest.length === 3) {
    return { type: 'schema', system, platform: rest[0], database: rest[1], schema: rest[2], raw: fqn }
  }
  if (rest.length === 2) {
    return { type: 'database', system, platform: rest[0], database: rest[1], raw: fqn }
  }

  return { type: 'unresolved', raw: fqn }
}

/** Split FQN into colored segments for display. Shades are picked separately
 * per theme since the dark-mode "-400" pastels don't have enough contrast
 * against a light/white background. */
export const FQN_SEGMENT_COLORS = [
  'text-slate-600 dark:text-slate-400',    // system
  'text-rose-600 dark:text-rose-400',      // platform
  'text-orange-600 dark:text-orange-400',  // database
  'text-green-700 dark:text-green-400',    // schema
  'text-cyan-700 dark:text-cyan-400',      // table
  'text-purple-700 dark:text-purple-400',  // column
]

export function isFqn(value: string): boolean {
  return typeof value === 'string' && value.startsWith('/') && value.split('/').length >= 3
}
