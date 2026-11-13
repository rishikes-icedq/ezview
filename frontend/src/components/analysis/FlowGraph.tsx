import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow, Background, Controls, MiniMap, Position, Handle, NodeToolbar, Panel,
  useNodesState, useEdgesState, useReactFlow, useStore,
  type Node, type Edge, type NodeProps, type ReactFlowInstance, type FitViewOptions,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Loader2, Table2, Layers, Cpu, Boxes, Box, Sheet, BarChart3, LayoutDashboard, PanelTop, ChevronDown, ChevronUp, Crosshair, RotateCcw, MousePointerClick, Maximize2, Minimize2, Sigma, Columns3, Workflow, ShieldCheck, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { getGraph } from '../../api/lineage'
import ColumnLineagePanel from './ColumnLineagePanel'
import LineageEdge, { type LineageEdgeData } from './LineageEdge'
import { useTheme } from '../../contexts/ThemeContext'
import { focusLineage, type FocusScope } from '../../utils/lineageFocus'
import { levelRank } from '../../utils/confidence'
import { layoutLineage, DIMMED_OPACITY, EDGE_COLOR, TABLE_WIDTH, TABLE_HEIGHT, PROCESS_WIDTH, PROCESS_HEIGHT, SP_HEADER_HEIGHT, MEMBER_HEIGHT } from './flowLayout'
import type { BiAssetType, GraphMode, LineageGraph } from '../../types'

interface Props {
  folder: string
  /** Power BI crawl folder chosen by hand (for names); null = the one found next to the bundle. */
  crawl: string | null
  /** `database.schema.table` of the asset whose lineage alone is shown; null shows the whole graph. */
  focusTable: string | null
  onFocusChange: (fullName: string | null) => void
  focusScope: FocusScope
  onScopeChange: (scope: FocusScope) => void
  graphMode: GraphMode
  onGraphModeChange: (mode: GraphMode) => void
  /** The graph fills the whole window and everything else (toolbars, tabs, header, sidebar) is hidden. Esc leaves it. */
  maximized?: boolean
  onMaximizedChange?: (maximized: boolean) => void
}

