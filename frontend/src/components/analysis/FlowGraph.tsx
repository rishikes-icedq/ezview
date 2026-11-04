import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow, Background, Controls, MiniMap, Position, Handle, NodeToolbar, Panel,
  useNodesState, useEdgesState,
  type Node, type Edge, type NodeProps, type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Loader2, Table2, Layers, Cpu, Boxes, ChevronDown, ChevronUp, Crosshair, RotateCcw, MousePointerClick } from 'lucide-react'
import { toast } from 'sonner'
import { getGraph } from '../../api/lineage'
import { useTheme } from '../../contexts/ThemeContext'
import { focusLineage, type FocusScope } from '../../utils/lineageFocus'
import { layoutLineage, EDGE_COLOR, TABLE_WIDTH, TABLE_HEIGHT, PROCESS_WIDTH, PROCESS_HEIGHT, SP_HEADER_HEIGHT } from './flowLayout'
import type { GraphMode, LineageGraph } from '../../types'

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
  { id: 'all', label: 'All', hint: 'Tables and views together with the processes that read and write them. Processes run by a stored procedure sit inside its yellow box (click the arrow to open it); a procedure that calls another is linked to it (yellow). A view has no process, so it is linked straight to what it maps from (pink).' },
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
// Same hue as EDGE_COLOR.calls. Translucent so the edges that pass behind an expanded box stay visible.
const STORED_PROCEDURE_COLOR = 'bg-yellow-100/80 border-yellow-500 text-yellow-900 dark:bg-yellow-900/30 dark:border-yellow-600 dark:text-yellow-100'

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

function ProcessNode({ data }: NodeProps<Node<{ label: string; queryType?: string | null; processCode?: string | null; processFqn?: string }>>) {
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
        <span className="text-[11px] font-semibold truncate">{data.label}</span>
        <Handle type="source" position={Position.Right} />
      </div>
    </>
  )
}

/** Opens/closes a stored-procedure box. Given by GraphCanvas, which also keeps the box where it was on screen. */
const ContainerToggleContext = createContext<(nodeId: string, fullName: string) => void>(() => {})

