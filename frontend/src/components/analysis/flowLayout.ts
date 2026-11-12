import dagre from '@dagrejs/dagre'
import { MarkerType, Position, type Node, type Edge } from '@xyflow/react'
import { edgeKey } from '../../utils/lineageFocus'
import type { LineageGraph, LineageGraphEdge, LineageGraphNode } from '../../types'

// How faded items are when shown for context but not directly upstream/downstream of the focused table.
export const DIMMED_OPACITY = 0.35

export const TABLE_WIDTH = 200
export const TABLE_HEIGHT = 44
// A Power BI asset is shown by its (often long) name, so its node grows with the name, up to a cap; beyond that the
// name is cut off with an ellipsis and the tooltip has it in full. Database tables keep the standard width.
const BI_NODE_MAX_WIDTH = 340
/** Width of a table node: 12px monospace text (~7.3px a character) plus the border, padding, icon and gap around it. */
export const tableWidth = (n: Pick<LineageGraphNode, 'label' | 'asset_type'>) =>
  n.asset_type ? Math.min(BI_NODE_MAX_WIDTH, Math.max(TABLE_WIDTH, Math.ceil(52 + n.label.length * 7.3))) : TABLE_WIDTH
export const PROCESS_WIDTH = 100
export const PROCESS_HEIGHT = 36

// A stored procedure is drawn as a box: a header row (its name and the expand/collapse arrow)
// and, once expanded, its processes stacked underneath.
export const SP_HEADER_HEIGHT = 40
const SP_PADDING = 12
const SP_CHILD_GAP = 8
// A Power BI model that has tables, measures or fields to show is a box too: its usual node is the header (plus room
// for the expand/collapse arrow) and, once expanded, its tables are laid out underneath as a grid, then the measures
// and fields that feed each other, by what feeds what.
export const MODEL_TOGGLE_WIDTH = 26
export const MEMBER_HEIGHT = 30
const MEMBER_PADDING = 12
const MEMBER_HEADER_GAP = 6
const MEMBER_GRID_GAP = 10
// Space between the model's tables and the measures/fields graph under them, and how many tables go in a row
// (at least) when there is no graph to set the width.
const MEMBER_SECTION_GAP = 28
const MEMBER_GRID_MIN_COLUMNS = 3
/** Width of a measure/field node: 11px text (~6.4px a character) plus its border, icon and padding. */
export const memberWidth = (label: string) => Math.min(300, Math.max(120, Math.ceil(46 + label.length * 6.4)))
/** Width of a table node: its name, the icon and a small count each for its fields and its measures. */
export const tableChipWidth = (n: Pick<LineageGraphNode, 'label' | 'field_count' | 'measure_count'>) =>
  Math.min(320, Math.max(130, Math.ceil(44 + n.label.length * 6.4 + (n.field_count ? 34 : 0) + (n.measure_count ? 34 : 0))))
// Edges are drawn at z 1 (above ordinary nodes). A container box and what is inside it sit above them, so the
// box's arrow stays clickable and what is inside sits on top of the box.
const Z_CONTAINER = 2
const Z_CONTAINED = 3
// A model's measures and fields sit above the links between them, which sit above the box's translucent background.
// React Flow adds the z of an edge's child nodes to the edge's own z, so those links are given the difference, -1,
// to come out at 3: between the box (2) and its members (4).
const Z_MEMBER = 4
const Z_MEMBER_LINK = Z_CONTAINED - Z_MEMBER
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
  // A read_by with no process in between (Power BI: source table -> model, model -> report, field -> measure ...):
  // the same edge as `input`, so the same look.
  uses: '#10b981',
}

/**
 * A Power BI process type (POWERBI_REPORT_RENDER, POWERBI_REFRESH, …) is far too long for a process pill and starts
 * the same way every time, so only its last word is shown (RENDER, REFRESH): the asset next to the pill says which
 * kind of render it is, and the pill's tooltip has the full name.
 */
export const shortProcessType = (type: string) => (/^POWERBI_/i.test(type) ? type.split('_').pop() ?? type : type)

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
  /** Ends at a table, measure or field inside an open model: drawn above that box's background but below them. */
  inside: boolean
}

/**
 * The inside of one open model: its tables as equal-width chips, then (under them) its measures and fields laid
 * out left to right by what feeds what. The tables something is linked to (`wired`) stand in one column, so the
 * links coming in run straight to them; the others are a grid beside it. Returns the size of all that, where each
 * node sits in it and how wide it is.
 */
