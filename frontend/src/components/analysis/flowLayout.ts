import dagre from '@dagrejs/dagre'
import { MarkerType, Position, type Node, type Edge } from '@xyflow/react'
import { edgeKey } from '../../utils/lineageFocus'
import type { LineageGraph, LineageGraphEdge, LineageGraphNode } from '../../types'

// How faded items are when shown for context but not directly upstream/downstream of the focused table.
export const DIMMED_OPACITY = 0.35

export const TABLE_WIDTH = 200
export const TABLE_HEIGHT = 44
export const PROCESS_WIDTH = 100
export const PROCESS_HEIGHT = 36

// A stored procedure is drawn as a box: a header row (its name and the expand/collapse arrow)
// and, once expanded, its processes stacked underneath.
export const SP_HEADER_HEIGHT = 40
const SP_PADDING = 12
const SP_CHILD_GAP = 8
// Edges are drawn at z 1 (above ordinary nodes). A stored-procedure box and the processes inside
// it sit above them, so the box's arrow stays clickable and its processes sit on top of the box.
const Z_CONTAINER = 2
const Z_CONTAINED = 3
/** Width of the header row for a procedure name: ~7px per 11px-semibold character, plus icon, arrow and padding. */
const spNameWidth = (label: string) => Math.min(420, 90 + label.length * 7)

// Matches the read/write arrow convention already used in AssetTree.tsx
// (emerald ArrowUpRight = read, indigo ArrowDownLeft = write).
export const EDGE_COLOR: Record<LineageGraphEdge['kind'], string> = {
  input: '#10b981',
  output: '#6366f1',
  mapping: '#f97316',
  // Same hue as the view node colour: a direct edge is how a view (which has no process) is fed.
  direct: '#d946ef',
  // Same hue as the stored-procedure box.
  calls: '#eab308',
  // Power BI: an asset feeding the asset built on it.
  uses: '#0ea5e9',
}

const plural = (n: number, singular: string) => `${n} ${n === 1 ? singular : `${singular}s`}`

function containerSize(label: string, childCount: number, open: boolean) {
  const nameWidth = spNameWidth(label)
  if (!open) return { width: nameWidth, height: SP_HEADER_HEIGHT }
  return {
    width: Math.max(nameWidth, PROCESS_WIDTH + 2 * SP_PADDING),
    height: SP_HEADER_HEIGHT + childCount * PROCESS_HEIGHT + (childCount - 1) * SP_CHILD_GAP + SP_PADDING,
  }
}

interface DisplayEdge {
  source: string
  target: string
  kind: LineageGraphEdge['kind']
  column_count?: number
  onPath: boolean
}

/**
 * Lays `graph` out left to right and turns it into React Flow nodes/edges.
 *
 * A stored procedure is a container around the processes it ran. Dagre only
 * ever sees the container, sized for whether it is open (`expanded` holds the
 * `full_name` of each open one); an open container's processes are then stacked
 * inside it. Edges follow what is visible: collapsed, a process's table edges
 * attach to its container (merged, so many processes give one edge per table);
 * expanded, they attach to the process itself. `calls` edges always attach to
 * the containers.
 *
 * Nodes/edges outside `path` are drawn faded; omit `path` to draw everything at
 * full strength.
 */
