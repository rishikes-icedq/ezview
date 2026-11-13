import type { ConfidenceBasis, EdgeSays, LineageGraphEdge } from '../types'

/**
 * The pipeline's own confidence levels, weakest first. A level the data writes that is not one of these is still counted
 * and shown, but can't be ranked (so it is never "the weakest").
 */
export const CONFIDENCE_ORDER = ['LOW', 'MEDIUM', 'HIGH'] as const

/** Where a level sits (0 = weakest), or undefined for a level the pipeline does not use. */
export const levelRank = (level: string | undefined | null): number | undefined => {
  const at = CONFIDENCE_ORDER.indexOf(String(level ?? '').toUpperCase() as (typeof CONFIDENCE_ORDER)[number])
  return at < 0 ? undefined : at
}

/** The weakest of several levels, as the data writes it, or undefined if none is a known level. */
export const weakestLevel = (levels: Iterable<string | undefined>): string | undefined => {
  let best: { rank: number; level: string } | undefined
  for (const level of levels) {
    const rank = levelRank(level)
    if (level && rank !== undefined && (!best || rank < best.rank)) best = { rank, level }
  }
  return best?.level
}

const groupKey = (b: Omit<ConfidenceBasis, 'count'>) => `${b.confidence ?? ''}|${b.resolution_type ?? ''}|${b.fallback_reason ?? ''}`

/** The groups of several links added together (their counts summed), the weakest first. */
export function mergeBasis(...lists: (ConfidenceBasis[] | undefined)[]): ConfidenceBasis[] {
  const sum = new Map<string, ConfidenceBasis>()
  for (const list of lists) {
    for (const g of list ?? []) {
      const seen = sum.get(groupKey(g))
      if (seen) seen.count += g.count
      else sum.set(groupKey(g), { ...g })
    }
  }
  return [...sum.values()].sort((a, b) => (levelRank(a.confidence) ?? 9) - (levelRank(b.confidence) ?? 9) || b.count - a.count)
}

/** The name the data gives a drawn link, by its kind (read_by, writes_to, maps_to, calls). */
export const EDGE_NAME: Record<LineageGraphEdge['kind'], string> = {
  input: 'read_by',
  uses: 'read_by',
  output: 'writes_to',
  direct: 'maps_to',
  mapping: 'maps_to',
  calls: 'calls',
}

/** `fallback_reason` is shown after the `resolution_type` it explains: "table_fallback (column_unresolvable)". */
const resolution = (g: Omit<ConfidenceBasis, 'count'>) =>
  g.resolution_type ? `${g.resolution_type}${g.fallback_reason ? ` (${g.fallback_reason})` : ''}` : g.fallback_reason

/**
 * The text of a link's tooltip, in the data's own words: the edge's name, its `confidence` (and, when its edges differ, how
 * many say what) and what each says about how it was resolved.
 */
export function linkTooltip(kind: LineageGraphEdge['kind'], basis: ConfidenceBasis[] | undefined): string {
  const lines = [EDGE_NAME[kind]]
  if (!basis?.length) return lines[0]
  const total = basis.reduce((n, g) => n + g.count, 0)
  const byLevel = new Map<string, number>()
  for (const g of basis) byLevel.set(g.confidence ?? '', (byLevel.get(g.confidence ?? '') ?? 0) + g.count)
  const weakest = weakestLevel(basis.map(g => g.confidence))
  const levels = [...byLevel].filter(([level]) => level)
  if (levels.length === 1) lines.push(`confidence: ${levels[0][0]}`)
  else if (levels.length > 1) lines.push(`confidence: ${weakest ?? levels[0][0]}, the weakest of ${levels.map(([level, n]) => `${level} ${n}`).join(' · ')}`)
  const how = new Map<string, number>()
  for (const g of basis) {
    const text = resolution(g)
    if (text) how.set(text, (how.get(text) ?? 0) + g.count)
  }
  for (const [text, n] of how) lines.push(`resolution_type: ${text}${how.size > 1 || n !== total ? ` × ${n}` : ''}`)
  if (total > 1) lines.push(`${total} edges`)
  return lines.join('\n')
}

/** The text of the tooltip of one step of a column lineage path. */
export function hopTooltip(says: EdgeSays | undefined): string | undefined {
  if (!says) return undefined
  const lines: string[] = []
  if (says.confidence) lines.push(`confidence: ${says.confidence}`)
  const how = resolution(says)
  if (how) lines.push(`resolution_type: ${how}`)
  return lines.join('\n') || undefined
}

/** Tailwind classes for a level's colour, the same as in the Edges tab: HIGH emerald, MEDIUM amber, LOW red. */
export const levelText = (level: string | undefined): string => {
  switch (String(level ?? '').toUpperCase()) {
    case 'HIGH': return 'text-emerald-600 dark:text-emerald-400'
    case 'MEDIUM': return 'text-amber-500 dark:text-amber-400'
    case 'LOW': return 'text-red-500 dark:text-red-400'
    default: return 'text-slate-400'
  }
}
