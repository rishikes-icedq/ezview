import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow, Background, Controls, MiniMap, MarkerType, Position, Handle, NodeToolbar, Panel,
  useNodesState, useEdgesState,
  type Node, type Edge, type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from '@dagrejs/dagre'
import { Loader2, Table2, Layers, Cpu, Crosshair, RotateCcw, MousePointerClick } from 'lucide-react'
import { toast } from 'sonner'
import { getGraph } from '../../api/lineage'
import { useTheme } from '../../contexts/ThemeContext'
import { focusLineage, edgeKey, type FocusScope } from '../../utils/lineageFocus'
import type { GraphMode, LineageGraph, LineageGraphEdge } from '../../types'

interface Props {
  folder: string
  /** `database.schema.table` of the asset whose lineage alone is shown; null shows the whole graph. */
  focusTable: string | null
  onFocusChange: (fullName: string | null) => void
  focusScope: FocusScope
  onScopeChange: (scope: FocusScope) => void
  graphMode: GraphMode
  onGraphModeChange: (mode: GraphMode) => void
}

const MODE_OPTIONS: { id: GraphMode; label: string; hint: string }[] = [
  { id: 'all', label: 'All', hint: 'Tables and views together with the processes that read and write them.' },
  { id: 'mapping', label: 'Data Mapping', hint: 'Only table/view → table/view links from maps_to edges, with no processes in between. Edge labels show how many columns are mapped.' },
]

const SCOPE_OPTIONS: { id: FocusScope; label: string }[] = [
  { id: 'full', label: 'Full lineage' },
  { id: 'direct', label: 'Direct path' },
]

const SCOPE_HINTS: Record<GraphMode, Record<FocusScope, string>> = {
  all: {
    full: 'Everything connected to this table: also the other inputs and outputs of each process on the way, and their lineage in turn. Items not directly upstream/downstream of the table are dimmed.',
    direct: 'Only the tables and processes that feed this table or are fed by it.',
  },
  mapping: {
    full: 'Everything connected to this table through data mappings, in either direction, and their mappings in turn. Items not directly upstream/downstream of the table are dimmed.',
    direct: 'Only the tables and views that feed this one, or are fed by it, through data mappings.',
  },
}

const SEGMENT_TONE = {
  amber: {
    group: 'border-amber-400 dark:border-amber-600',
    on: 'bg-amber-200 dark:bg-amber-700/60 text-amber-900 dark:text-amber-50',
    off: 'bg-white dark:bg-slate-900 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40',
  },
  indigo: {
    group: 'border-indigo-300 dark:border-indigo-700',
    on: 'bg-indigo-100 dark:bg-indigo-600/40 text-indigo-800 dark:text-indigo-100',
    off: 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-slate-800',
  },
}

