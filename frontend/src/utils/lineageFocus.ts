import type { LineageGraph, LineageGraphEdge } from '../types'

/**
 * - `direct`: only the table's ancestors and descendants — the strict chain of
 *   tables/processes that feed it or are fed by it.
 * - `full`: everything connected to it, ignoring direction — also the other
 *   inputs/outputs of every process on the way, and *their* lineage in turn.
 *   (A view built from 148 tables shows all 148, not just the one you clicked.)
 *
 * Stored procedures don't extend either: `calls` edges say which procedure
 * invokes which, not where data flows, so they are never walked. A procedure's
 * container is shown (and counts as on the chain) whenever one of its processes
 * is, and a `calls` edge is shown when both its procedures are.
 *
 * Likewise the tables, measures and fields of a Power BI model (`bi_member` nodes)
 * are inside their model, not connected to it: they are shown whenever the model
 * is, and the links that start or end at one of them are never walked as lineage
 * (the link between the whole models, which they add up to, is).
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
  storedProcedures: number
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
  const memberIds = new Set(graph.nodes.filter(n => n.type === 'bi_member').map(n => n.id))
  // A link with a measure, field or table of a model at one end: between those inside one model, from a source table to
  // a table of a model, or from a table of one model to a table of the next.
  const isInnerEdge = (e: LineageGraphEdge) => memberIds.has(e.source) || memberIds.has(e.target)
  graph.edges.forEach((e, i) => {
    if (e.kind === 'calls' || isInnerEdge(e)) return
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
  const walked = new Set<string>([...upstream, ...downstream])

  let shown = walked
  if (scope === 'full') {
    // Connected component ignoring direction. Stopping at nodes already seen is
    // enough: every edge of a visited node has both ends in the component.
    shown = new Set<string>([start.id])
    const stack = [start.id]
    while (stack.length) {
      const id = stack.pop()!
      for (const i of [...(incoming.get(id) ?? []), ...(outgoing.get(id) ?? [])]) {
        const e = graph.edges[i]
        for (const next of [e.source, e.target]) {
          if (!shown.has(next)) {
            shown.add(next)
            stack.push(next)
          }
        }
      }
    }
  }

  // Add the containers of the processes that made it in, and the fields/measures of the models that did.
  const parentOf = new Map(graph.nodes.map(n => [n.id, n.parent_id ?? null]))
  const members = graph.nodes.filter(n => n.type === 'bi_member')
  const withContainers = (ids: Set<string>): Set<string> => {
    const all = new Set(ids)
    for (const id of ids) {
      const parent = parentOf.get(id)
      if (parent) all.add(parent)
    }
    for (const m of members) if (m.parent_id && ids.has(m.parent_id)) all.add(m.id)
    return all
  }
  const pathNodeIds = withContainers(walked)
  const shownNodeIds = withContainers(shown)

  const nodes = graph.nodes.filter(n => shownNodeIds.has(n.id))
  const dataEdges = scope === 'full'
    ? graph.edges.filter(e => e.kind !== 'calls' && !isInnerEdge(e) && shownNodeIds.has(e.source))
    : graph.edges.filter((_, i) => pathEdges.has(i))
  const callEdges = graph.edges.filter(e => e.kind === 'calls' && shownNodeIds.has(e.source) && shownNodeIds.has(e.target))
  const memberEdges = graph.edges.filter(e => isInnerEdge(e) && shownNodeIds.has(e.source) && shownNodeIds.has(e.target))

  const tableCount = (ids: Set<string>) =>
    nodes.filter(n => n.type === 'table' && n.id !== start.id && ids.has(n.id)).length

  return {
    graph: { nodes, edges: [...dataEdges, ...callEdges, ...memberEdges] },
    pathNodeIds,
    pathEdgeKeys: new Set([
      ...graph.edges.filter((_, i) => pathEdges.has(i)).map(edgeKey),
      ...callEdges.filter(e => pathNodeIds.has(e.source) && pathNodeIds.has(e.target)).map(edgeKey),
      ...memberEdges.filter(e => pathNodeIds.has(e.source) && pathNodeIds.has(e.target)).map(edgeKey),
    ]),
    upstreamTables: tableCount(upstream),
    downstreamTables: tableCount(downstream),
    relatedTables: nodes.filter(n => n.type === 'table' && !pathNodeIds.has(n.id)).length,
    processes: nodes.filter(n => n.type === 'process').length,
    storedProcedures: nodes.filter(n => n.type === 'stored_procedure').length,
  }
}
