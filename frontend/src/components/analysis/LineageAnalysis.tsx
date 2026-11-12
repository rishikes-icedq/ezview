import { useState, useEffect, useRef } from 'react'
import { Loader2, BarChart3, Database, GitBranch, Cpu, Network, FolderTree } from 'lucide-react'
import { getSummary } from '../../api/lineage'
import type { GraphMode, LineageSummary } from '../../types'
import type { FocusScope } from '../../utils/lineageFocus'
import SummaryCards from './SummaryCards'
import AssetTree from './AssetTree'
import EdgeTable from './EdgeTable'
import ProcessList from './ProcessList'
import FlowGraph from './FlowGraph'
import OkfCatalog from './OkfCatalog'
import BiNamesBar from './BiNamesBar'

type Tab = 'summary' | 'assets' | 'edges' | 'processes' | 'flow' | 'catalog'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'summary',   label: 'Summary',    icon: <BarChart3 size={14} /> },
  { id: 'assets',    label: 'Assets',     icon: <Database size={14} /> },
  { id: 'edges',     label: 'Edges',      icon: <GitBranch size={14} /> },
  { id: 'processes', label: 'Processes',  icon: <Cpu size={14} /> },
  { id: 'flow',      label: 'Lineage',    icon: <Network size={14} /> },
  { id: 'catalog',   label: 'Catalog',    icon: <FolderTree size={14} /> },
]

interface Props {
  folder: string
  /** Optional path label shown in header */
  label?: string
  /** The Lineage graph fills the whole window: everything around it is hidden (not unmounted, so the graph keeps its state). */
  maximized?: boolean
  onMaximizedChange?: (maximized: boolean) => void
}

export default function LineageAnalysis({ folder, label, maximized = false, onMaximizedChange }: Props) {
  const [summary, setSummary] = useState<LineageSummary | null>(null)
  const [tab, setTab] = useState<Tab>('summary')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // `database.schema.table` the Lineage tab is narrowed to, or null for the whole graph.
  const [focusTable, setFocusTable] = useState<string | null>(null)
  // Power BI crawl folder chosen by hand, or null to look for it next to the bundle. Belongs to one bundle.
  const [crawl, setCrawl] = useState<string | null>(null)
  // Preferences, so unlike focusTable they survive switching folders.
  const [focusScope, setFocusScope] = useState<FocusScope>('full')
  const [graphMode, setGraphMode] = useState<GraphMode>('all')

  const viewLineage = (fullName: string) => {
    setFocusTable(fullName)
    setTab('flow')
  }

  useEffect(() => {
    setLoading(true)
    setError(null)
    setFocusTable(null)
    setCrawl(null)
    getSummary(folder)
      .then(setSummary)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [folder])

  // Never leave the app maximized (with its header and sidebar hidden) once this view is gone.
  const onMaximizedChangeRef = useRef(onMaximizedChange)
  onMaximizedChangeRef.current = onMaximizedChange
  useEffect(() => () => onMaximizedChangeRef.current?.(false), [])

  const displayName = label ?? folder.split(/[\\/]/).pop() ?? folder

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className={`px-5 pt-5 pb-0 shrink-0 ${maximized ? 'hidden' : ''}`}>
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
      <div className={`flex-1 flex flex-col ${maximized ? 'overflow-hidden' : 'overflow-y-auto p-5'}`}>
        {/* Where the model/report/tile names come from: only for a lineage with Power BI assets, on the tabs that show them */}
        {summary?.bi_assets && (tab === 'flow' || tab === 'assets') && (
          <div className={maximized ? 'hidden' : 'contents'}>
            <BiNamesBar folder={folder} crawl={crawl} onCrawlChange={setCrawl} typeNames={summary.bi_asset_type_names} />
          </div>
        )}
        {loading ? (
          <div className="flex items-center gap-2 text-slate-500">
            <Loader2 size={16} className="animate-spin" /> Analysing…
          </div>
        ) : error ? (
          <div className="px-3 py-2 bg-red-50 dark:bg-red-900/40 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 text-sm rounded">{error}</div>
        ) : summary ? (
          <>
            {tab === 'summary'   && <SummaryCards summary={summary} />}
            {tab === 'assets'    && <AssetTree folder={folder} crawl={crawl} onViewLineage={viewLineage} />}
            {tab === 'edges'     && <EdgeTable folder={folder} />}
            {tab === 'processes' && <ProcessList folder={folder} />}
            {tab === 'flow'      && <FlowGraph folder={folder} crawl={crawl} focusTable={focusTable} onFocusChange={setFocusTable} focusScope={focusScope} onScopeChange={setFocusScope} graphMode={graphMode} onGraphModeChange={setGraphMode} maximized={maximized} onMaximizedChange={onMaximizedChange} />}
            {tab === 'catalog'   && <OkfCatalog folder={folder} />}
          </>
        ) : null}
      </div>
    </div>
  )
}
