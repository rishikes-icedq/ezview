import { useState, useEffect, useCallback } from 'react'
import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  flexRender, type SortingState, type ColumnDef,
} from '@tanstack/react-table'
import { ChevronUp, ChevronDown, ChevronsUpDown, Download, Loader2 } from 'lucide-react'
import { getRows, downloadUrl } from '../../api/parquet'
import type { ParquetPage } from '../../types'
import { isFqn } from '../../utils/fqn'
import FqnCell from './FqnCell'
import ColResizeHandle from '../shared/ColResizeHandle'

interface Props { path: string }

function CellValue({ value }: { value: unknown }) {
  const str = value === null || value === undefined ? '' : String(value)
  if (isFqn(str)) return <FqnCell value={str} />
  return <span className="text-slate-700 dark:text-slate-300 text-xs font-mono truncate block" title={str}>{str || <span className="text-slate-400 dark:text-slate-600 italic">null</span>}</span>
}

export default function TableViewer({ path }: Props) {
  const [data, setData] = useState<ParquetPage | null>(null)
  const [page, setPage] = useState(1)
  const [sorting, setSorting] = useState<SortingState>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback((p: number) => {
    setLoading(true)
    setError(null)
    getRows(path, p, 100)
      .then(d => { setData(d); setPage(p) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [path])

  useEffect(() => { load(1) }, [load])

  const columns: ColumnDef<Record<string, unknown>>[] = (data?.columns ?? []).map(col => ({
    id: col,
    accessorKey: col,
    header: col,
    cell: info => <CellValue value={info.getValue()} />,
  }))

  const table = useReactTable({
    data: data?.rows ?? [],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: true,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    defaultColumn: { size: 200, minSize: 80, maxSize: 800 },
  })

  const filename = path.split(/[\\/]/).pop() ?? 'file'

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-900/50 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-slate-700 dark:text-slate-300 text-sm font-medium">{filename}</span>
          {data && (
            <span className="text-slate-500 text-xs">
              {data.total.toLocaleString()} rows · {data.total_pages} page{data.total_pages > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <a href={downloadUrl(path, 'json')} download className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 border border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 px-2.5 py-1 rounded transition-colors">
            <Download size={12} /> JSON
          </a>
          <a href={downloadUrl(path, 'parquet')} download className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 border border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 px-2.5 py-1 rounded transition-colors">
            <Download size={12} /> Parquet
          </a>
        </div>
      </div>

      {/* Error */}
      {error && <div className="mx-4 mt-3 px-3 py-2 bg-red-50 dark:bg-red-900/40 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 text-sm rounded">{error}</div>}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading && !data ? (
          <div className="flex items-center justify-center h-32 text-slate-500 gap-2">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : (
          <table className="text-sm border-collapse" style={{ width: table.getTotalSize(), tableLayout: 'fixed' }}>
            <thead className="sticky top-0 z-10">
              {table.getHeaderGroups().map(hg => (
                <tr key={hg.id} className="bg-slate-100 dark:bg-slate-900">
                  {hg.headers.map(h => (
                    <th
                      key={h.id}
                      style={{ width: h.getSize() }}
                      className="relative text-left px-3 py-2 text-xs font-medium text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 select-none"
                    >
                      <span
                        onClick={h.column.getToggleSortingHandler()}
                        className="flex items-center gap-1 truncate cursor-pointer hover:text-slate-800 dark:hover:text-slate-200"
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {h.column.getIsSorted() === 'asc' ? <ChevronUp size={11} className="shrink-0" /> :
                         h.column.getIsSorted() === 'desc' ? <ChevronDown size={11} className="shrink-0" /> :
                         <ChevronsUpDown size={11} className="text-slate-300 dark:text-slate-700 shrink-0" />}
                      </span>
                      <ColResizeHandle
                        onMouseDown={h.getResizeHandler()}
                        onTouchStart={h.getResizeHandler()}
                        active={h.column.getIsResizing()}
                      />
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row, i) => (
                <tr
                  key={row.id}
                  className={`border-b border-slate-200 dark:border-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800/40 transition-colors ${i % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-900/30'}`}
                >
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id} style={{ width: cell.column.getSize() }} className="px-3 py-1.5 overflow-hidden">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {data && data.total_pages > 1 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-900/50 shrink-0">
          <span className="text-xs text-slate-500">
            Page {data.page} of {data.total_pages} · rows {((data.page - 1) * data.page_size) + 1}–{Math.min(data.page * data.page_size, data.total)}
          </span>
          <div className="flex items-center gap-1">
            <PagBtn disabled={data.page <= 1} onClick={() => load(1)}>«</PagBtn>
            <PagBtn disabled={data.page <= 1} onClick={() => load(data.page - 1)}>‹</PagBtn>
            <PagBtn disabled={data.page >= data.total_pages} onClick={() => load(data.page + 1)}>›</PagBtn>
            <PagBtn disabled={data.page >= data.total_pages} onClick={() => load(data.total_pages)}>»</PagBtn>
          </div>
        </div>
      )}
    </div>
  )
}

function PagBtn({ children, disabled, onClick }: { children: React.ReactNode; disabled: boolean; onClick: () => void }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="w-7 h-7 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed border border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 rounded transition-colors"
    >
      {children}
    </button>
  )
}