function layoutMembers(members: LineageGraphNode[], links: [string, string][], wired: ReadonlySet<string>) {
  const tables = members.filter(k => k.member_kind === 'table')
  const linked = members.filter(k => k.member_kind !== 'table')
  const positions = new Map<string, { x: number; y: number }>()
  const widths = new Map<string, number>()

  // The measures/fields, as a graph. Placed first (at the origin) to learn how wide it is, then moved below the tables.
  let graphWidth = 0
  let graphHeight = 0
  if (linked.length > 0) {
    const m = new dagre.graphlib.Graph()
    m.setDefaultEdgeLabel(() => ({}))
    m.setGraph({ rankdir: 'LR', nodesep: 10, ranksep: 50 })
    for (const k of linked) m.setNode(k.id, { width: memberWidth(k.label), height: MEMBER_HEIGHT })
    for (const [s, t] of links) m.setEdge(s, t)
    dagre.layout(m)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const k of linked) {
      const p = m.node(k.id)
      minX = Math.min(minX, p.x - p.width / 2)
      maxX = Math.max(maxX, p.x + p.width / 2)
      minY = Math.min(minY, p.y - p.height / 2)
      maxY = Math.max(maxY, p.y + p.height / 2)
    }
    for (const k of linked) {
      const p = m.node(k.id)
      positions.set(k.id, { x: p.x - p.width / 2 - minX, y: p.y - p.height / 2 - minY })
      widths.set(k.id, p.width)
    }
    graphWidth = maxX - minX
    graphHeight = maxY - minY
  }

  let gridWidth = 0
  let gridHeight = 0
  if (tables.length > 0) {
    const col = Math.max(...tables.map(tableChipWidth))
    const linkedTables = tables.filter(t => wired.has(t.id))
    const otherTables = tables.filter(t => !wired.has(t.id))
    linkedTables.forEach((t, i) => {
      positions.set(t.id, { x: 0, y: i * (MEMBER_HEIGHT + MEMBER_GRID_GAP) })
      widths.set(t.id, col)
    })
    const columnHeight = linkedTables.length > 0 ? linkedTables.length * (MEMBER_HEIGHT + MEMBER_GRID_GAP) - MEMBER_GRID_GAP : 0
    // The others: as many columns as fit the graph's width (or a few when there is no graph), beside the linked ones.
    const left = linkedTables.length > 0 ? col + MEMBER_SECTION_GAP : 0
    const room = Math.max(graphWidth, MEMBER_GRID_MIN_COLUMNS * col + (MEMBER_GRID_MIN_COLUMNS - 1) * MEMBER_GRID_GAP) - left
    const columns = Math.max(1, Math.min(otherTables.length, Math.floor((room + MEMBER_GRID_GAP) / (col + MEMBER_GRID_GAP))))
    otherTables.forEach((t, i) => {
      positions.set(t.id, { x: left + (i % columns) * (col + MEMBER_GRID_GAP), y: Math.floor(i / columns) * (MEMBER_HEIGHT + MEMBER_GRID_GAP) })
      widths.set(t.id, col)
    })
    const rows = Math.ceil(otherTables.length / columns)
    gridWidth = otherTables.length > 0 ? left + columns * col + (columns - 1) * MEMBER_GRID_GAP : col
    gridHeight = Math.max(columnHeight, otherTables.length > 0 ? rows * MEMBER_HEIGHT + (rows - 1) * MEMBER_GRID_GAP : 0)
    // Make room for the tables above the graph.
    const below = gridHeight + MEMBER_SECTION_GAP
    for (const k of linked) positions.set(k.id, { x: positions.get(k.id)!.x, y: positions.get(k.id)!.y + below })
  }

  const height = tables.length > 0 ? gridHeight + (linked.length > 0 ? MEMBER_SECTION_GAP + graphHeight : 0) : graphHeight
  return { width: Math.max(graphWidth, gridWidth), height, positions, widths }
}