export function layoutLineage(
  graph: LineageGraph,
  expanded: ReadonlySet<string>,
  focusTable: string | null = null,
  path?: { nodeIds: Set<string>; edgeKeys: Set<string> },
): { nodes: Node[]; edges: Edge[] } {
  const byId = new Map(graph.nodes.map(n => [n.id, n]))
  const parentOf = (n: LineageGraphNode) =>
    n.type === 'process' && n.parent_id && byId.get(n.parent_id)?.type === 'stored_procedure' ? n.parent_id : undefined

  const children = new Map<string, LineageGraphNode[]>()
  for (const n of graph.nodes) {
    const parent = parentOf(n)
    if (parent) children.set(parent, [...(children.get(parent) ?? []), n])
  }
  const isOpen = (c: LineageGraphNode) => !!c.full_name && expanded.has(c.full_name) && (children.get(c.id)?.length ?? 0) > 0

  /** The dagre node an id belongs to: a process inside a container is laid out as part of it. */
  const layoutId = (id: string) => {
    const n = byId.get(id)
    return (n && parentOf(n)) ?? id
  }
  /** The React Flow node an edge attaches to: a process's container while it is collapsed. */
  const attachId = (id: string) => {
    const container = layoutId(id)
    return container !== id && !isOpen(byId.get(container)!) ? container : id
  }

  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 24, ranksep: 90 })

  for (const n of graph.nodes) {
    if (parentOf(n)) continue
    if (n.type === 'table') g.setNode(n.id, { width: TABLE_WIDTH, height: TABLE_HEIGHT })
    else if (n.type === 'stored_procedure') g.setNode(n.id, containerSize(n.label, children.get(n.id)?.length ?? 0, isOpen(n)))
    else g.setNode(n.id, { width: PROCESS_WIDTH, height: PROCESS_HEIGHT })
  }
  const layoutEdges = new Map<string, [string, string]>()
  for (const e of graph.edges) {
    const s = layoutId(e.source)
    const t = layoutId(e.target)
    if (s !== t) layoutEdges.set(`${s}|${t}`, [s, t])
  }
  for (const [s, t] of layoutEdges.values()) g.setEdge(s, t)
  dagre.layout(g)

  // The focused table is often one of very many inputs to a process (e.g. 1 of 148), and
  // dagre can park it thousands of px above/below that process in the same column. Swap it
  // with the dimmed sibling level with the process so the direct path reads in a straight
  // line and can be framed at a readable zoom. Same-size nodes in one column, so no overlap.
  if (path && focusTable) {
    const focus = graph.nodes.find(n => n.type === 'table' && n.full_name === focusTable)
    if (focus) {
      const degree = new Map<string, number>()
      for (const [s, t] of layoutEdges.values()) {
        degree.set(s, (degree.get(s) ?? 0) + 1)
        degree.set(t, (degree.get(t) ?? 0) + 1)
      }
      const hubId = graph.edges
        .filter(e => path.edgeKeys.has(edgeKey(e)) && (e.source === focus.id || e.target === focus.id))
        .map(e => layoutId(e.source === focus.id ? e.target : e.source))
        .sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0))[0]
      const me = g.node(focus.id)
      const hub = hubId ? g.node(hubId) : undefined
      if (hub) {
        let best: typeof me | null = null
        for (const n of graph.nodes) {
          if (n.type !== 'table' || path.nodeIds.has(n.id)) continue
          const p = g.node(n.id)
          if (Math.abs(p.x - me.x) > 1) continue
          if (!best || Math.abs(p.y - hub.y) < Math.abs(best.y - hub.y)) best = p
        }
        if (best && Math.abs(best.y - hub.y) < Math.abs(me.y - hub.y)) [me.y, best.y] = [best.y, me.y]
      }
    }
  }

  const dimmedStyle = (id: string) => (path && !path.nodeIds.has(id) ? { style: { opacity: DIMMED_OPACITY } } : {})
  const sides = { sourcePosition: Position.Right, targetPosition: Position.Left }
  const processData = (n: LineageGraphNode) => ({
    // Inside a stored procedure a process is told apart by its type (sql, …); a free-standing one by its query type.
    label: (parentOf(n) ? n.process_type ?? n.query_type : n.query_type) ?? '?',
    queryType: n.query_type,
    processCode: n.process_code,
    processFqn: n.process_fqn,
  })

  const nodes: Node[] = []
  for (const n of graph.nodes) {
    if (parentOf(n)) continue
    const pos = g.node(n.id)
    const base = {
      id: n.id,
      position: { x: pos.x - pos.width / 2, y: pos.y - pos.height / 2 },
      ...sides,
      ...dimmedStyle(n.id),
    }
    if (n.type === 'table') {
      nodes.push({
        ...base,
        type: 'table',
        data: { label: n.label, fullName: n.full_name, isView: n.is_view, assetType: n.asset_type, focused: focusTable !== null && n.full_name === focusTable },
      })
    } else if (n.type === 'process') {
      nodes.push({ ...base, type: 'process', data: processData(n) })
    } else {
      const inside = children.get(n.id) ?? []
      const open = isOpen(n)
      nodes.push({
        ...base,
        type: 'stored_procedure',
        // Above the edges (z 1), which would otherwise cross the box and swallow clicks on its arrow.
        zIndex: Z_CONTAINER,
        width: pos.width,
        height: pos.height,
        data: { label: n.label, fqn: n.fqn, fullName: n.full_name, expanded: open, childCount: inside.length, width: pos.width, height: pos.height },
      })
      // React Flow needs a parent ahead of its children in the list.
      if (open) {
        inside.forEach((child, i) => nodes.push({
          id: child.id,
          type: 'process',
          parentId: n.id,
          extent: 'parent',
          zIndex: Z_CONTAINED,
          position: { x: (pos.width - PROCESS_WIDTH) / 2, y: SP_HEADER_HEIGHT + i * (PROCESS_HEIGHT + SP_CHILD_GAP) },
          ...sides,
          ...dimmedStyle(child.id),
          data: processData(child),
        }))
      }
    }
  }

  // Edges that land on the same pair once collapsed are merged; the merged edge is faded only if
  // every edge behind it is.
  const display = new Map<string, DisplayEdge>()
  for (const e of graph.edges) {
    const source = attachId(e.source)
    const target = attachId(e.target)
    const key = `${source}|${target}|${e.kind}`
    const onPath = !path || path.edgeKeys.has(edgeKey(e))
    const seen = display.get(key)
    if (seen) seen.onPath ||= onPath
    else display.set(key, { source, target, kind: e.kind, column_count: e.column_count, onPath })
  }

  const edges: Edge[] = [...display.values()].map((e, i) => {
    const color = EDGE_COLOR[e.kind]
    const dimmed = !e.onPath
    const isOutput = e.kind === 'output'
    // Mapping edges say how many columns are mapped; skipped on dimmed ones to keep a big graph legible.
    const label = e.kind === 'mapping' && e.column_count && !dimmed ? plural(e.column_count, 'col') : undefined
    return {
      id: `e${i}`,
      source: e.source,
      target: e.target,
      type: 'default',
      data: { kind: e.kind },
      ...(label && { label }),
      // Output edges are dashed via React Flow's `animated`. Dimmed ones keep the
      // dashes but stand still, so a big graph isn't dozens of running animations.
      animated: isOutput && !dimmed,
      markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color },
      style: {
        stroke: color,
        strokeWidth: 2,
        ...(dimmed && { opacity: DIMMED_OPACITY, ...(isOutput && { strokeDasharray: 5 }) }),
      },
      zIndex: 1,
    }
  })

  return { nodes, edges }
}
