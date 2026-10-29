import { useState } from 'react'
import { ChevronDown, ChevronRight, Database, Table2, Layers, Search } from 'lucide-react'
import type { OkfDatabaseNode, OkfAssetRef } from '../../../types'

interface Props {
  databases: OkfDatabaseNode[]
  selectedPath: string | null
  onSelect: (path: string) => void
}

function StatusPill({ status }: { status: string }) {
  if (!status || status.toLowerCase() === 'stable') return null
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 shrink-0">
      {status}
    </span>
  )
}

function AssetRow({ asset, active, onSelect }: { asset: OkfAssetRef; active: boolean; onSelect: (path: string) => void }) {
  const Icon = asset.type === 'view' ? Layers : Table2
  return (
    <button
      onClick={() => onSelect(asset.path)}
      className={`w-full flex items-center gap-2 pl-10 pr-3 py-1.5 text-left border-b border-slate-100 dark:border-slate-800/30 transition-colors
        ${active ? 'bg-indigo-50 dark:bg-indigo-900/30' : 'hover:bg-slate-100 dark:hover:bg-slate-800/30'}`}
    >
      <Icon size={12} className={`shrink-0 ${asset.type === 'view' ? 'text-teal-600 dark:text-teal-400' : 'text-cyan-700 dark:text-cyan-400'}`} />
      <span className={`font-mono text-xs truncate flex-1 min-w-0 ${active ? 'text-indigo-700 dark:text-indigo-300 font-medium' : 'text-slate-700 dark:text-slate-300'}`}>
        {asset.name}
      </span>
      <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">{asset.column_count}</span>
      <StatusPill status={asset.status} />
    </button>
  )
}

export default function CatalogTree({ databases, selectedPath, onSelect }: Props) {
  const [openDbs, setOpenDbs] = useState<Set<string>>(new Set(databases.length === 1 ? [databases[0].database] : []))
  const [openSchemas, setOpenSchemas] = useState<Set<string>>(() => {
    if (databases.length === 1 && databases[0].schemas.length === 1) {
      return new Set([`${databases[0].database}.${databases[0].schemas[0].schema}`])
    }
    return new Set()
  })
  const [filter, setFilter] = useState('')
  const filterLower = filter.trim().toLowerCase()

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <div className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter tables & views…"
            className="w-full pl-7 pr-2 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto text-sm">
        {databases.map(db => {
          const dbOpen = openDbs.has(db.database)
          return (
            <div key={db.database}>
              <button
                onClick={() => setOpenDbs(s => { const n = new Set(s); dbOpen ? n.delete(db.database) : n.add(db.database); return n })}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800/60 text-left border-b border-slate-200 dark:border-slate-800"
              >
                {dbOpen ? <ChevronDown size={13} className="text-slate-400 shrink-0" /> : <ChevronRight size={13} className="text-slate-400 shrink-0" />}
                <Database size={13} className="text-orange-600 dark:text-orange-400 shrink-0" />
                <span className="font-medium text-orange-700 dark:text-orange-300 font-mono truncate">{db.database}</span>
              </button>

              {dbOpen && db.schemas.map(schema => {
                const sk = `${db.database}.${schema.schema}`
                const schemaOpen = openSchemas.has(sk)
                const assets = filterLower
                  ? schema.assets.filter(a => a.name.toLowerCase().includes(filterLower))
                  : schema.assets
                return (
                  <div key={sk}>
                    <button
                      onClick={() => setOpenSchemas(s => { const n = new Set(s); schemaOpen ? n.delete(sk) : n.add(sk); return n })}
                      className="w-full flex items-center gap-2 px-6 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800/40 text-left border-b border-slate-100 dark:border-slate-800/50"
                    >
                      {schemaOpen ? <ChevronDown size={12} className="text-slate-400 shrink-0" /> : <ChevronRight size={12} className="text-slate-400 shrink-0" />}
                      <span className="font-medium text-green-700 dark:text-green-300 font-mono text-xs truncate">{schema.schema}</span>
                      <span className="text-[10px] text-slate-400 shrink-0 tabular-nums ml-auto">{assets.length}</span>
                    </button>
                    {schemaOpen && assets.map(asset => (
                      <AssetRow key={asset.path} asset={asset} active={selectedPath === asset.path} onSelect={onSelect} />
                    ))}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