const MODE_OPTIONS: { id: GraphMode; label: string; hint: string }[] = [
  { id: 'all', label: 'All', hint: 'Tables and views together with the processes that read and write them. Processes run by a stored_procedure sit inside its yellow box (click the arrow to open it); one that calls another is linked to it (yellow). A view has no process, so it is linked straight to what it maps from (pink). Power BI: where the bundle has no process in between, what reads what is linked directly (read_by). A semantic_model has an arrow when the bundle says what is inside it: open it to see its semantic_tables and the fields and measures linked to each other. Click a semantic_table to see, field by field, where the fields come from and go.' },
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

// Power BI assets. Hues are picked to stay clear of table (cyan), view (fuchsia) and stored procedure (yellow).
// What each kind is CALLED on screen is not decided here: it is the name the data uses (a node's `type_name`: a path's kind segment
// such as semantic_model, or the source_type/target_type tag such as bimodel).
const BI_NODE_STYLE: Record<BiAssetType, { color: string; /** While open as a box around what it holds: translucent, so the links behind it show. */ openColor?: string; Icon: LucideIcon; hint?: string }> = {
  bitable: {
    color: 'bg-lime-100 border-lime-500 text-lime-900 dark:bg-lime-900/40 dark:border-lime-600 dark:text-lime-100',
    Icon: Sheet,
    hint: 'its fields are rolled up into it',
  },
  bimodel: {
    color: 'bg-violet-100 border-violet-400 text-violet-900 dark:bg-violet-900/50 dark:border-violet-600 dark:text-violet-100',
    openColor: 'bg-violet-100/60 border-violet-400 text-violet-900 dark:bg-violet-900/25 dark:border-violet-600 dark:text-violet-100',
    Icon: Box,
    hint: 'its tables, measures and fields are rolled up into it; if it has an arrow, click it to open them',
  },
  bireport: {
    color: 'bg-orange-100 border-orange-400 text-orange-900 dark:bg-orange-900/40 dark:border-orange-600 dark:text-orange-100',
    Icon: BarChart3,
  },
  bitile: {
    color: 'bg-emerald-100 border-emerald-500 text-emerald-900 dark:bg-emerald-900/40 dark:border-emerald-600 dark:text-emerald-100',
    Icon: LayoutDashboard,
  },
  bidashboard: {
    color: 'bg-pink-100 border-pink-400 text-pink-900 dark:bg-pink-900/40 dark:border-pink-600 dark:text-pink-100',
    Icon: PanelTop,
  },
  bidataflow: {
    color: 'bg-sky-100 border-sky-400 text-sky-900 dark:bg-sky-900/40 dark:border-sky-600 dark:text-sky-100',
    Icon: Workflow,
  },
}
const BI_ASSET_ORDER: BiAssetType[] = ['bitable', 'bimodel', 'bireport', 'bitile', 'bidashboard', 'bidataflow']

/** The table of a model whose column lineage is open (marked on the graph), or null. */
const SelectedChipContext = createContext<{ modelId: string; table: string } | null>(null)

/** Opens/closes a container box (a stored procedure, a Power BI model). Given by GraphCanvas, which also keeps the box where it was on screen. */
const ContainerToggleContext = createContext<(nodeId: string, fullName: string) => void>(() => {})

type TableNodeData = {
  label: string
  /** Node width: wider than the standard for a Power BI asset with a long name, or for a model's arrow. */
  width?: number
  /** Taller than a table when this is a model that is open, with its measures and fields inside. */
  height?: number
  fullName?: string
  focused?: boolean
  isView?: boolean
  assetType?: BiAssetType
  /** What the data calls this kind of asset (a Power BI node), shown under its name. */
  typeName?: string
  /** A model: what the data calls the tables, measures and fields in its box. */
  insideTypeNames?: { table?: string; measure?: string; field?: string }
  details?: { label: string; value: string }[]
  /** A model that has tables, measures or fields to show: how many of each there are, and whether they are shown (in a box under the header). */
  childCount?: number
  tableCount?: number
  measureCount?: number
  fieldCount?: number
  expanded?: boolean
}

const plural = (n: number, singular: string, pluralForm = `${singular}s`) => `${n} ${n === 1 ? singular : pluralForm}`

/** What a model's box holds, for its tooltips, with the names the data uses: "semantic_table (24)", or "semantic_table (40), measure (53), field (2)". */
function describeInside(data: Pick<TableNodeData, 'tableCount' | 'measureCount' | 'fieldCount' | 'insideTypeNames'>) {
  const names = data.insideTypeNames
  return ([['table', data.tableCount], ['measure', data.measureCount], ['field', data.fieldCount]] as const)
    .flatMap(([kind, n]) => (n && names?.[kind] ? [`${names[kind]} (${n})`] : []))
    .join(', ')
}

function TableNode({ id, data }: NodeProps<Node<TableNodeData>>) {
  const toggle = useContext(ContainerToggleContext)
  const bi = data.assetType ? BI_NODE_STYLE[data.assetType] : undefined
  // Named as the data names it: a Power BI asset by its own type_name, a database object by its tag.
  const kind = bi ? data.typeName : data.isView ? 'view' : 'table'
  const open = !!data.expanded
  const color = bi ? (open && bi.openColor ? bi.openColor : bi.color) : data.isView ? VIEW_NODE_COLOR : TABLE_NODE_COLOR
  const Icon = bi ? bi.Icon : data.isView ? Layers : Table2
  const inside = describeInside(data)
  // A Power BI asset is shown by name with what it is underneath; its tooltip adds where it lives (workspace, ...)
  // and, last, its full key. Database tables and views are shown by their key's last part, as before.
  const tooltip = [
    kind ? `${bi ? data.label : data.fullName} (${kind})` : (bi ? data.label : data.fullName),
    ...(data.details ?? []).map(d => `${d.label}: ${d.value}`),
    ...(bi ? [data.fullName] : []),
    ...(data.childCount ? [`${inside ? `Has ${inside}: use` : 'Use'} the arrow to ${open ? 'hide' : 'show'} what is inside`] : []),
    ...(data.focused ? [] : ["Click to view only this asset's lineage"]),
  ].join('\n')
  // Links to and from the model itself meet its header row, also while it is open and much taller than that.
  const handleY = { top: TABLE_HEIGHT / 2 }
  return (
    <div
      title={tooltip}
      className={`rounded-lg border-2 shadow-sm cursor-pointer ${color} ${data.focused ? 'ring-2 ring-amber-400' : ''}`}
      style={{ width: data.width ?? TABLE_WIDTH, height: data.height ?? TABLE_HEIGHT }}
    >
      <Handle type="target" position={Position.Left} style={handleY} />
      <div className={`flex items-center gap-1.5 px-3 ${bi ? 'py-1' : 'py-2'}`} style={{ height: TABLE_HEIGHT - 4 }}>
        <Icon size={14} className="shrink-0" />
        {bi ? (
          <span className="flex-1 min-w-0 leading-tight">
            <span className="block font-mono text-xs font-medium truncate">{data.label}</span>
            {kind && <span className="block text-[10px] opacity-70 truncate">{kind}</span>}
          </span>
        ) : (
          <span className="font-mono text-xs font-medium truncate">{data.label}</span>
        )}
        {!!data.childCount && (
          <button
            // `nodrag` keeps a press here from starting a node drag.
            className="nodrag shrink-0 rounded p-0.5 hover:bg-violet-300/50 dark:hover:bg-violet-700/50 transition-colors"
            aria-label={`${open ? 'Collapse' : 'Expand'} ${data.label}`}
            aria-expanded={open}
            title={open ? 'Hide what is inside' : `Show what is inside${inside ? `: ${inside}` : ''}`}
            onClick={e => {
              e.stopPropagation()
              if (data.fullName) toggle(id, data.fullName)
            }}
          >
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
      </div>
      <Handle type="source" position={Position.Right} style={handleY} />
    </div>
  )
}

// Something inside a model, shown in the model's box while that is open: a table, or a measure or field that is linked to others.
const MEMBER_STYLE = {
  measure: 'bg-white border-violet-400 text-violet-900 dark:bg-slate-900 dark:border-violet-500 dark:text-violet-100',
  field: 'bg-lime-50 border-lime-500 text-lime-900 dark:bg-lime-900/40 dark:border-lime-600 dark:text-lime-100',
  // Same look as a data table elsewhere in the graph: it is the same thing.
  table: BI_NODE_STYLE.bitable.color,
}

type MemberNodeData = {
  label: string
  kind?: 'measure' | 'field' | 'table'
  /** What the data calls it (shown in the tooltip). */
  typeName?: string
  /** Measures and fields: what the data calls the table they live in. */
  tableTypeName?: string
  /** Tables: what the data calls the fields and measures they hold. */
  memberTypeNames?: { field?: string; measure?: string }
  details?: { label: string; value: string }[]
  width: number
  /** Measures and fields: the table of the model they live in. */
  table?: string
  /** The model it belongs to. */
  modelId?: string
  /** Tables only. */
  fieldCount?: number
  measureCount?: number
  fields?: string[]
  measures?: string[]
}

/** "field (3): a, b, c, … +9 more" (titled with the data's name for them) — the names the graph carries are only the first few of a big table. */
const nameList = (title: string | undefined, total = 0, names: string[] = []) =>
  total > 0 && title ? [`${title} (${total}): ${names.join(', ')}${total > names.length ? `, … +${total - names.length} more` : ''}`] : []

/** "field (3), measure (0)": how many of each a table holds, with the data's names. */
const countLine = (data: Pick<MemberNodeData, 'fieldCount' | 'measureCount' | 'memberTypeNames'>) =>
  ([['field', data.fieldCount], ['measure', data.measureCount]] as const)
    .flatMap(([kind, n]) => (data.memberTypeNames?.[kind] ? [`${data.memberTypeNames[kind]} (${n ?? 0})`] : []))
    .join(', ')

function BiMemberNode({ data }: NodeProps<Node<MemberNodeData>>) {
  const selected = useContext(SelectedChipContext)
  const kind = data.kind === 'field' || data.kind === 'table' ? data.kind : 'measure'
  const Icon = kind === 'field' ? Columns3 : kind === 'table' ? Sheet : Sigma
  const tooltip = [
    data.typeName ? `${data.label} (${data.typeName})` : data.label,
    ...(kind === 'table'
      ? [countLine(data), ...nameList(data.memberTypeNames?.field, data.fieldCount, data.fields), ...nameList(data.memberTypeNames?.measure, data.measureCount, data.measures)].filter(Boolean)
      : []),
    ...(data.table ? [data.tableTypeName ? `${data.tableTypeName}: ${data.table}` : data.table] : []),
    ...(data.details ?? []).map(d => `${d.label}: ${d.value}`),
    ...(kind === 'table' ? ['Click to see where each of its fields comes from and goes'] : []),
  ].join(String.fromCharCode(10))
  const isSelected = kind === 'table' && !!selected && selected.modelId === data.modelId && selected.table === data.label
  return (
    <div
      title={tooltip}
      className={`flex items-center gap-1.5 px-2 rounded-md border shadow-sm ${MEMBER_STYLE[kind]} ${kind === 'table' ? 'cursor-pointer' : ''} ${isSelected ? 'ring-2 ring-amber-400' : ''}`}
      style={{ width: data.width, height: MEMBER_HEIGHT }}
    >
      <Handle type="target" position={Position.Left} />
      <Icon size={12} className="shrink-0" />
      <span className={`text-[11px] font-medium truncate ${kind === 'table' ? 'flex-1 min-w-0' : ''}`}>{data.label}</span>
      {kind === 'table' && (
        <>
          {!!data.fieldCount && <span className="shrink-0 flex items-center gap-0.5 text-[10px] opacity-70"><Columns3 size={10} />{data.fieldCount}</span>}
          {!!data.measureCount && <span className="shrink-0 flex items-center gap-0.5 text-[10px] opacity-70"><Sigma size={10} />{data.measureCount}</span>}
        </>
      )}
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
      title={`${data.fullName ?? data.label} (stored_procedure)\nClick to copy its FQN`}
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

const NODE_TYPES = { table: TableNode, process: ProcessNode, stored_procedure: StoredProcedureNode, bi_member: BiMemberNode }
const EDGE_TYPES = { lineage: LineageEdge }

function Legend({ hasViews, biAssets, memberKinds, hasDirect, hasStoredProcedures, hasCalls, mode }: {
  hasViews: boolean
  /** Power BI kinds present in the graph, each with the name the data gives it. */
  biAssets: ReadonlyMap<BiAssetType, string>
  /** Tables, measures and fields drawn inside an open model, each with the name the data gives it. */
  memberKinds: ReadonlyMap<'measure' | 'field' | 'table', string>
  hasDirect: boolean
  hasStoredProcedures: boolean
  hasCalls: boolean
  mode: GraphMode
}) {
  const swatch = 'inline-block w-3.5 h-3.5 rounded border-2'
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/90 text-[11px] text-slate-600 dark:text-slate-300 shadow-sm">
      {/* Every entry is named as the data names it: the source_type/target_type tag (table, view, stored_procedure), or a Power BI asset's own type_name. */}
      <span className="flex items-center gap-1.5"><span className={`${swatch} ${TABLE_NODE_COLOR}`} />table</span>
      {hasViews && <span className="flex items-center gap-1.5"><span className={`${swatch} ${VIEW_NODE_COLOR}`} />view</span>}
      {BI_ASSET_ORDER.filter(k => biAssets.has(k)).map(k => (
        <span key={k} className="flex items-center gap-1.5" title={BI_NODE_STYLE[k].hint}>
          <span className={`${swatch} ${BI_NODE_STYLE[k].color}`} />{biAssets.get(k)}
        </span>
      ))}
      {memberKinds.has('table') && (
        <span className="flex items-center gap-1.5" title="Shown inside its model's box, with how many fields and measures it holds (hover it for their names, click it for the lineage of its fields)">
          <span className={`${swatch} ${MEMBER_STYLE.table}`} />{memberKinds.get('table')}
        </span>
      )}
      {memberKinds.has('measure') && (
        <span className="flex items-center gap-1.5" title="Shown inside its model's box, linked from the fields and measures it is evaluated from">
          <span className={`${swatch} ${MEMBER_STYLE.measure}`} />{memberKinds.get('measure')}
        </span>
      )}
      {memberKinds.has('field') && (
        <span className="flex items-center gap-1.5" title="A column of a table in the model that a measure is evaluated from">
          <span className={`${swatch} ${MEMBER_STYLE.field}`} />{memberKinds.get('field')}
        </span>
      )}
      {hasStoredProcedures && (
        <span className="flex items-center gap-1.5" title="Holds the processes it ran. Click its arrow to show or hide them.">
          <span className={`${swatch} ${STORED_PROCEDURE_COLOR}`} />stored_procedure
        </span>
      )}
      {mode === 'mapping' ? (
        <span className="flex items-center gap-1.5" title="maps_to: data is mapped from the one on the left to the one on the right">
          <svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" stroke={EDGE_COLOR.mapping} strokeWidth="2" /></svg>
          maps_to
        </span>
      ) : (
        <>
          <span className="flex items-center gap-1.5" title="read_by: the one on the left is read by the one on the right">
            <svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" stroke={EDGE_COLOR.input} strokeWidth="2" /></svg>
            read_by
          </span>
          <span className="flex items-center gap-1.5" title="writes_to: the one on the left writes the one on the right">
            <svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" stroke={EDGE_COLOR.output} strokeWidth="2" strokeDasharray="4 3" /></svg>
            writes_to
          </span>
          {hasDirect && (
            <span className="flex items-center gap-1.5" title="maps_to: the one on the left maps to the one on the right, with no process in between">
              <svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" stroke={EDGE_COLOR.direct} strokeWidth="2" /></svg>
              maps_to
            </span>
          )}
          {hasCalls && (
            <span className="flex items-center gap-1.5" title="calls: the one on the left calls the one on the right">
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
  /** A table of a model was clicked: show the lineage of its fields. */
  onTableChipClick: (chip: { modelId: string; table: string }) => void
  /** Frame just these nodes on first render instead of the whole graph (which may be far too big to read). */
  fitNodeIds?: string[]
  maximized: boolean
  onToggleMaximized: () => void
  /** The confidence levels the links of this graph carry, weakest first, and how they are shown (see ConfidenceControls). */
  confidence: ConfidenceView
}

/** How the graph shows confidence: the levels its links carry (weakest first), the lowest one left un-faded, and whether each link says its own. */
interface ConfidenceView {
  levels: string[]
  min: string | null
  onMin: (level: string | null) => void
  show: boolean
  onShow: (show: boolean) => void
}

/**
 * Applies the confidence view to the drawn links: those whose weakest level is below `min` are faded (the same fading as
 * what is off the path of a focused table), and with `show` each link says its weakest level (after any label it has).
 * Links the data says nothing about are left as they are.
 */
function withConfidence(edges: Edge[], min: string | null, show: boolean): Edge[] {
  if (!min && !show) return edges
  const floor = min ? levelRank(min) : undefined
  return edges.map(e => {
    const weakest = (e.data as LineageEdgeData | undefined)?.weakest
    const rank = levelRank(weakest)
    const below = floor !== undefined && rank !== undefined && rank < floor
    if (!below && !(show && weakest)) return e
    return {
      ...e,
      ...(show && weakest && { label: e.label ? `${e.label} · ${weakest}` : weakest, labelStyle: { fontSize: 10, fontWeight: 600 } }),
      ...(below && { animated: false, style: { ...e.style, opacity: DIMMED_OPACITY } }),
    }
  })
}

/** Top-right of the graph: fade the links below a confidence level, and/or write each link's confidence on it. */
function ConfidenceControls({ view }: { view: ConfidenceView }) {
  if (view.levels.length === 0) return null
  return (
    <div
      data-testid="confidence-controls"
      className="flex items-center gap-1.5 h-8 px-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white/90 dark:bg-slate-900/90 text-[11px] text-slate-600 dark:text-slate-300 shadow-sm"
    >
      <ShieldCheck size={13} aria-hidden="true" />
      <span title="confidence: how sure the pipeline is of an edge. Hover a link to see what its edges say.">confidence</span>
      {view.levels.length > 1 && (
        <select
          aria-label="Fade the links with a confidence below"
          title="Fade the links whose weakest confidence is below this level"
          value={view.min ?? ''}
          onChange={e => view.onMin(e.target.value || null)}
          className="bg-transparent text-[11px] outline-none cursor-pointer"
        >
          <option value="">all</option>
          {view.levels.slice(1).map(level => <option key={level} value={level}>≥ {level}</option>)}
        </select>
      )}
      <label className="flex items-center gap-1 cursor-pointer" title="Write each link's confidence on the link">
        <input type="checkbox" checked={view.show} onChange={e => view.onShow(e.target.checked)} />
        on links
      </label>
    </div>
  )
}

/** Maximize / restore button in the graph's top-right corner: the same icon spot in both states, like a map's full-screen control. */
function MaximizeButton({ maximized, onToggle }: { maximized: boolean; onToggle: () => void }) {
  const Icon = maximized ? Minimize2 : Maximize2
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={maximized ? 'Exit full view' : 'Maximize lineage view'}
      title={maximized ? 'Exit full view (Esc)' : 'Maximize: show only the lineage, full window'}
      data-testid="lineage-maximize"
      className="flex items-center justify-center w-8 h-8 rounded-md border border-slate-300 dark:border-slate-700 bg-white/90 dark:bg-slate-900/90 text-slate-600 dark:text-slate-300 shadow-sm transition-colors hover:bg-indigo-50 dark:hover:bg-slate-800 hover:text-indigo-600 dark:hover:text-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <Icon size={16} />
    </button>
  )
}

/**
 * Re-frames the graph once the canvas has finished resizing after `maximized` flips. React Flow keeps the viewport as
 * it was, which would leave the graph in the old top-left corner of a much bigger (or smaller) area. Renders nothing;
 * it lives inside <ReactFlow> to reach its store, whose width/height are updated by React Flow's own resize observer.
 */
function RefitOnMaximizeChange({ maximized, options }: { maximized: boolean; options: FitViewOptions }) {
  const { fitView } = useReactFlow()
  const size = useStore(s => `${s.width}x${s.height}`)
  const pending = useRef(false)
  const first = useRef(true)
  const latest = useRef(options)
  latest.current = options

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    pending.current = true
    // If the canvas ends up the same size, the refit below never fires: don't leave it armed for an unrelated resize.
    const timer = setTimeout(() => { pending.current = false }, 600)
    return () => clearTimeout(timer)
  }, [maximized])

  useEffect(() => {
    if (!pending.current) return
    pending.current = false
    void fitView({ ...latest.current, duration: 200 })
  }, [size, fitView])

  return null
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
function GraphCanvas({ nodes: initialNodes, edges: initialEdges, mode, onTableClick, onToggleContainer, onTableChipClick, fitNodeIds, maximized, onToggleMaximized, confidence }: CanvasProps) {
  const { theme } = useTheme()
  // Room at the top keeps the legend (top-left, over the canvas) clear of the content. (A plain number is a ratio that
  // works out to only ~6% of the height, less than the legend's.)
  const fitOptions: FitViewOptions = fitNodeIds ? { nodes: fitNodeIds.map(id => ({ id })), padding: 0.3, maxZoom: 1 } : { padding: { top: '68px', right: '24px', bottom: '24px', left: '24px' } }
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges)
  const flow = useRef<ReactFlowInstance | null>(null)
  const anchor = useRef<{ id: string; x: number; y: number } | null>(null)

  // New nodes come with a new layout; new edges also with a change of how confidence is shown, which must not undo
  // what has been dragged, so they are seeded apart.
  const nodesSeeded = useRef(false)
  useEffect(() => {
    if (!nodesSeeded.current) {
      nodesSeeded.current = true
      return
    }
    setNodes(initialNodes)
  }, [initialNodes, setNodes])
  const edgesSeeded = useRef(false)
  useEffect(() => {
    if (!edgesSeeded.current) {
      edgesSeeded.current = true
      return
    }
    setEdges(initialEdges)
  }, [initialEdges, setEdges])

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
        else if (node.type === 'bi_member' && node.data.kind === 'table' && typeof node.data.modelId === 'string') {
          onTableChipClick({ modelId: node.data.modelId, table: String(node.data.label) })
        }
      }}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
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
      fitViewOptions={fitOptions}
      proOptions={{ hideAttribution: true }}
    >
      <Background />
      {/* The same margin as the first fit, which keeps the legend (top-left) clear of the content. */}
      <Controls fitViewOptions={fitOptions} />
      <MiniMap pannable zoomable />
      <RefitOnMaximizeChange maximized={maximized} options={fitOptions} />
      <Panel position="top-right">
        <div className="flex items-center gap-2">
          <ConfidenceControls view={confidence} />
          <MaximizeButton maximized={maximized} onToggle={onToggleMaximized} />
        </div>
      </Panel>
      <Panel position="top-left">
        <Legend
          hasViews={initialNodes.some(n => n.data.isView)}
          biAssets={new Map(initialNodes.flatMap(n => (n.data.assetType && n.data.typeName ? [[n.data.assetType as BiAssetType, n.data.typeName as string] as const] : [])))}
          memberKinds={new Map(initialNodes.flatMap(n => (
            n.type === 'bi_member' && n.data.typeName ? [[(n.data.kind === 'field' || n.data.kind === 'table' ? n.data.kind : 'measure') as 'measure' | 'field' | 'table', n.data.typeName as string] as const] : []
          )))}
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

export default function FlowGraph({ folder, crawl, focusTable, onFocusChange, focusScope, onScopeChange, graphMode, onGraphModeChange, maximized = false, onMaximizedChange }: Props) {
  // One graph per folder+mode+crawl, kept for as long as this tab is open so flipping the
  // selector back and forth doesn't refetch. `focusTable` is a full_name, which is the
  // same in every mode, so a focused asset stays focused when the mode changes.
  const [cache, setCache] = useState<Record<string, LineageGraph>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const cacheKey = `${folder}|${graphMode}|${crawl ?? ''}`
  const graph = cache[cacheKey] ?? null
  const error = errors[cacheKey] ?? null
  const loading = !graph && !error

  useEffect(() => {
    if (cache[cacheKey]) return
    let cancelled = false
    setErrors(({ [cacheKey]: _dropped, ...rest }) => rest)
    getGraph(folder, graphMode, crawl)
      .then(g => { if (!cancelled) setCache(c => ({ ...c, [cacheKey]: g })) })
      .catch(e => { if (!cancelled) setErrors(x => ({ ...x, [cacheKey]: e.message })) })
    return () => { cancelled = true }
    // Deliberately keyed on cacheKey alone: refetch only when the folder, mode or crawl changes.
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

  // The focused asset's node, to show a Power BI asset by name rather than by its key.
  const focusNode = useMemo(
    () => (graph && focusTable ? graph.nodes.find(n => n.type === 'table' && n.full_name === focusTable) : undefined),
    [graph, focusTable],
  )

  const isMapping = graphMode === 'mapping'
  const shown = focusTable ? focusedLayout : fullLayout

  // Confidence: the levels the links of this graph carry, the one below which links are faded, and whether links say theirs.
  const [minConfidence, setMinConfidence] = useState<string | null>(null)
  const [showConfidence, setShowConfidence] = useState(false)
  useEffect(() => { setMinConfidence(null) }, [folder])
  const confidenceLevels = useMemo(() => {
    const found = new Set<string>()
    for (const e of shown?.edges ?? []) {
      const level = (e.data as LineageEdgeData | undefined)?.weakest
      if (level) found.add(level)
    }
    return [...found].sort((a, b) => levelRank(a)! - levelRank(b)!)
  }, [shown])
  const shownEdges = useMemo(
    () => (shown ? withConfidence(shown.edges, confidenceLevels.includes(minConfidence ?? '') ? minConfidence : null, showConfidence) : []),
    [shown, minConfidence, showConfidence, confidenceLevels],
  )
  const graphEmpty = !loading && !error && !!graph && graph.nodes.length === 0
  // The path's processes may be folded into a collapsed box, so frame only nodes that are actually drawn.
  const fitNodeIds = useMemo(() => {
    if (!shown || !focusTable || focusScope !== 'full' || !focused) return undefined
    const drawn = new Set(shown.nodes.map(n => n.id))
    return [...focused.pathNodeIds].filter(id => drawn.has(id))
  }, [shown, focusTable, focusScope, focused])

  // The table of a model whose column lineage is open. Belongs to the graph on screen, so it goes with it.
  const [chip, setChip] = useState<{ modelId: string; table: string } | null>(null)
  useEffect(() => { setChip(null) }, [folder, crawl, graphMode])

  // Esc closes the column lineage first, then leaves the maximized view. The restore button is part of the canvas, so if there is no canvas to show (loading,
  // error, nothing to draw) the view must not stay maximized with no way out.
  const canMaximize = !loading && !error && !graphEmpty && !!shown
  useEffect(() => {
    if (maximized && !canMaximize) onMaximizedChange?.(false)
  }, [maximized, canMaximize, onMaximizedChange])
  useEffect(() => {
    if (!maximized && !chip) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (chip) setChip(null)
      else onMaximizedChange?.(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [maximized, chip, onMaximizedChange])

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
      <div className={`relative flex-1 min-h-0 overflow-hidden ${maximized ? '' : 'rounded-lg border border-slate-200 dark:border-slate-800'}`}>
        {shown ? (
          <div className="absolute inset-0">
            <SelectedChipContext.Provider value={chip}>
              <GraphCanvas
                key={`${folder}|${graphMode}|${focusTable ?? ''}|${focusTable ? focusScope : ''}`}
                nodes={shown.nodes}
                edges={shownEdges}
                mode={graphMode}
                onTableClick={onFocusChange}
                onToggleContainer={toggleContainer}
                onTableChipClick={setChip}
                fitNodeIds={fitNodeIds}
                maximized={maximized}
                onToggleMaximized={() => onMaximizedChange?.(!maximized)}
                confidence={{ levels: confidenceLevels, min: minConfidence, onMin: setMinConfidence, show: showConfidence, onShow: setShowConfidence }}
              />
            </SelectedChipContext.Provider>
          </div>
        ) : (
          <div className="p-4 text-sm text-slate-500 italic">
            {isMapping
              ? <>No data mapping found for <span className="font-mono not-italic">{focusTable}</span> — no maps_to edge links it to another table or view.</>
              : <>No lineage found for <span className="font-mono not-italic">{focusTable}</span> — no process reads from or writes to it.</>}
          </div>
        )}
        {chip && <ColumnLineagePanel folder={folder} crawl={crawl} modelId={chip.modelId} table={chip.table} onClose={() => setChip(null)} />}
      </div>
    )
  }

  return (
    <div className={`flex flex-col h-full ${maximized ? '' : 'gap-2'}`}>
      {/* Announces the mode change to screen readers (the visible change is the whole window filling with the graph). */}
      <span className="sr-only" role="status">{maximized ? 'Lineage maximized. Press Escape to exit.' : ''}</span>
      <div className={`shrink-0 flex-wrap items-center gap-x-4 gap-y-1 ${maximized ? 'hidden' : 'flex'}`}>
        <Segmented ariaLabel="Lineage view" options={MODE_OPTIONS} value={graphMode} onChange={onGraphModeChange} tone="indigo" />
        {!focusTable && (
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <MousePointerClick size={13} className="shrink-0" />
            Click a table or view to focus on its {isMapping ? 'data mapping' : 'lineage'}.
          </span>
        )}
      </div>

      {focusTable && (
        <div className={`shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 rounded-lg border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 text-sm ${maximized ? 'hidden' : 'flex'}`}>
          <Crosshair size={14} className="shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="text-slate-600 dark:text-slate-400">{isMapping ? 'Data mapping of' : 'Lineage of'}</span>
          <span className="font-mono font-semibold text-cyan-700 dark:text-cyan-300 break-all" title={focusTable}>{focusNode?.asset_type ? focusNode.label : focusTable}</span>
          {focusNode?.asset_type && focusNode.type_name && <span className="text-xs text-slate-500">({focusNode.type_name})</span>}
          {focused && (
            <span className="text-xs text-slate-500 tabular-nums">
              {plural(focused.upstreamTables, 'upstream table')} · {plural(focused.downstreamTables, 'downstream table')}
              {focusScope === 'full' && <> · {plural(focused.relatedTables, 'related table')} (dimmed)</>}
              {focused.processes > 0 && <> · {plural(focused.processes, 'process', 'processes')}</>}
              {focused.storedProcedures > 0 && <> · stored_procedure ({focused.storedProcedures})</>}
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
