import { useState, useEffect } from 'react'
import { Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import { getProcesses } from '../../api/lineage'
import type { ProcessRecord } from '../../types'
import { queryTypeBadge, truncate } from '../../utils/format'
import FqnCell from '../viewers/FqnCell'

interface Props { folder: string }

export default function ProcessList({ folder }: Props) {
  const [data, setData] = useState<ProcessRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    setLoading(true)
    getProcesses(folder).then(setData).finally(() => setLoading(false))
  }, [folder])

  if (loading) return <div className="flex items-center gap-2 text-slate-500 py-4"><Loader2 size={16} className="animate-spin" /> Loading…</div>
  if (!data.length) return <div className="text-slate-500 italic text-sm py-4">No processes found.</div>

  // Group by query_type
  const groups: Record<string, ProcessRecord[]> = {}
  for (const p of data) {
    const qt = p.query_type || 'UNKNOWN'
    ;(groups[qt] ??= []).push(p)
  }

  const toggle = (fqn: string) => setExpanded(s => { const n = new Set(s); n.has(fqn) ? n.delete(fqn) : n.add(fqn); return n })

  return (
    <div className="space-y-4">
      {/* Query type summary */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(groups).map(([qt, items]) => (
          <span key={qt} className={`text-xs px-2.5 py-1 rounded border font-medium ${queryTypeBadge(qt)}`}>
            {qt} <span className="opacity-70 font-normal">× {items.length}</span>
          </span>
        ))}
      </div>

      {/* Process cards grouped by type */}
      {Object.entries(groups).map(([qt, items]) => (
        <div key={qt}>
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-xs px-2 py-0.5 rounded border ${queryTypeBadge(qt)}`}>{qt}</span>
            <span className="text-slate-500 text-xs">{items.length} process{items.length !== 1 ? 'es' : ''}</span>
          </div>
          <div className="space-y-2 pl-2 border-l border-slate-200 dark:border-slate-800">
            {items.map(proc => {
              const open = expanded.has(proc.process_fqn)
              return (
                <div key={proc.process_fqn} className="bg-slate-100/60 dark:bg-slate-800/40 border border-slate-300 dark:border-slate-700 rounded-lg overflow-hidden">
                  <button
                    className="w-full flex items-start gap-2 px-4 py-3 hover:bg-slate-200/60 dark:hover:bg-slate-800/60 transition-colors text-left"
                    onClick={() => toggle(proc.process_fqn)}
                  >
                    {open ? <ChevronDown size={13} className="shrink-0 mt-0.5 text-slate-500" /> : <ChevronRight size={13} className="shrink-0 mt-0.5 text-slate-500" />}
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="text-slate-800 dark:text-slate-200 text-sm font-medium truncate">{proc.process_name || truncate(proc.process_fqn, 60)}</div>
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        <FqnCell value={proc.process_fqn} truncate={true} />
                        {proc.last_seen_at && <span>{proc.last_seen_at}</span>}
                      </div>
                    </div>
                  </button>
                  {open && proc.process_code && (
                    <div className="border-t border-slate-300 dark:border-slate-700">
                      <pre className="px-4 py-3 text-xs font-mono text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/60 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                        {proc.process_code}
                      </pre>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