// A stored procedure: a box named after it that holds the processes it ran. Collapsed it is just
// the header row and the table edges of its processes attach to it; expanded, the processes are
// drawn inside it (as separate nodes, see layoutLineage) and their edges attach to them. Its
// `calls` edges attach to it either way, hence handles on the header row rather than mid-box.
function StoredProcedureNode({ id, data }: NodeProps<Node<{ label: string; fqn?: string; fullName?: string; expanded: boolean; childCount: number; width: number; height: number }>>) {
  const toggle = useContext(ContainerToggleContext)
  const copyFqn = () => {
    if (!data.fqn) return
    navigator.clipboard.writeText(data.fqn)
    toast.success('Copied stored procedure FQN to clipboard')
  }
  return (
    <div
      onClick={copyFqn}
      title={`Stored procedure ${data.fullName ?? data.label}\nClick to copy its FQN`}
      className={`rounded-lg border-2 shadow-sm cursor-pointer ${STORED_PROCEDURE_COLOR}`}
      style={{ width: data.width, height: data.height }}
    >
      <Handle type="target" position={Position.Left} style={{ top: SP_HEADER_HEIGHT / 2 }} />
      <div className="flex items-center gap-1.5 px-2.5" style={{ height: SP_HEADER_HEIGHT - 4 }}>
        <Boxes size={14} className="shrink-0" />
        <span className="flex-1 min-w-0 text-[11px] font-semibold truncate">{data.label}</span>
        {data.childCount > 0 && (
          <button
            // `nodrag` keeps a press here from starting a node drag.
            className="nodrag shrink-0 rounded p-0.5 hover:bg-yellow-300/60 dark:hover:bg-yellow-700/50 transition-colors"
            aria-label={`${data.expanded ? 'Collapse' : 'Expand'} ${data.label}`}
            aria-expanded={data.expanded}
            title={data.expanded ? 'Collapse' : `Show the ${data.childCount === 1 ? 'process' : `${data.childCount} processes`} inside`}
            onClick={e => {
              e.stopPropagation()
              if (data.fullName) toggle(id, data.fullName)
            }}
          >
            {data.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
      </div>
      <Handle type="source" position={Position.Right} style={{ top: SP_HEADER_HEIGHT / 2 }} />
    </div>
  )
}

const NODE_TYPES = { table: TableNode, process: ProcessNode, stored_procedure: StoredProcedureNode }

const plural = (n: number, singular: string, pluralForm = `${singular}s`) => `${n} ${n === 1 ? singular : pluralForm}`

function Legend({ hasViews, hasDirect, hasStoredProcedures, hasCalls, mode }: {
  hasViews: boolean
  hasDirect: boolean
  hasStoredProcedures: boolean
  hasCalls: boolean
  mode: GraphMode
}) {
  const swatch = 'inline-block w-3.5 h-3.5 rounded border-2'
  return (
    <div className="flex items-center gap-3 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/90 text-[11px] text-slate-600 dark:text-slate-300 shadow-sm">
      <span className="flex items-center gap-1.5"><span className={`${swatch} ${TABLE_NODE_COLOR}`} />Table</span>
      {hasViews && <span className="flex items-center gap-1.5"><span className={`${swatch} ${VIEW_NODE_COLOR}`} />View</span>}
      {hasStoredProcedures && (
        <span className="flex items-center gap-1.5" title="Stored procedure: holds the processes it ran. Click its arrow to show or hide them.">
          <span className={`${swatch} ${STORED_PROCEDURE_COLOR}`} />Stored procedure
        </span>
      )}
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
          {hasDirect && (
            <span className="flex items-center gap-1.5" title="Source table/view → view: a view has no process, so it is linked straight to what it maps from (maps_to)">
              <svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" stroke={EDGE_COLOR.direct} strokeWidth="2" /></svg>
              maps to
            </span>
          )}
          {hasCalls && (
            <span className="flex items-center gap-1.5" title="Stored procedure → stored procedure: the first one calls the second">
              <svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" stroke={EDGE_COLOR.calls} strokeWidth="2" /></svg>
              calls
            </span>
          )}
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
  /** Opens or closes the stored-procedure box with this `full_name`. */
  onToggleContainer: (fullName: string) => void
  /** Frame just these nodes on first render instead of the whole graph (which may be far too big to read). */
  fitNodeIds?: string[]
}

// Seeds React Flow's node/edge state from props on mount. FlowGraph gives this a fresh
// `key` whenever the graph or focus changes, so a new layout is picked up by remounting —
// which also re-runs `fitView` for the new node set (it only fits once per mount) and drops
// any manual dragging; positions are session-only, not persisted, so that reset is intentional.
//
// Opening or closing a stored-procedure box doesn't change the key: it re-lays the graph out,
// which arrives here as new `nodes`/`edges` props that replace the state (dragging is dropped
// as above). The viewport is left alone, except that it is shifted so the box that was
// clicked stays where it was on screen instead of being carried off by the new layout.
function GraphCanvas({ nodes: initialNodes, edges: initialEdges, mode, onTableClick, onToggleContainer, fitNodeIds }: CanvasProps) {
  const { theme } = useTheme()
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges)
  const flow = useRef<ReactFlowInstance | null>(null)
  const anchor = useRef<{ id: string; x: number; y: number } | null>(null)

  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    setNodes(initialNodes)
    setEdges(initialEdges)
  }, [initialNodes, initialEdges, setNodes, setEdges])

  // Runs once the re-laid-out nodes are in place: put the clicked box back where it was on screen.
  useEffect(() => {
    const at = anchor.current
    const instance = flow.current
    if (!at || !instance) return
    anchor.current = null
    requestAnimationFrame(() => {
      const node = instance.getNode(at.id)
      if (!node) return
      const now = instance.flowToScreenPosition(node.position)
      const view = instance.getViewport()
      void instance.setViewport({ x: view.x + at.x - now.x, y: view.y + at.y - now.y, zoom: view.zoom })
    })
  }, [nodes])

  const toggleContainer = useCallback((nodeId: string, fullName: string) => {
    const instance = flow.current
    const node = instance?.getNode(nodeId)
    if (instance && node) {
      const screen = instance.flowToScreenPosition(node.position)
      anchor.current = { id: nodeId, x: screen.x, y: screen.y }
    }
    onToggleContainer(fullName)
  }, [onToggleContainer])

  return (
    <ContainerToggleContext.Provider value={toggleContainer}>
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onInit={instance => { flow.current = instance }}
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
        <Legend
          hasViews={initialNodes.some(n => n.data.isView)}
          hasDirect={initialEdges.some(e => e.data?.kind === 'direct')}
          hasStoredProcedures={initialNodes.some(n => n.type === 'stored_procedure')}
          hasCalls={initialEdges.some(e => e.data?.kind === 'calls')}
          mode={mode}
        />
      </Panel>
    </ReactFlow>
    </ContainerToggleContext.Provider>
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

  // `full_name`s of the stored-procedure boxes that are open; everything starts collapsed.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const toggleContainer = useCallback((fullName: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (!next.delete(fullName)) next.add(fullName)
      return next
    })
  }, [])

  // Full layout is cached separately so Reset returns to it without re-running dagre.
  const fullLayout = useMemo(() => (graph ? layoutLineage(graph, expanded) : null), [graph, expanded])
  const focused = useMemo(
    () => (graph && focusTable ? focusLineage(graph, focusTable, focusScope) : null),
    [graph, focusTable, focusScope],
  )
  const focusedLayout = useMemo(
    () => (focused
      ? layoutLineage(focused.graph, expanded, focusTable, focusScope === 'full'
        ? { nodeIds: focused.pathNodeIds, edgeKeys: focused.pathEdgeKeys }
        : undefined)
      : null),
    [focused, expanded, focusTable, focusScope],
  )

  const isMapping = graphMode === 'mapping'
  const shown = focusTable ? focusedLayout : fullLayout
  const graphEmpty = !loading && !error && !!graph && graph.nodes.length === 0
  // The path's processes may be folded into a collapsed box, so frame only nodes that are actually drawn.
  const fitNodeIds = useMemo(() => {
    if (!shown || !focusTable || focusScope !== 'full' || !focused) return undefined
    const drawn = new Set(shown.nodes.map(n => n.id))
    return [...focused.pathNodeIds].filter(id => drawn.has(id))
  }, [shown, focusTable, focusScope, focused])

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
              onToggleContainer={toggleContainer}
              fitNodeIds={fitNodeIds}
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
              {focused.storedProcedures > 0 && <> · {plural(focused.storedProcedures, 'stored procedure')}</>}
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
