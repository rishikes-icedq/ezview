import { Fragment, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUp, Columns3, Loader2, Search, Sigma, Sheet, X } from 'lucide-react'
import { getColumnLineage } from '../../api/lineage'
import { confidenceColor } from '../../utils/format'
import { hopTooltip, levelRank, levelText, weakestLevel } from '../../utils/confidence'
import type { ColumnLineage, ColumnLineageField, ColumnLineageNode, EdgeSays } from '../../types'

interface Props {
  folder: string
  /** Power BI crawl folder chosen by hand (for model names); null = the one found next to the bundle. */
  crawl: string | null
  modelId: string
  /** The table of the model whose fields are shown. */
  table: string
  onClose: () => void
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// A database column is cyan like a table elsewhere in the graph; a field of a model is lime like a model's table.
const NODE_STYLE: Record<ColumnLineageNode['kind'], string> = {
  column: 'bg-cyan-50 border-cyan-300 text-cyan-900 dark:bg-cyan-900/30 dark:border-cyan-700 dark:text-cyan-100',
  field: 'bg-lime-50 border-lime-400 text-lime-900 dark:bg-lime-900/30 dark:border-lime-700 dark:text-lime-100',
}

function NodeChip({ node }: { node: ColumnLineageNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 max-w-full rounded border px-1.5 py-0.5 text-[11px] leading-tight ${NODE_STYLE[node.kind]}`}
      title={`${node.label} (${node.type_name})${node.model ? ` in ${node.model}` : ''}`}
    >
      {/* Both are columns; a table has its own icon (the one in the header above). */}
      <Columns3 size={10} className="shrink-0" aria-hidden="true" />
      {node.model && <span className="opacity-60">{node.model} ·</span>}
      <span className="font-mono break-all">{node.label}</span>
    </span>
  )
}

/** One step of a path. Its colour is the `confidence` the data gives that edge and hovering it says what it says. */
function Hop({ says }: { says?: EdgeSays }) {
  return (
    <span
      title={hopTooltip(says)}
      data-confidence={says?.confidence}
      className={`inline-flex shrink-0 px-0.5 ${says?.confidence ? levelText(says.confidence) : 'text-slate-400'}`}
    >
      <ArrowRight size={11} aria-hidden="true" />
    </span>
  )
}

/** The field the path belongs to, at its end (upstream) or start (downstream): the arrow next to it is the last or first step. */
function FieldEnd() {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-dashed border-slate-400 dark:border-slate-600 px-1.5 py-0.5 text-[11px] leading-tight italic text-slate-500 dark:text-slate-400">
      this field
    </span>
  )
}

/**
 * A path as a chain of chips joined by arrows, ending at (upstream) or starting from (downstream) the field itself. A
 * node says what the data says about the edge that joins it to the node on the field's side of it, so that arrow is
 * drawn after it upstream and before it downstream; the badge is the weakest `confidence` along the path.
 */
function Chain({ path, direction }: { path: ColumnLineageNode[]; direction: 'up' | 'down' }) {
  const weakest = weakestLevel(path.map(n => n.link?.confidence))
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
      {direction === 'down' && <><FieldEnd /><Hop says={path[0]?.link} /></>}
      {path.map((n, i) => (
        <Fragment key={i}>
          {direction === 'down' && i > 0 && <Hop says={n.link} />}
          <NodeChip node={n} />
          {direction === 'up' && <Hop says={n.link} />}
        </Fragment>
      ))}
      {direction === 'up' && <FieldEnd />}
      {weakest && (
        <span className={`ml-1 text-[9px] px-1 rounded ${confidenceColor(weakest)}`} title="confidence: the weakest of the links on this path">{weakest}</span>
      )}
    </div>
  )
}

function FieldRow({ field, table, typeNames }: { field: ColumnLineageField; table: string; typeNames?: ColumnLineage['type_names'] }) {
  const none = field.upstream.length === 0 && field.downstream.length === 0 && !field.measures
  return (
    <li className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800">
      {/* Written as Table[Column], as in DAX: a field can have the name of its table (a field-parameter table's "Date Selection"). */}
      <div className="font-mono text-xs break-all mb-1" title={`${field.name} (${typeNames?.field ?? 'field'}) of ${table}${typeNames?.table ? ` (${typeNames.table})` : ''}`}>
        <Columns3 size={12} className="inline-block align-[-2px] mr-1 text-lime-600 dark:text-lime-400" aria-label={typeNames?.field ?? 'field'} />
        <span className="text-slate-400 dark:text-slate-500">{table}[</span>
        <span className="font-semibold text-slate-800 dark:text-slate-100">{field.name}</span>
        <span className="text-slate-400 dark:text-slate-500">]</span>
      </div>
      {none && <div className="text-[11px] italic text-slate-500">No lineage for this field in the bundle.</div>}
      {field.upstream.length > 0 && (
        <div className="flex gap-2 mb-1">
          <span className="flex items-center gap-0.5 shrink-0 w-14 pt-0.5 text-[10px] uppercase tracking-wide text-slate-500" title="Where this field comes from">
            <ArrowUp size={11} /> from
          </span>
          <div className="flex flex-col gap-1 min-w-0">{field.upstream.map((p, i) => <Chain key={i} path={p} direction="up" />)}</div>
        </div>
      )}
      {field.downstream.length > 0 && (
        <div className="flex gap-2 mb-1">
          <span className="flex items-center gap-0.5 shrink-0 w-14 pt-0.5 text-[10px] uppercase tracking-wide text-slate-500" title="Where this field goes">
            <ArrowDown size={11} /> to
          </span>
          <div className="flex flex-col gap-1 min-w-0">{field.downstream.map((p, i) => <Chain key={i} path={p} direction="down" />)}</div>
        </div>
      )}
      {field.measures && (
        <div className="flex gap-2">
          <span className="flex items-center gap-0.5 shrink-0 w-14 pt-0.5 text-[10px] tracking-wide text-slate-500" title="Measures that read this field (read_by)">
            <Sigma size={11} /> read_by
          </span>
          <div className="text-[11px] text-slate-700 dark:text-slate-300 min-w-0">
            <span className="font-medium">{plural(field.measures.count, 'measure')}</span>
            {': '}
            {field.measures.names.join(', ')}
            {field.measures.count > field.measures.names.length && <span className="text-slate-500">, … +{field.measures.count - field.measures.names.length} more</span>}
            {field.measures.confidence && (
              <span className={`ml-1.5 text-[9px] px-1 rounded ${confidenceColor(field.measures.confidence)}`} title="confidence: the weakest of the edges to these measures">{field.measures.confidence}</span>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

/**
 * Column lineage of one table of a Power BI model: for each of its fields, where it comes from (a database column, or
 * the same field of the model it is built on) and where it goes (the same field in the models built on it, the
 * measures that read it). Shown over the right of the graph; the graph itself only draws table-level links.
 */
export default function ColumnLineagePanel({ folder, crawl, modelId, table, onClose }: Props) {
  const [data, setData] = useState<ColumnLineage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    setFilter('')
    getColumnLineage(folder, modelId, table, crawl)
      .then(d => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [folder, crawl, modelId, table])

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return data ? data.fields.filter(f => !q || f.name.toLowerCase().includes(q)) : []
  }, [data, filter])

  // The confidence levels the arrows carry, weakest first: the key to their colours.
  const levels = useMemo(() => {
    const found = new Set<string>()
    for (const f of data?.fields ?? []) for (const path of [...f.upstream, ...f.downstream]) for (const n of path) if (n.link?.confidence) found.add(n.link.confidence)
    return [...found].sort((a, b) => (levelRank(a) ?? 9) - (levelRank(b) ?? 9))
  }, [data])
  const withUp = data?.fields.filter(f => f.upstream.length > 0).length ?? 0
  const withDown = data?.fields.filter(f => f.downstream.length > 0 || f.measures).length ?? 0

  return (
    <aside
      aria-label={`Column lineage of ${table}`}
      data-testid="column-lineage"
      className="absolute inset-y-0 right-0 z-20 flex flex-col w-[500px] max-w-[94%] bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700 shadow-2xl"
    >
      <header className="shrink-0 flex items-start gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-800">
        <Sheet size={15} className="mt-0.5 shrink-0 text-lime-600 dark:text-lime-400" aria-label={data?.type_names?.table} />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-sm font-semibold text-slate-800 dark:text-slate-100 break-all">{table}</div>
          <div className="text-xs text-slate-500">
            {data ? data.model.name : 'Column lineage'}
            {data && <> · {plural(data.fields.length, 'field')} · {withUp} with a source · {withDown} used downstream</>}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close column lineage"
          title="Close (Esc)"
          data-testid="column-lineage-close"
          className="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <X size={16} />
        </button>
      </header>

      {levels.length > 0 && (
        <div data-testid="column-lineage-key" className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-1.5 border-b border-slate-200 dark:border-slate-800 text-[10px] text-slate-500">
          <span title="Each arrow is coloured by the confidence the data gives that edge. Hover an arrow for what it says.">confidence of each link:</span>
          {levels.map(level => (
            <span key={level} className="inline-flex items-center gap-0.5"><span className={levelText(level)} aria-hidden="true">→</span>{level}</span>
          ))}
        </div>
      )}

      {data && data.fields.length > 8 && (
        <div className="shrink-0 px-4 py-2 border-b border-slate-200 dark:border-slate-800">
          <label className="flex items-center gap-2 px-2 py-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs">
            <Search size={12} className="shrink-0 text-slate-400" />
            <input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filter fields…"
              aria-label="Filter fields"
              className="flex-1 min-w-0 bg-transparent outline-none text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
            />
          </label>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {!data && !error && (
          <div className="flex items-center gap-2 px-4 py-4 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading…</div>
        )}
        {error && <div className="m-4 px-3 py-2 rounded border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/40 text-sm text-red-700 dark:text-red-300">{error}</div>}
        {data && data.fields.length === 0 && <div className="px-4 py-4 text-sm italic text-slate-500">The bundle lists no fields for this table.</div>}
        {data && shown.length === 0 && data.fields.length > 0 && <div className="px-4 py-4 text-sm italic text-slate-500">No field matches “{filter}”.</div>}
        {data && shown.length > 0 && <ul>{shown.map(f => <FieldRow key={f.name} field={f} table={table} typeNames={data.type_names} />)}</ul>}
        {data?.truncated && (
          <div className="px-4 py-2 text-[11px] text-slate-500">Some fields go on to more places than are listed here (the first {12} paths of each are shown).</div>
        )}
      </div>
    </aside>
  )
}
