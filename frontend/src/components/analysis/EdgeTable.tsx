import { useState, useEffect, useCallback, useRef } from 'react'
import { Loader2, Filter, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { getEdges } from '../../api/lineage'
import type { EdgePage, SortDirection } from '../../types'
import { confidenceColor } from '../../utils/format'
import FqnCell from '../viewers/FqnCell'
import ColResizeHandle from '../shared/ColResizeHandle'
import { useResizableColumns } from '../../hooks/useResizableColumns'

const COLUMNS = ['Direction', 'Source', 'Source Type', 'Target', 'Target Type', 'Transform', 'Confidence', 'Resolution']
const INITIAL_WIDTHS = [130, 260, 130, 260, 130, 140, 110, 140]
const SEARCH_DEBOUNCE_MS = 350

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

interface Props { folder: string }

export default function EdgeTable({ folder }: Props) {
  const [data, setData] = useState<EdgePage | null>(null)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [loading, setLoading] = useState(true)
  const { widths, startResize } = useResizableColumns(INITIAL_WIDTHS)
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
        <span className="text-slate-400 dark:text-slate-600 text-xs italic">Direction / Source / Source Type / Target / Target Type filter directly in the column headers below</span>
        {data && <span className="ml-auto text-slate-500 text-xs">{data.total.toLocaleString()} edges</span>}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 py-4"><Loader2 size={16} className="animate-spin" /> Loading…</div>
      ) : !data?.rows.length ? (
        <div className="text-slate-500 italic text-sm py-4">No edges match the current filter.</div>
      ) : (
        <>
          <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
            <table className="w-full text-xs border-collapse table-fixed">
              <colgroup>
                {widths.map((w, i) => <col key={i} style={{ width: w }} />)}
              </colgroup>
              <thead>
                <tr className="bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
                  {COLUMNS.map((h, i) => (
                    <th key={h} className="relative align-top text-left px-3 py-2 text-slate-500 dark:text-slate-400 font-medium">
                      {h === 'Source' || h === 'Target' ? (
                        <button
                          onClick={() => toggleSort(h === 'Source' ? 'source_fqn' : 'target_fqn')}
                          className="flex items-center gap-1 truncate w-full text-left cursor-pointer hover:text-slate-800 dark:hover:text-slate-200"
                        >
                          <span className="truncate">{h}</span>
                          {sortIcon(h === 'Source' ? 'source_fqn' : 'target_fqn')}
                        </button>
                      ) : (
                        <div className="truncate">{h}</div>
                      )}

                      {h === 'Direction' && (
                        <select
                          value={filters.direction}
                          onChange={e => setHeaderFilter({ direction: e.target.value })}
                          className={headerSelectClass}
                        >
                          <option value="">All</option>
                          {(opts?.direction_options ?? ['writes_to', 'read_by']).map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      )}
                      {h === 'Source' && (
                        <input
                          type="text"
                          value={filters.sourceSearch}
                          onChange={e => handleSearchChange({ sourceSearch: e.target.value }, 'source')}
                          placeholder="contains…"
                          className={headerInputClass}
                        />
                      )}
                      {h === 'Source Type' && (
                        <select
                          value={filters.sourceType}
                          onChange={e => setHeaderFilter({ sourceType: e.target.value })}
                          className={headerSelectClass}
                        >
                          <option value="">All</option>
                          {(opts?.source_type_options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      )}
                      {h === 'Target' && (
                        <input
                          type="text"
                          value={filters.targetSearch}
                          onChange={e => handleSearchChange({ targetSearch: e.target.value }, 'target')}
                          placeholder="contains…"
                          className={headerInputClass}
                        />
                      )}
                      {h === 'Target Type' && (
                        <select
                          value={filters.targetType}
                          onChange={e => setHeaderFilter({ targetType: e.target.value })}
                          className={headerSelectClass}
                        >
                          <option value="">All</option>
                          {(opts?.target_type_options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      )}
                      {i < COLUMNS.length - 1 && <ColResizeHandle onMouseDown={startResize(i)} />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <tr key={row.edge_id || i} className={`border-b border-slate-200 dark:border-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800/30 ${i % 2 ? 'bg-slate-50 dark:bg-slate-900/20' : ''}`}>
                    <td className="px-3 py-2 truncate">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${row.edge === 'writes_to' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}>
                        {row.edge}
                      </span>
                    </td>
                    <td className="px-3 py-2 overflow-hidden"><FqnCell value={row.source_fqn} /></td>
                    <td className="px-3 py-2 text-slate-500 dark:text-slate-400 truncate">{row.source_type}</td>
                    <td className="px-3 py-2 overflow-hidden"><FqnCell value={row.target_fqn} /></td>
                    <td className="px-3 py-2 text-slate-500 dark:text-slate-400 truncate">{row.target_type}</td>
                    <td className="px-3 py-2 font-mono text-slate-700 dark:text-slate-300 truncate">{row.transform_type}</td>
                    <td className="px-3 py-2 truncate">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${confidenceColor(row.confidence)}`}>{row.confidence}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-500 dark:text-slate-400 truncate">{row.resolution_type}</td>
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
