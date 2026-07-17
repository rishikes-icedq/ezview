import { useState, useEffect } from 'react'
import { Loader2, BarChart3, Database, GitBranch, Cpu, Network } from 'lucide-react'
import { getSummary } from '../../api/lineage'
import type { LineageSummary } from '../../types'
import SummaryCards from './SummaryCards'
import AssetTree from './AssetTree'
import EdgeTable from './EdgeTable'
import ProcessList from './ProcessList'
import FlowMatrix from './FlowMatrix'

type Tab = 'summary' | 'assets' | 'edges' | 'processes' | 'flow'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'summary',   label: 'Summary',    icon: <BarChart3 size={14} /> },
  { id: 'assets',    label: 'Assets',     icon: <Database size={14} /> },
  { id: 'edges',     label: 'Edges',      icon: <GitBranch size={14} /> },
  { id: 'processes', label: 'Processes',  icon: <Cpu size={14} /> },
  { id: 'flow',      label: 'Data Flow',  icon: <Network size={14} /> },
]

interface Props {
  folder: string
  /** Optional path label shown in header */
  label?: string
}

export default function LineageAnalysis({ folder, label }: Props) {
  const [summary, setSummary] = useState<LineageSummary | null>(null)
  const [tab, setTab] = useState<Tab>('summary')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    getSummary(folder)
      .then(setSummary)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [folder])

  const displayName = label ?? folder.split(/[\\/]/).pop() ?? folder

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 pt-5 pb-0 shrink-0">
        <div className="flex items-center gap-2 mb-4">
          <Network size={16} className="text-indigo-500 dark:text-indigo-400" />
          <span className="text-slate-800 dark:text-slate-200 font-semibold">{displayName}</span>
          {summary && (
            <span className="text-slate-500 text-xs ml-1">
              {summary.total_processes} processes · {summary.total_edges} edges
            </span>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-0.5 border-b border-slate-200 dark:border-slate-800">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm transition-colors rounded-t border-b-2
                ${tab === t.id
                  ? 'border-indigo-500 text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-slate-800/40'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/20'}`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-5">
        {loading ? (
          <div className="flex items-center gap-2 text-slate-500">
            <Loader2 size={16} className="animate-spin" /> Analysing…
          </div>
        ) : error ? (
          <div className="px-3 py-2 bg-red-50 dark:bg-red-900/40 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 text-sm rounded">{error}</div>
        ) : summary ? (
          <>
            {tab === 'summary'   && <SummaryCards summary={summary} />}
            {tab === 'assets'    && <AssetTree folder={folder} />}
            {tab === 'edges'     && <EdgeTable folder={folder} />}
            {tab === 'processes' && <ProcessList folder={folder} />}
            {tab === 'flow'      && <FlowMatrix folder={folder} />}
          </>
        ) : null}
      </div>
    </div>
  )
}