function Segmented<T extends string>({ ariaLabel, options, value, onChange, tone }: {
  ariaLabel: string
  options: { id: T; label: string; hint: string }[]
  value: T
  onChange: (id: T) => void
  tone: keyof typeof SEGMENT_TONE
}) {
  const t = SEGMENT_TONE[tone]
  return (
    <div role="group" aria-label={ariaLabel} className={`flex rounded-md overflow-hidden border text-xs font-medium ${t.group}`}>
      {options.map(o => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          title={o.hint}
          aria-pressed={value === o.id}
          className={`px-2.5 py-1 transition-colors ${value === o.id ? t.on : t.off}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// How faded items are when shown for context but not directly upstream/downstream of the focused table.
const DIMMED_OPACITY = 0.35

const TABLE_WIDTH = 200
const TABLE_HEIGHT = 44
const PROCESS_WIDTH = 100
const PROCESS_HEIGHT = 36

// Matches the read/write arrow convention already used in AssetTree.tsx
// (emerald ArrowUpRight = read, indigo ArrowDownLeft = write).
const EDGE_COLOR: Record<LineageGraphEdge['kind'], string> = {
  input: '#10b981',
  output: '#6366f1',
  mapping: '#f97316',
}

// Same query-type hues as queryTypeBadge() in utils/format.ts, adapted for a
// filled graph node rather than a text badge.
const QUERY_TYPE_NODE_COLOR: Record<string, string> = {
  INSERT: 'bg-blue-100 border-blue-400 text-blue-900 dark:bg-blue-900/50 dark:border-blue-600 dark:text-blue-100',
  UPDATE: 'bg-violet-100 border-violet-400 text-violet-900 dark:bg-violet-900/50 dark:border-violet-600 dark:text-violet-100',
  MERGE: 'bg-indigo-100 border-indigo-400 text-indigo-900 dark:bg-indigo-900/50 dark:border-indigo-600 dark:text-indigo-100',
  DELETE: 'bg-rose-100 border-rose-400 text-rose-900 dark:bg-rose-900/50 dark:border-rose-600 dark:text-rose-100',
  CTAS: 'bg-teal-100 border-teal-400 text-teal-900 dark:bg-teal-900/50 dark:border-teal-600 dark:text-teal-100',
  COPY: 'bg-sky-100 border-sky-400 text-sky-900 dark:bg-sky-900/50 dark:border-sky-600 dark:text-sky-100',
}
const DEFAULT_PROCESS_COLOR = 'bg-slate-100 border-slate-400 text-slate-800 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200'

const TABLE_NODE_COLOR = 'bg-cyan-100 border-cyan-400 text-cyan-900 dark:bg-cyan-900/50 dark:border-cyan-600 dark:text-cyan-100'
const VIEW_NODE_COLOR = 'bg-fuchsia-100 border-fuchsia-400 text-fuchsia-900 dark:bg-fuchsia-900/50 dark:border-fuchsia-600 dark:text-fuchsia-100'

function TableNode({ data }: NodeProps<Node<{ label: string; fullName?: string; focused?: boolean; isView?: boolean }>>) {
  const kind = data.isView ? 'View' : 'Table'
  return (
    <div
      title={data.focused ? `${data.fullName} (${kind.toLowerCase()})` : `${data.fullName} (${kind.toLowerCase()})\nClick to view only this asset's lineage`}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border-2 shadow-sm cursor-pointer ${data.isView ? VIEW_NODE_COLOR : TABLE_NODE_COLOR} ${data.focused ? 'ring-2 ring-amber-400' : ''}`}
      style={{ width: TABLE_WIDTH, height: TABLE_HEIGHT }}
    >
      <Handle type="target" position={Position.Left} />
      {data.isView ? <Layers size={14} className="shrink-0" /> : <Table2 size={14} className="shrink-0" />}
      <span className="font-mono text-xs font-medium truncate">{data.label}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function ProcessNode({ data }: NodeProps<Node<{ queryType?: string | null; processCode?: string | null; processFqn?: string }>>) {
  const colorClass = (data.queryType && QUERY_TYPE_NODE_COLOR[data.queryType.toUpperCase()]) ?? DEFAULT_PROCESS_COLOR
  const [hovered, setHovered] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current) }, [])

  const showTooltip = () => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null }
    setHovered(true)
  }
  const scheduleHideTooltip = () => {
    hideTimer.current = setTimeout(() => setHovered(false), 150)
  }

  const handleClick = () => {
    if (!data.processFqn) return
    navigator.clipboard.writeText(data.processFqn)
    toast.success('Copied process FQN to clipboard')
  }

  return (
    <>
      {/* Rendered via a portal into React Flow's shared renderer layer, so it
          always paints above every node/edge regardless of this node's own
          stacking context — a plain absolutely-positioned div nested inside
          the node cannot escape that context. */}
      <NodeToolbar isVisible={hovered && !!data.processCode} position={Position.Bottom} offset={10}>
        <div
          onMouseEnter={showTooltip}
          onMouseLeave={scheduleHideTooltip}
          className="nodrag nopan w-[420px] max-h-64 overflow-auto rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-3"
        >
          <pre className="text-xs font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words leading-relaxed">
            {data.processCode}
          </pre>
        </div>
      </NodeToolbar>
      <div
        onMouseEnter={showTooltip}
        onMouseLeave={scheduleHideTooltip}
        onClick={handleClick}
        className={`flex items-center justify-center gap-1.5 px-2 rounded-full border-2 shadow-sm cursor-pointer ${colorClass}`}
        style={{ width: PROCESS_WIDTH, height: PROCESS_HEIGHT }}
      >
        <Handle type="target" position={Position.Left} />
        <Cpu size={13} className="shrink-0" />
        <span className="text-[11px] font-semibold truncate">{data.queryType ?? '?'}</span>
        <Handle type="source" position={Position.Right} />
      </div>
    </>
  )
}

