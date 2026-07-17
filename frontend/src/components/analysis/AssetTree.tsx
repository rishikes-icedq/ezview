import { useState, useEffect } from 'react'
import { Database, Table2, Columns, ChevronRight, ChevronDown, Loader2, ArrowUpRight, ArrowDownLeft } from 'lucide-react'
import { getAssets } from '../../api/lineage'
import type { AssetDatabase } from '../../types'

interface Props { folder: string }

function Badge({ n, label }: { n: number; label: string }) {
  return (
    <span className="ml-1.5 text-xs text-slate-500 tabular-nums">{n} {label}{n !== 1 ? 's' : ''}</span>
  )
}

export default function AssetTree({ folder }: Props) {
  const [data, setData] = useState<AssetDatabase[]>([])
  const [loading, setLoading] = useState(true)
  const [openDbs, setOpenDbs] = useState<Set<string>>(new Set())
  const [openSchemas, setOpenSchemas] = useState<Set<string>>(new Set())
  const [openTables, setOpenTables] = useState<Set<string>>(new Set())

  useEffect(() => {
    setLoading(true)
    getAssets(folder).then(d => {
      setData(d)
      if (d.length === 1) setOpenDbs(new Set([d[0].database]))
    }).finally(() => setLoading(false))
  }, [folder])

  if (loading) return <div className="flex items-center gap-2 text-slate-500 p-4"><Loader2 size={16} className="animate-spin" /> Loading…</div>
  if (!data.length) return <div className="text-slate-500 p-4 italic text-sm">No asset data found.</div>

  return (
    <div className="space-y-1 text-sm">
      {data.map(db => {
        const dbOpen = openDbs.has(db.database)
        return (
          <div key={db.database} className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <button
              onClick={() => setOpenDbs(s => { const n = new Set(s); dbOpen ? n.delete(db.database) : n.add(db.database); return n })}
              className="w-full flex items-center gap-2 px-4 py-3 bg-slate-100/60 dark:bg-slate-800/60 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors text-left"
            >
              {dbOpen ? <ChevronDown size={14} className="text-slate-400 dark:text-slate-500 shrink-0" /> : <ChevronRight size={14} className="text-slate-400 dark:text-slate-500 shrink-0" />}
              <Database size={15} className="text-orange-600 dark:text-orange-400 shrink-0" />
              <span className="font-medium text-orange-700 dark:text-orange-300 font-mono">{db.database}</span>
              <Badge n={db.schema_count} label="schema" />
              <Badge n={db.table_count} label="table" />
            </button>

            {dbOpen && (
              <div className="border-t border-slate-200 dark:border-slate-800">
                {db.schemas.map(schema => {
                  const sk = `${db.database}.${schema.schema}`
                  const schemaOpen = openSchemas.has(sk)
                  return (
                    <div key={sk}>
                      <button
                        onClick={() => setOpenSchemas(s => { const n = new Set(s); schemaOpen ? n.delete(sk) : n.add(sk); return n })}
                        className="w-full flex items-center gap-2 px-6 py-2 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors text-left border-b border-slate-100 dark:border-slate-800/50 last:border-0"
                      >
                        {schemaOpen ? <ChevronDown size={12} className="text-slate-400 dark:text-slate-600 shrink-0" /> : <ChevronRight size={12} className="text-slate-400 dark:text-slate-600 shrink-0" />}
                        <span className="text-xs text-slate-500 font-mono uppercase tracking-wider">Schema</span>
                        <span className="font-medium text-green-700 dark:text-green-300 font-mono">{schema.schema}</span>
                        <Badge n={schema.table_count} label="table" />
                      </button>

                      {schemaOpen && schema.tables.map(table => {
                        const tk = `${sk}.${table.table}`
                        const tableOpen = openTables.has(tk)
                        return (
                          <div key={tk}>
                            <button
                              onClick={() => setOpenTables(s => { const n = new Set(s); tableOpen ? n.delete(tk) : n.add(tk); return n })}
                              className="w-full flex items-center gap-2 px-10 py-2 hover:bg-slate-100 dark:hover:bg-slate-700/40 transition-colors text-left border-b border-slate-100 dark:border-slate-800/30 last:border-0"
                            >
                              {tableOpen ? <ChevronDown size={11} className="text-slate-400 dark:text-slate-600 shrink-0" /> : <ChevronRight size={11} className="text-slate-400 dark:text-slate-600 shrink-0" />}
                              <Table2 size={12} className="text-cyan-700 dark:text-cyan-400 shrink-0" />
                              <span className="font-mono text-cyan-700 dark:text-cyan-300">{table.table}</span>
                              <Badge n={table.column_count} label="col" />
                              {table.source_process_count > 0 && (
                                <span
                                  className="ml-auto flex items-center gap-0.5 text-xs text-emerald-600 dark:text-emerald-500 cursor-help"
                                  title={`Read by ${table.source_process_count} process${table.source_process_count !== 1 ? 'es' : ''}`}
                                >
                                  <ArrowUpRight size={10} /> {table.source_process_count}
                                </span>
                              )}
                              {table.target_process_count > 0 && (
                                <span
                                  className="flex items-center gap-0.5 text-xs text-indigo-600 dark:text-indigo-400 cursor-help"
                                  title={`Written to by ${table.target_process_count} process${table.target_process_count !== 1 ? 'es' : ''}`}
                                >
                                  <ArrowDownLeft size={10} /> {table.target_process_count}
                                </span>
                              )}
                            </button>

                            {tableOpen && table.columns.length > 0 && (
                              <div className="px-14 py-2 bg-slate-50 dark:bg-slate-900/40 border-b border-slate-100 dark:border-slate-800/30 flex flex-wrap gap-1.5">
                                {table.columns.map(col => (
                                  <span key={col} className="font-mono text-xs text-purple-700 dark:text-purple-300 bg-purple-100/60 dark:bg-purple-900/20 border border-purple-300 dark:border-purple-800/40 px-1.5 py-0.5 rounded">
                                    {col}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
