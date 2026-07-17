import { useState, useEffect } from 'react'
import { Loader2, ArrowRight } from 'lucide-react'
import { getFlow } from '../../api/lineage'
import type { FlowPair } from '../../types'
import ColResizeHandle from '../shared/ColResizeHandle'
import { useResizableColumns } from '../../hooks/useResizableColumns'

const INITIAL_WIDTHS = [320, 40, 320, 90, 90]

interface Props { folder: string }

function shortName(fqn: string) {
  // "db.schema.table" → last segment
  const parts = fqn.split('.')
  return parts[parts.length - 1] || fqn
}

export default function FlowMatrix({ folder }: Props) {
  const [pairs, setPairs] = useState<FlowPair[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const { widths, startResize } = useResizableColumns(INITIAL_WIDTHS)

  useEffect(() => {
    setLoading(true)
    getFlow(folder).then(setPairs).finally(() => setLoading(false))
  }, [folder])

  if (loading) return <div className="flex items-center gap-2 text-slate-500 py-4"><Loader2 size={16} className="animate-spin" /> Loading…</div>
  if (!pairs.length) return <div className="text-slate-500 italic text-sm py-4">No table-to-table flow data found.</div>

  const filtered = filter
    ? pairs.filter(p => p.source_table.toLowerCase().includes(filter.toLowerCase()) || p.target_table.toLowerCase().includes(filter.toLowerCase()))
    : pairs

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Filter by table name…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs rounded px-3 py-1.5 border border-slate-300 dark:border-slate-700 focus:outline-none focus:border-indigo-500 w-64"
        />
        <span className="text-slate-500 text-xs">{filtered.length} flow{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
        <table className="w-full text-xs border-collapse table-fixed">
          <colgroup>
            {widths.map((w, i) => <col key={i} style={{ width: w }} />)}
          </colgroup>
          <thead>
            <tr className="bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
              <th className="relative text-left px-4 py-2 text-slate-500 dark:text-slate-400 font-medium truncate">
                Source Table
                <ColResizeHandle onMouseDown={startResize(0)} />
              </th>
              <th className="px-2 py-2 text-slate-400 dark:text-slate-600">&nbsp;</th>
              <th className="relative text-left px-4 py-2 text-slate-500 dark:text-slate-400 font-medium truncate">
                Target Table
                <ColResizeHandle onMouseDown={startResize(2)} />
              </th>
              <th className="text-right px-4 py-2 text-slate-500 dark:text-slate-400 font-medium truncate">Edges</th>
              <th className="text-right px-4 py-2 text-slate-500 dark:text-slate-400 font-medium truncate">Procs</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p, i) => (
              <tr key={i} className={`border-b border-slate-200 dark:border-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800/30 transition-colors ${i % 2 ? 'bg-slate-50 dark:bg-slate-900/20' : ''}`}>
                <td className="px-4 py-2 overflow-hidden">
                  <div className="font-mono text-cyan-700 dark:text-cyan-400 truncate" title={p.source_table}>
                    {shortName(p.source_table)}
                  </div>
                  <div className="text-slate-400 dark:text-slate-600 truncate text-xs mt-0.5">{p.source_table}</div>
                </td>
                <td className="px-2 py-2 text-center text-slate-400 dark:text-slate-600">
                  <ArrowRight size={13} />
                </td>
                <td className="px-4 py-2 overflow-hidden">
                  <div className="font-mono text-emerald-700 dark:text-emerald-400 truncate" title={p.target_table}>
                    {shortName(p.target_table)}
                  </div>
                  <div className="text-slate-400 dark:text-slate-600 truncate text-xs mt-0.5">{p.target_table}</div>
                </td>
                <td className="px-4 py-2 text-right text-slate-800 dark:text-slate-200 tabular-nums font-medium truncate">{p.edge_count.toLocaleString()}</td>
                <td className="px-4 py-2 text-right text-slate-500 dark:text-slate-400 tabular-nums truncate">{p.process_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