const NODE_TYPES = { table: TableNode, process: ProcessNode }

const plural = (n: number, singular: string, pluralForm = `${singular}s`) => `${n} ${n === 1 ? singular : pluralForm}`

/** Nodes/edges outside `path` are drawn faded; omit `path` to draw everything at full strength. */
function layout(
  graph: LineageGraph,
  focusTable: string | null = null,
  path?: { nodeIds: Set<string>; edgeKeys: Set<string> },
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 24, ranksep: 90 })

  for (const n of graph.nodes) {
    const isTable = n.type === 'table'
    g.setNode(n.id, { width: isTable ? TABLE_WIDTH : PROCESS_WIDTH, height: isTable ? TABLE_HEIGHT : PROCESS_HEIGHT })
  }
  for (const e of graph.edges) {
    g.setEdge(e.source, e.target)
  }
  dagre.layout(g)

  // The focused table is often one of very many inputs to a process (e.g. 1 of 148), and
  // dagre can park it thousands of px above/below that process in the same column. Swap it
  // with the dimmed sibling level with the process so the direct path reads in a straight
  // line and can be framed at a readable zoom. Same-size nodes in one column, so no overlap.
  if (path && focusTable) {
    const focus = graph.nodes.find(n => n.type === 'table' && n.full_name === focusTable)
    if (focus) {
      const degree = new Map<string, number>()
      for (const e of graph.edges) {
        degree.set(e.source, (degree.get(e.source) ?? 0) + 1)
        degree.set(e.target, (degree.get(e.target) ?? 0) + 1)
      }
      const hubId = graph.edges
        .filter(e => path.edgeKeys.has(edgeKey(e)) && (e.source === focus.id || e.target === focus.id))
        .map(e => (e.source === focus.id ? e.target : e.source))
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

  const nodes: Node[] = graph.nodes.map(n => {
    const pos = g.node(n.id)
    const isTable = n.type === 'table'
    return {
      id: n.id,
      type: n.type,
      position: { x: pos.x - pos.width / 2, y: pos.y - pos.height / 2 },
      data: isTable
        ? { label: n.label, fullName: n.full_name, isView: n.is_view, focused: focusTable !== null && n.full_name === focusTable }
        : { queryType: n.query_type, processCode: n.process_code, processFqn: n.process_fqn },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      ...(path && !path.nodeIds.has(n.id) && { style: { opacity: DIMMED_OPACITY } }),
    }
  })

  const edges: Edge[] = graph.edges.map((e, i) => {
    const color = EDGE_COLOR[e.kind]
    const dimmed = !!path && !path.edgeKeys.has(edgeKey(e))
    const isOutput = e.kind === 'output'
    // Mapping edges say how many columns are mapped; skipped on dimmed ones to keep a big graph legible.
    const label = e.kind === 'mapping' && e.column_count && !dimmed ? plural(e.column_count, 'col') : undefined
    return {
      id: `e${i}`,
      source: e.source,
      target: e.target,
      type: 'default',
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

function Legend({ hasViews, mode }: { hasViews: boolean; mode: GraphMode }) {
  const swatch = 'inline-block w-3.5 h-3.5 rounded border-2'
  return (
    <div className="flex items-center gap-3 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/90 text-[11px] text-slate-600 dark:text-slate-300 shadow-sm">
      <span className="flex items-center gap-1.5"><span className={`${swatch} ${TABLE_NODE_COLOR}`} />Table</span>
      {hasViews && <span className="flex items-center gap-1.5"><span className={`${swatch} ${VIEW_NODE_COLOR}`} />View</span>}
      {mode === 'mapping' ? (
        <span className="flex items-center gap-1.5" title="Source table/view → target table/view: data is mapped from one to the other (maps_to)">
          <svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" stroke={EDGE_COLOR.mapping} strokeWidth="2" /></svg>
          maps to
        </span>
      ) : (
        <>
          <span className="flex items-center gap-1.5" title="Table → process: the process reads from the table">
            <svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" stroke={EDGE_COLOR.input} strokeWidth="2" /></svg>
            read
          </span>
          <span className="flex items-center gap-1.5" title="Process → table: the process writes to the table">
            <svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" stroke={EDGE_COLOR.output} strokeWidth="2" strokeDasharray="4 3" /></svg>
            write
          </span>
        </>
      )}
    </div>
  )
}

interface CanvasProps {
  nodes: Node[]
  edges: Edge[]
  mode: GraphMode
  onTableClick: (fullName: string) => void
  /** Frame just these nodes on first render instead of the whole graph (which may be far too big to read). */
  fitNodeIds?: string[]
}

// Seeds React Flow's node/edge state from props once, on mount. FlowGraph gives
// this a fresh `key` whenever the graph or focus changes, so a new layout is
// picked up by remounting — which also re-runs `fitView` for the new node set
// (it only fits once per mount) and drops any manual dragging; positions are
// session-only, not persisted, so that reset is intentional.
function GraphCanvas({ nodes: initialNodes, edges: initialEdges, mode, onTableClick, fitNodeIds }: CanvasProps) {
  const { theme } = useTheme()
  const [nodes, , onNodesChange] = useNodesState<Node>(initialNodes)
  const [edges, , onEdgesChange] = useEdgesState<Edge>(initialEdges)

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={(_, node) => {
        if (node.type === 'table' && typeof node.data.fullName === 'string') onTableClick(node.data.fullName)
      }}
      nodeTypes={NODE_TYPES}
      colorMode={theme}
      // Default is 0: any mouse movement between press and release counts as a
      // drag and swallows the click, which a real mouse/trackpad nearly always
      // does by a pixel or two. This lets a click with a few px of jitter still
      // register (for focusing a table, or copying a process FQN); a real drag
      // still moves the node.
      nodeClickDistance={5}
      // Default 0.5 can't fit a graph of a few hundred nodes on screen.
      minZoom={0.05}
      fitView
      // The extra default margin keeps the legend (top-left) clear of the first fit's content.
      fitViewOptions={fitNodeIds ? { nodes: fitNodeIds.map(id => ({ id })), padding: 0.3, maxZoom: 1 } : { padding: 0.15 }}
      proOptions={{ hideAttribution: true }}
    >
      <Background />
      <Controls />
      <MiniMap pannable zoomable />
      <Panel position="top-left">
        <Legend hasViews={initialNodes.some(n => n.data.isView)} mode={mode} />
      </Panel>
    </ReactFlow>
  )
}

export default function FlowGraph({ folder, focusTable, onFocusChange, focusScope, onScopeChange, graphMode, onGraphModeChange }: Props) {
  // One graph per folder+mode, kept for as long as this tab is open so flipping the
  // selector back and forth doesn't refetch. `focusTable` is a full_name, which is the
  // same in every mode, so a focused asset stays focused when the mode changes.
  const [cache, setCache] = useState<Record<string, LineageGraph>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const cacheKey = `${folder}|${graphMode}`
  const graph = cache[cacheKey] ?? null
  const error = errors[cacheKey] ?? null
  const loading = !graph && !error

  useEffect(() => {
    if (cache[cacheKey]) return
    let cancelled = false
    setErrors(({ [cacheKey]: _dropped, ...rest }) => rest)
    getGraph(folder, graphMode)
      .then(g => { if (!cancelled) setCache(c => ({ ...c, [cacheKey]: g })) })
      .catch(e => { if (!cancelled) setErrors(x => ({ ...x, [cacheKey]: e.message })) })
    return () => { cancelled = true }
    // Deliberately keyed on cacheKey alone: refetch only when the folder or mode changes.
  }, [cacheKey])

  // Full layout is cached separately so Reset returns to it without re-running dagre.
  const fullLayout = useMemo(() => (graph ? layout(graph) : null), [graph])
  const focused = useMemo(
    () => (graph && focusTable ? focusLineage(graph, focusTable, focusScope) : null),
    [graph, focusTable, focusScope],
  )
  const focusedLayout = useMemo(
    () => (focused
      ? layout(focused.graph, focusTable, focusScope === 'full'
        ? { nodeIds: focused.pathNodeIds, edgeKeys: focused.pathEdgeKeys }
        : undefined)
      : null),
    [focused, focusTable, focusScope],
  )

  const isMapping = graphMode === 'mapping'
  const shown = focusTable ? focusedLayout : fullLayout
  const graphEmpty = !loading && !error && !!graph && graph.nodes.length === 0

  // The selector and banner render in every state, including loading/error/empty, so a
  // mode with nothing to show (e.g. no maps_to edges) can always be switched away from.
  let body: React.ReactNode
  if (loading) {
    body = <div className="flex items-center gap-2 text-slate-500 py-4"><Loader2 size={16} className="animate-spin" /> Loading…</div>
  } else if (error) {
    body = <div className="px-3 py-2 bg-red-50 dark:bg-red-900/40 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 text-sm rounded">{error}</div>
  } else if (graphEmpty) {
    body = (
      <div className="text-slate-500 italic text-sm py-4">
        {isMapping ? 'No data mapping found — this lineage has no maps_to edges.' : 'No lineage graph data found.'}
      </div>
    )
  } else {
    body = (
      <div className="relative flex-1 min-h-0 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
        {shown ? (
          <div className="absolute inset-0">
            <GraphCanvas
              key={`${folder}|${graphMode}|${focusTable ?? ''}|${focusTable ? focusScope : ''}`}
              nodes={shown.nodes}
              edges={shown.edges}
              mode={graphMode}
              onTableClick={onFocusChange}
              fitNodeIds={focusTable && focusScope === 'full' && focused ? [...focused.pathNodeIds] : undefined}
            />
          </div>
        ) : (
          <div className="p-4 text-sm text-slate-500 italic">
            {isMapping
              ? <>No data mapping found for <span className="font-mono not-italic">{focusTable}</span> — no maps_to edge links it to another table or view.</>
              : <>No lineage found for <span className="font-mono not-italic">{focusTable}</span> — no process reads from or writes to it.</>}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full gap-2">
      <div className="shrink-0 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Segmented ariaLabel="Lineage view" options={MODE_OPTIONS} value={graphMode} onChange={onGraphModeChange} tone="indigo" />
        {!focusTable && (
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <MousePointerClick size={13} className="shrink-0" />
            Click a table or view to focus on its {isMapping ? 'data mapping' : 'lineage'}.
          </span>
        )}
      </div>

      {focusTable && (
        <div className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 rounded-lg border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 text-sm">
          <Crosshair size={14} className="shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="text-slate-600 dark:text-slate-400">{isMapping ? 'Data mapping of' : 'Lineage of'}</span>
          <span className="font-mono font-semibold text-cyan-700 dark:text-cyan-300 break-all">{focusTable}</span>
          {focused && (
            <span className="text-xs text-slate-500 tabular-nums">
              {plural(focused.upstreamTables, 'upstream table')} · {plural(focused.downstreamTables, 'downstream table')}
              {focusScope === 'full' && <> · {plural(focused.relatedTables, 'related table')} (dimmed)</>}
              {focused.processes > 0 && <> · {plural(focused.processes, 'process', 'processes')}</>}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Segmented
              ariaLabel="Lineage scope"
              options={SCOPE_OPTIONS.map(o => ({ ...o, hint: SCOPE_HINTS[graphMode][o.id] }))}
              value={focusScope}
              onChange={onScopeChange}
              tone="amber"
            />
            <button
              onClick={() => onFocusChange(null)}
              title="Show the whole lineage again"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border border-amber-400 dark:border-amber-600 text-amber-800 dark:text-amber-200 bg-white dark:bg-slate-900 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
            >
              <RotateCcw size={12} /> Reset
            </button>
          </div>
        </div>
      )}

      {body}
    </div>
  )
}
