import { useState, useEffect, useCallback, useRef } from 'react'
import { Loader2, Filter, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { getEdges } from '../../api/lineage'
import type { EdgePage, EdgeRow, SortDirection } from '../../types'
import { confidenceColor } from '../../utils/format'
import FqnCell from '../viewers/FqnCell'
import ColResizeHandle from '../shared/ColResizeHandle'
import { useColumnWidths } from '../../hooks/useResizableColumns'

const SEARCH_DEBOUNCE_MS = 350

/** Where a column starts: wide for what is long (a name, a query), narrow for a flag or a level. Any column can be dragged wider. */
const COLUMN_WIDTH: Record<string, number> = {
  edge: 120, source_fqn: 260, target_fqn: 260, process_fqn: 260, edge_id: 200, expression: 280,
  source_type: 130, target_type: 130, transform_type: 140, confidence: 110, resolution_type: 140, fallback_reason: 160,
}
const defaultWidth = (column: string) =>
  COLUMN_WIDTH[column] ?? (column.endsWith('_at') ? 190 : column.startsWith('is_') ? 150 : column.endsWith('_fqn') ? 260 : 150)

type SortCol = 'source_fqn' | 'target_fqn' | ''

interface Filters {
  confidence: string
  transform: string
  direction: string
  sourceType: string
  targetType: string
  sourceSearch: string
  targetSearch: string
  sortBy: SortCol
  sortDir: SortDirection
}

const EMPTY_FILTERS: Filters = {
  confidence: '', transform: '', direction: '', sourceType: '', targetType: '',
  sourceSearch: '', targetSearch: '', sortBy: '', sortDir: 'asc',
}

/** A value of the file as it is: a flag as true/false, a missing value as a dash. */
function Cell({ column, value }: { column: string; value: EdgeRow[string] }) {
  const text = value === null || value === undefined ? '' : String(value)
  if (column === 'edge' && text) {
    return (
      <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${text === 'writes_to' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}>
        {text}
      </span>
    )
  }
  if (column === 'confidence' && text) return <span className={`text-xs px-1.5 py-0.5 rounded ${confidenceColor(text)}`}>{text}</span>
  if (column.endsWith('_fqn')) return <FqnCell value={text} />
  if (!text) return <span className="text-slate-300 dark:text-slate-700">—</span>
  const plain = /_type$|_reason$/.test(column)
  return (
    <span
      className={`block truncate ${plain ? 'text-slate-500 dark:text-slate-400' : 'font-mono text-slate-700 dark:text-slate-300'}`}
      title={text}
    >
      {text}
    </span>
  )
}

interface Props { folder: string }

export default function EdgeTable({ folder }: Props) {
  const [data, setData] = useState<EdgePage | null>(null)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [loading, setLoading] = useState(true)
  const { widthOf, startResize } = useColumnWidths(defaultWidth)
  const searchTimers = useRef<{ source?: number; target?: number }>({})

  const load = useCallback((p: number, f: Filters) => {
    setLoading(true)
    getEdges(folder, {
      page: p,
      page_size: 100,
      confidence: f.confidence || undefined,
      transform: f.transform || undefined,
      direction: f.direction || undefined,
      source_type: f.sourceType || undefined,
      target_type: f.targetType || undefined,
      source_search: f.sourceSearch || undefined,
      target_search: f.targetSearch || undefined,
      sort_by: f.sortBy || undefined,
      sort_dir: f.sortDir,
    })
      .then(setData)
      .finally(() => setLoading(false))
  }, [folder])

  useEffect(() => { load(1, EMPTY_FILTERS) }, [load])

  // Dropdown filters in the header apply immediately on change
  const setHeaderFilter = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch }
    setFilters(next)
    load(1, next)
  }

  // Text search inputs apply after a short pause in typing
  const handleSearchChange = (patch: Partial<Filters>, timerKey: 'source' | 'target') => {
    const next = { ...filters, ...patch }
    setFilters(next)
    if (searchTimers.current[timerKey]) window.clearTimeout(searchTimers.current[timerKey])
    searchTimers.current[timerKey] = window.setTimeout(() => load(1, next), SEARCH_DEBOUNCE_MS)
  }

  const toggleSort = (col: 'source_fqn' | 'target_fqn') => {
    let sortBy: SortCol = col
    let sortDir: SortDirection = 'asc'
    if (filters.sortBy === col) {
      if (filters.sortDir === 'asc') sortDir = 'desc'
      else sortBy = ''
    }
    const next = { ...filters, sortBy, sortDir }
    setFilters(next)
    load(1, next)
  }

  const applyFilters = () => load(1, filters)
  const clearFilters = () => { setFilters(EMPTY_FILTERS); load(1, EMPTY_FILTERS) }

  const opts = data
  const columns = data?.columns ?? []
  const tableWidth = columns.reduce((sum, c) => sum + widthOf(c), 0)
  const selectClass = "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs rounded px-2 py-1 border border-slate-300 dark:border-slate-700 focus:outline-none focus:border-indigo-500"
  const headerSelectClass = "mt-1 w-full max-w-full bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-normal normal-case rounded px-1 py-0.5 border border-slate-300 dark:border-slate-700 focus:outline-none focus:border-indigo-500"
  const headerInputClass = "mt-1 w-full max-w-full bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-normal normal-case rounded px-1 py-0.5 border border-slate-300 dark:border-slate-700 focus:outline-none focus:border-indigo-500 placeholder:text-slate-400 dark:placeholder:text-slate-600"

  const sortIcon = (col: 'source_fqn' | 'target_fqn') => {
    if (filters.sortBy !== col) return <ChevronsUpDown size={11} className="text-slate-300 dark:text-slate-700 shrink-0" />
    return filters.sortDir === 'asc'
      ? <ChevronUp size={11} className="shrink-0" />
      : <ChevronDown size={11} className="shrink-0" />
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 p-3 bg-slate-100/60 dark:bg-slate-800/40 border border-slate-300 dark:border-slate-700 rounded-lg">
        <Filter size={13} className="text-slate-500" />
        <select value={filters.confidence} onChange={e => setFilters(f => ({ ...f, confidence: e.target.value }))} className={selectClass}>
          <option value="">All Confidence</option>
          {(opts?.confidence_options ?? ['HIGH','MEDIUM','LOW']).map(o => <option key={o}>{o}</option>)}
        </select>
        <select value={filters.transform} onChange={e => setFilters(f => ({ ...f, transform: e.target.value }))} className={selectClass}>
          <option value="">All Transforms</option>
          {(opts?.transform_options ?? []).map(o => <option key={o}>{o}</option>)}
        </select>
        <button onClick={applyFilters} className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3 py-1 rounded transition-colors">Apply</button>
        <button onClick={clearFilters} className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-700 transition-colors">Clear</button>
        <span className="text-slate-400 dark:text-slate-600 text-xs italic">edge, source_fqn, source_type, target_fqn and target_type filter directly in the column headers below</span>
        {data && <span className="ml-auto text-slate-500 text-xs" data-testid="edge-counts">{data.total.toLocaleString()} edges · {columns.length} columns</span>}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 py-4"><Loader2 size={16} className="animate-spin" /> Loading…</div>
      ) : !data?.rows.length ? (
        <div className="text-slate-500 italic text-sm py-4">No edges match the current filter.</div>
      ) : (
        <>
          {/* Every column of edges.parquet, in the file's order and under its own names; wider than the page, it scrolls sideways. */}
          <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg" data-testid="edge-table-scroll">
            <table className="w-full text-xs border-collapse table-fixed" style={{ minWidth: tableWidth }} data-testid="edge-table">
              <colgroup>
                {columns.map(c => <col key={c} style={{ width: widthOf(c) }} />)}
              </colgroup>
              <thead>
                <tr className="bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
                  {columns.map((c, i) => (
                    <th key={c} data-column={c} className="relative align-top text-left px-3 py-2 text-slate-500 dark:text-slate-400 font-medium">
                      {c === 'source_fqn' || c === 'target_fqn' ? (
                        <button
                          onClick={() => toggleSort(c)}
                          className="flex items-center gap-1 truncate w-full text-left cursor-pointer hover:text-slate-800 dark:hover:text-slate-200"
                        >
                          <span className="truncate font-mono text-[11px]">{c}</span>
                          {sortIcon(c)}
                        </button>
                      ) : (
                        <div className="truncate font-mono text-[11px]" title={c}>{c}</div>
                      )}

                      {c === 'edge' && (
                        <select
                          value={filters.direction}
                          onChange={e => setHeaderFilter({ direction: e.target.value })}
                          className={headerSelectClass}
                        >
                          <option value="">All</option>
                          {(opts?.direction_options ?? ['writes_to', 'read_by']).map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      )}
                      {c === 'source_fqn' && (
                        <input
                          type="text"
                          value={filters.sourceSearch}
                          onChange={e => handleSearchChange({ sourceSearch: e.target.value }, 'source')}
                          placeholder="contains…"
                          className={headerInputClass}
                        />
                      )}
                      {c === 'source_type' && (
                        <select
                          value={filters.sourceType}
                          onChange={e => setHeaderFilter({ sourceType: e.target.value })}
                          className={headerSelectClass}
                        >
                          <option value="">All</option>
                          {(opts?.source_type_options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      )}
                      {c === 'target_fqn' && (
                        <input
                          type="text"
                          value={filters.targetSearch}
                          onChange={e => handleSearchChange({ targetSearch: e.target.value }, 'target')}
                          placeholder="contains…"
                          className={headerInputClass}
                        />
                      )}
                      {c === 'target_type' && (
                        <select
                          value={filters.targetType}
                          onChange={e => setHeaderFilter({ targetType: e.target.value })}
                          className={headerSelectClass}
                        >
                          <option value="">All</option>
                          {(opts?.target_type_options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      )}
                      {i < columns.length - 1 && <ColResizeHandle onMouseDown={startResize(c)} />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <tr key={String(row.edge_id || i)} className={`border-b border-slate-200 dark:border-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800/30 ${i % 2 ? 'bg-slate-50 dark:bg-slate-900/20' : ''}`}>
                    {columns.map(c => (
                      <td key={c} data-column={c} className="px-3 py-2 overflow-hidden"><Cell column={c} value={row[c]} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.total_pages > 1 && (
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Page {data.page} of {data.total_pages}</span>
              <div className="flex gap-1">
                {[['«',1],['‹',data.page-1],['›',data.page+1],['»',data.total_pages]].map(([label, p]) => (
                  <button
                    key={label}
                    disabled={Number(p) < 1 || Number(p) > data.total_pages || Number(p) === data.page}
                    onClick={() => load(Number(p), filters)}
                    className="w-7 h-7 flex items-center justify-center border border-slate-300 dark:border-slate-700 rounded hover:border-slate-400 dark:hover:border-slate-500 hover:text-slate-800 dark:hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
