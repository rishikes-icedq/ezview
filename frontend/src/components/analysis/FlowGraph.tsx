import { useEffect, useRef, useState } from 'react'
import {
  ReactFlow, Background, Controls, MiniMap, MarkerType, Position, Handle, NodeToolbar,
  useNodesState, useEdgesState,
  type Node, type Edge, type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from '@dagrejs/dagre'
import { Loader2, Table2, Cpu } from 'lucide-react'
import { toast } from 'sonner'
import { getGraph } from '../../api/lineage'
import { useTheme } from '../../contexts/ThemeContext'
import type { LineageGraph } from '../../types'

interface Props { folder: string }

const TABLE_WIDTH = 200
const TABLE_HEIGHT = 44
const PROCESS_WIDTH = 100
const PROCESS_HEIGHT = 36

// Matches the read/write arrow convention already used in AssetTree.tsx
// (emerald ArrowUpRight = read, indigo ArrowDownLeft = write).
const EDGE_COLOR: Record<'input' | 'output', string> = {
  input: '#10b981',
  output: '#6366f1',
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

function TableNode({ data }: NodeProps<Node<{ label: string; fullName?: string }>>) {
  return (
    <div
      title={data.fullName}
      className="flex items-center gap-1.5 px-3 py-2 rounded-lg border-2 bg-cyan-100 border-cyan-400 text-cyan-900 dark:bg-cyan-900/50 dark:border-cyan-600 dark:text-cyan-100 shadow-sm"
      style={{ width: TABLE_WIDTH, height: TABLE_HEIGHT }}
    >
      <Handle type="target" position={Position.Left} />
      <Table2 size={14} className="shrink-0" />
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

function layout(graph: LineageGraph): { nodes: Node[]; edges: Edge[] } {
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

  const nodes: Node[] = graph.nodes.map(n => {
    const pos = g.node(n.id)
    const isTable = n.type === 'table'
    return {
      id: n.id,
      type: n.type,
      position: { x: pos.x - pos.width / 2, y: pos.y - pos.height / 2 },
      data: isTable
        ? { label: n.label, fullName: n.full_name }
        : { queryType: n.query_type, processCode: n.process_code, processFqn: n.process_fqn },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    }
  })

  const edges: Edge[] = graph.edges.map((e, i) => {
    const color = EDGE_COLOR[e.kind]
    return {
      id: `e${i}`,
      source: e.source,
      target: e.target,
      type: 'default',
      animated: e.kind === 'output',
      markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color },
      style: { stroke: color, strokeWidth: 2 },
      zIndex: 1,
    }
  })

  return { nodes, edges }
}

export default function FlowGraph({ folder }: Props) {
  const [graph, setGraph] = useState<LineageGraph | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { theme } = useTheme()

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  useEffect(() => {
    setLoading(true)
    setError(null)
    getGraph(folder)
      .then(setGraph)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [folder])

  // Re-lays-out (and drops any manual dragging) whenever the underlying graph data changes —
  // manual node positions are session-only, not persisted, so this reset is intentional.
  useEffect(() => {
    if (!graph) return
    const laid = layout(graph)
    setNodes(laid.nodes)
    setEdges(laid.edges)
  }, [graph, setNodes, setEdges])

  if (loading) return <div className="flex items-center gap-2 text-slate-500 py-4"><Loader2 size={16} className="animate-spin" /> Loading…</div>
  if (error) return <div className="px-3 py-2 bg-red-50 dark:bg-red-900/40 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 text-sm rounded">{error}</div>
  if (!graph || graph.nodes.length === 0) return <div className="text-slate-500 italic text-sm py-4">No lineage graph data found.</div>

  return (
    <div className="h-full rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={NODE_TYPES}
        colorMode={theme}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  )
}
