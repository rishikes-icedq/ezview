import { useState, useEffect, useMemo } from 'react'
import { Database, Table2, Columns, ChevronRight, ChevronDown, Loader2, ArrowUpRight, ArrowDownLeft, Network, Search, X } from 'lucide-react'
import { getAssets } from '../../api/lineage'
import type { AssetDatabase } from '../../types'

interface Props {
  folder: string
  /** Called with the table's `database.schema.table` to show only its lineage. */
  onViewLineage: (fullName: string) => void
}

function Badge({ n, label }: { n: number; label: string }) {
  return (
    <span className="ml-1.5 text-xs text-slate-500 tabular-nums">{n} {label}{n !== 1 ? 's' : ''}</span>
  )
}

export default function AssetTree({ folder, onViewLineage }: Props) {
  const [data, setData] = useState<AssetDatabase[]>([])
  const [loading, setLoading] = useState(true)
  const [openDbs, setOpenDbs] = useState<Set<string>>(new Set())
  const [openSchemas, setOpenSchemas] = useState<Set<string>>(new Set())
  const [openTables, setOpenTables] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')

  useEffect(() => {
    setLoading(true)
    getAssets(folder).then(d => {
      setData(d)
      if (d.length === 1) setOpenDbs(new Set([d[0].database]))
    }).finally(() => setLoading(false))
  }, [folder])

  // Every whitespace-separated term must appear somewhere in `database.schema.table`
  // (case-insensitive), so "sales" finds tables by name and "mydb.public" narrows by schema.
  const terms = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query])
  const searching = terms.length > 0

  const visible = useMemo(() => {
    if (!terms.length) return data
    return data.flatMap(db => {
      const schemas = db.schemas.flatMap(s => {
        const tables = s.tables.filter(t => {
          const key = `${db.database}.${s.schema}.${t.table}`.toLowerCase()
          return terms.every(term => key.includes(term))
        })
        return tables.length ? [{ ...s, table_count: tables.length, tables }] : []
      })
      if (!schemas.length) return []
      return [{ ...db, schema_count: schemas.length, table_count: schemas.reduce((n, s) => n + s.table_count, 0), schemas }]
    })
  }, [data, terms])

  // Open every database/schema that has a match so results are visible without
  // clicking through; added to (not replacing) the open sets so they can still be
  // collapsed by hand.
  useEffect(() => {
    if (!terms.length) return
    setOpenDbs(s => new Set([...s, ...visible.map(db => db.database)]))
    setOpenSchemas(s => new Set([...s, ...visible.flatMap(db => db.schemas.map(sc => `${db.database}.${sc.schema}`))]))
  }, [visible, terms])

  if (loading) return <div className="flex items-center gap-2 text-slate-500 p-4"><Loader2 size={16} className="animate-spin" /> Loading…</div>
  if (!data.length) return <div className="text-slate-500 p-4 italic text-sm">No asset data found.</div>

  const totalTables = data.reduce((n, db) => n + db.table_count, 0)
  const matchedTables = visible.reduce((n, db) => n + db.table_count, 0)

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-3">
        <div className="relative w-full max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search tables, schemas, databases…"
            className="w-full pl-9 pr-8 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-400"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              title="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X size={14} />
            </button>
          )}
        </div>
        {searching && (
          <span className="text-xs text-slate-500 tabular-nums">{matchedTables} of {totalTables} tables</span>
        )}
      </div>

      {searching && !visible.length && (
        <div className="text-slate-500 p-4 italic">No assets match “{query.trim()}”.</div>
      )}

      <div className="space-y-1">
        {visible.map(db => {
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
                              {/* Two sibling buttons rather than one: a button can't contain another button. */}
                              <div className="flex items-center hover:bg-slate-100 dark:hover:bg-slate-700/40 transition-colors border-b border-slate-100 dark:border-slate-800/30 last:border-0">
                                <button
                                  onClick={() => setOpenTables(s => { const n = new Set(s); tableOpen ? n.delete(tk) : n.add(tk); return n })}
                                  className="flex-1 min-w-0 flex items-center gap-2 pl-10 py-2 text-left"
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
                                <button
                                  onClick={() => onViewLineage(tk)}
                                  title="View lineage for this asset only"
                                  aria-label={`View lineage for ${table.table}`}
                                  className="shrink-0 mx-3 p-1 rounded text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors"
                                >
                                  <Network size={14} />
                                </button>
                              </div>

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
    </div>
  )
}
