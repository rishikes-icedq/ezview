import type { LineageGraph, LineageGraphEdge } from '../types'

/**
 * - `direct`: only the table's ancestors and descendants — the strict chain of
 *   tables/processes that feed it or are fed by it.
 * - `full`: everything connected to it, ignoring direction — also the other
 *   inputs/outputs of every process on the way, and *their* lineage in turn.
 *   (A view built from 148 tables shows all 148, not just the one you clicked.)
 */
export type FocusScope = 'direct' | 'full'

export interface FocusedLineage {
  graph: LineageGraph
  /** Nodes on the direct upstream/downstream chain, including the table itself. In `direct` scope that's every node. */
  pathNodeIds: Set<string>
  /** Edges on that chain, as edgeKey(); in `direct` scope that's every edge. */
  pathEdgeKeys: Set<string>
  upstreamTables: number
  downstreamTables: number
  /** Tables shown only because of `full` scope (always 0 for `direct`). */
  relatedTables: number
  processes: number
}

export const edgeKey = (e: LineageGraphEdge) => `${e.source}|${e.target}|${e.kind}`

/**
 * Narrows `graph` to one table's lineage (see FocusScope). Returns null when
 * `fullName` isn't a table node in the graph (e.g. a table that no process
 * reads or writes).
 */
export function focusLineage(graph: LineageGraph, fullName: string, scope: FocusScope = 'direct'): FocusedLineage | null {
  const start = graph.nodes.find(n => n.type === 'table' && n.full_name === fullName)
  if (!start) return null

  const incoming = new Map<string, number[]>()
  const outgoing = new Map<string, number[]>()
  const index = (m: Map<string, number[]>, nodeId: string, edgeIdx: number) => {
    const list = m.get(nodeId)
    if (list) list.push(edgeIdx)
    else m.set(nodeId, [edgeIdx])
  }
  graph.edges.forEach((e, i) => {
    index(incoming, e.target, i)
    index(outgoing, e.source, i)
  })

  // Every edge walked in either direction is kept, including ones that lead
  // back to an already-visited node (cycles, e.g. a process that reads and
  // writes the same table), so no walked connection is silently dropped.
  const pathEdges = new Set<number>()
  const walk = (adjacent: Map<string, number[]>, farEnd: (edgeIdx: number) => string): Set<string> => {
    const seen = new Set<string>([start.id])
    const stack = [start.id]
    while (stack.length) {
      const id = stack.pop()!
      for (const i of adjacent.get(id) ?? []) {
        pathEdges.add(i)
        const next = farEnd(i)
        if (!seen.has(next)) {
          seen.add(next)
          stack.push(next)
        }
      }
    }
    return seen
  }

  const upstream = walk(incoming, i => graph.edges[i].source)
  const downstream = walk(outgoing, i => graph.edges[i].target)
  const pathNodeIds = new Set<string>([...upstream, ...downstream])

  let shownNodeIds = pathNodeIds
  if (scope === 'full') {
    // Connected component ignoring direction. Stopping at nodes already seen is
    // enough: every edge of a visited node has both ends in the component.
    shownNodeIds = new Set<string>([start.id])
    const stack = [start.id]
    while (stack.length) {
      const id = stack.pop()!
      for (const i of [...(incoming.get(id) ?? []), ...(outgoing.get(id) ?? [])]) {
        const e = graph.edges[i]
        for (const next of [e.source, e.target]) {
          if (!shownNodeIds.has(next)) {
            shownNodeIds.add(next)
            stack.push(next)
          }
        }
      }
    }
  }

  const nodes = graph.nodes.filter(n => shownNodeIds.has(n.id))
  const edges = scope === 'full'
    ? graph.edges.filter(e => shownNodeIds.has(e.source))
    : graph.edges.filter((_, i) => pathEdges.has(i))

  const tableCount = (ids: Set<string>) =>
    nodes.filter(n => n.type === 'table' && n.id !== start.id && ids.has(n.id)).length

  return {
    graph: { nodes, edges },
    pathNodeIds,
    pathEdgeKeys: new Set(graph.edges.filter((_, i) => pathEdges.has(i)).map(edgeKey)),
    upstreamTables: tableCount(upstream),
    downstreamTables: tableCount(downstream),
    relatedTables: nodes.filter(n => n.type === 'table' && !pathNodeIds.has(n.id)).length,
    processes: nodes.filter(n => n.type === 'process').length,
  }
}