/**
 * Lays `graph` out left to right and turns it into React Flow nodes/edges.
 *
 * A stored procedure is a container around the processes it ran, and a Power BI
 * model is one around its measures and fields (`bi_member` nodes). Dagre only
 * ever sees the container, sized for whether it is open (`expanded` holds the
 * `full_name` of each open one); an open container's contents are then laid out
 * inside it: a procedure's processes stacked, a model's measures and fields
 * arranged by what feeds what. Edges follow what is visible: collapsed, an inner
 * node's edges attach to its container (merged, so many processes give one edge
 * per table, and links between a model's own measures/fields vanish into it);
 * expanded, they attach to the inner node itself. `calls` edges always attach to
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
  /** The container a process (its stored procedure) or a measure/field (its model) is drawn in, if that is in the graph. */
  const parentOf = (n: LineageGraphNode) => {
    const parent = n.parent_id ? byId.get(n.parent_id) : undefined
    if (!parent) return undefined
    if (n.type === 'process') return parent.type === 'stored_procedure' ? parent.id : undefined
    if (n.type === 'bi_member') return parent.type === 'table' ? parent.id : undefined
    return undefined
  }

  const children = new Map<string, LineageGraphNode[]>()
  for (const n of graph.nodes) {
    const parent = parentOf(n)
    if (parent) children.set(parent, [...(children.get(parent) ?? []), n])
  }
  const isOpen = (c: LineageGraphNode) => !!c.full_name && expanded.has(c.full_name) && (children.get(c.id)?.length ?? 0) > 0

  // The tables of a model that a link goes to or from outside the model (a source table, a table of another model).
  const wired = new Set<string>()
  for (const e of graph.edges) {
    const s = byId.get(e.source)
    const t = byId.get(e.target)
    if (s?.member_kind === 'table' && t?.parent_id !== s.parent_id) wired.add(s.id)
    if (t?.member_kind === 'table' && s?.parent_id !== t.parent_id) wired.add(t.id)
  }

  // What is inside each open model: the size of the box and where its tables, measures and fields sit.
  const memberEdges = graph.edges.filter(e => byId.get(e.source)?.type === 'bi_member' && byId.get(e.target)?.type === 'bi_member')
  const models = new Map<string, { width: number; height: number; positions: Map<string, { x: number; y: number }>; widths: Map<string, number> }>()
  for (const n of graph.nodes) {
    const kids = n.type === 'table' ? children.get(n.id) : undefined
    if (!kids || !isOpen(n)) continue
    const own = new Set(kids.map(k => k.id))
    const inner = layoutMembers(kids, memberEdges.filter(e => own.has(e.source) && own.has(e.target)).map(e => [e.source, e.target]), wired)
    const header = tableWidth(n) + MODEL_TOGGLE_WIDTH
    const width = Math.max(header, inner.width + 2 * MEMBER_PADDING)
    const dx = MEMBER_PADDING + (width - 2 * MEMBER_PADDING - inner.width) / 2
    models.set(n.id, {
      width,
      height: TABLE_HEIGHT + MEMBER_HEADER_GAP + inner.height + MEMBER_PADDING,
      positions: new Map([...inner.positions].map(([id, p]) => [id, { x: p.x + dx, y: p.y + TABLE_HEIGHT + MEMBER_HEADER_GAP }])),
      widths: inner.widths,
    })
  }

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
    if (parentOf(n) || n.type === 'bi_member') continue   // a measure/field is laid out with its model (and never without one)
    if (n.type === 'table') {
      // A model with measures/fields to show has room for its arrow; open, it is as big as what is inside it.
      const hasMembers = (children.get(n.id)?.length ?? 0) > 0
      g.setNode(n.id, models.get(n.id) ?? { width: tableWidth(n) + (hasMembers ? MODEL_TOGGLE_WIDTH : 0), height: TABLE_HEIGHT })
    } else if (n.type === 'stored_procedure') g.setNode(n.id, containerSize(n.label, children.get(n.id)?.length ?? 0, isOpen(n)))
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

  // A source table that feeds only the tables of one open model is put in the order of the tables it feeds, taking over
  // the places dagre gave these sources (so nothing moves closer to a neighbour): the links then fan in without crossing.
  const partners = new Map<string, Set<string>>()
  for (const [s, t] of layoutEdges.values()) {
    partners.set(s, (partners.get(s) ?? new Set()).add(t))
    partners.set(t, (partners.get(t) ?? new Set()).add(s))
  }
  for (const [containerId, box] of models) {
    const feeds = new Map<string, string>()   // source node -> the table of this model it feeds
    for (const e of graph.edges) {
      if (e.summary) continue
      const from = byId.get(e.source)
      const into = byId.get(e.target)
      if (into?.member_kind !== 'table' || into.parent_id !== containerId || from?.type !== 'table' || feeds.has(from.id)) continue
      if (partners.get(from.id)?.size === 1) feeds.set(from.id, into.id)
    }
    const ranks = new Map<number, string[]>()
    for (const id of feeds.keys()) {
      const x = Math.round(g.node(id).x)
      ranks.set(x, [...(ranks.get(x) ?? []), id])
    }
    for (const ids of ranks.values()) {
      const places = ids.map(id => g.node(id).y).sort((a, b) => a - b)
      const inOrder = [...ids].sort((a, b) => (box.positions.get(feeds.get(a)!)?.y ?? 0) - (box.positions.get(feeds.get(b)!)?.y ?? 0))
      inOrder.forEach((id, i) => { g.node(id).y = places[i] })
    }
  }

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
          // Same column and same height, or the swap could make the two overlap their neighbours.
          if (Math.abs(p.x - me.x) > 1 || Math.abs(p.height - me.height) > 1) continue
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
    label: shortProcessType((parentOf(n) ? n.process_type ?? n.query_type : n.query_type) ?? '?'),
    processName: n.label,
    queryType: n.query_type,
    processCode: n.process_code,
    processFqn: n.process_fqn,
  })

  const nodes: Node[] = []
  for (const n of graph.nodes) {
    if (parentOf(n) || n.type === 'bi_member') continue   // a measure/field is laid out with its model (and never without one)
    const pos = g.node(n.id)
    const base = {
      id: n.id,
      position: { x: pos.x - pos.width / 2, y: pos.y - pos.height / 2 },
      ...sides,
      ...dimmedStyle(n.id),
    }
    if (n.type === 'table') {
      const inside = children.get(n.id) ?? []
      const box = models.get(n.id)
      // (A table's own fields and measures are counted on the table; these count only the measures/fields linked to others.)
      const count = (kind: string) => inside.filter(k => k.member_kind === kind).length
      // What the data calls the things inside it (for its tooltips).
      const chip = inside.find(k => k.member_kind === 'table')
      const nameOf = (kind: 'table' | 'measure' | 'field') =>
        kind === 'table' ? chip?.type_name : chip?.member_type_names?.[kind] ?? inside.find(k => k.member_kind === kind)?.type_name
      nodes.push({
        ...base,
        type: 'table',
        // An open model is a box much bigger than a table node: React Flow is told so, and it sits above the edges.
        ...(box && { zIndex: Z_CONTAINER, width: box.width, height: box.height }),
        data: {
          label: n.label, fullName: n.full_name, isView: n.is_view, assetType: n.asset_type, typeName: n.type_name, details: n.details,
          insideTypeNames: { table: nameOf('table'), measure: nameOf('measure'), field: nameOf('field') },
          width: box?.width ?? tableWidth(n) + (inside.length > 0 ? MODEL_TOGGLE_WIDTH : 0),
          height: box?.height ?? TABLE_HEIGHT,
          focused: focusTable !== null && n.full_name === focusTable,
          expanded: !!box, childCount: inside.length, measureCount: count('measure'), fieldCount: count('field'), tableCount: count('table'),
        },
      })
      if (box) {
        // React Flow needs a parent ahead of its children in the list.
        for (const child of inside) {
          nodes.push({
            id: child.id,
            type: 'bi_member',
            parentId: n.id,
            extent: 'parent',
            zIndex: Z_MEMBER,
            position: box.positions.get(child.id)!,
            ...sides,
            ...dimmedStyle(child.id),
            data: {
              label: child.label, kind: child.member_kind, typeName: child.type_name, tableTypeName: child.table_type_name, memberTypeNames: child.member_type_names, details: child.details, table: child.table, fullName: child.full_name, modelId: child.model_id, width: box.widths.get(child.id) ?? memberWidth(child.label),
              fieldCount: child.field_count, measureCount: child.measure_count, fields: child.fields, measures: child.measures,
            },
          })
        }
      }
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
  const isOpenId = (id: string) => {
    const n = byId.get(id)
    return !!n && isOpen(n)
  }
  /** `id` is a measure, field or table of a model, drawn as itself (its model is open). */
  const drawnInside = (id: string, original: string) => id === original && byId.get(original)?.type === 'bi_member'
  for (const e of graph.edges) {
    // The roll-up of the links between a model's tables is replaced by those links while the model is open.
    if (e.summary && (isOpenId(e.source) || isOpenId(e.target))) continue
    const source = attachId(e.source)
    const target = attachId(e.target)
    // Two things inside one collapsed box (a model's measures and fields) are no longer linked to each other.
    if (source === target) continue
    const key = `${source}|${target}|${e.kind}`
    const onPath = !path || path.edgeKeys.has(edgeKey(e))
    const inside = drawnInside(source, e.source) || drawnInside(target, e.target)
    const seen = display.get(key)
    if (seen) seen.onPath ||= onPath
    else display.set(key, { source, target, kind: e.kind, column_count: e.column_count, onPath, inside })
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
      zIndex: e.inside ? Z_MEMBER_LINK : 1,
    }
  })

  return { nodes, edges }
}
