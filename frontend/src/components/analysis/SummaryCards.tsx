import type { LineageSummary } from '../../types'
import { Database, Table2, Columns, GitBranch, Activity, Layers } from 'lucide-react'

interface Props { summary: LineageSummary }

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <div className="bg-slate-100/60 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 rounded-lg p-4 flex flex-col gap-1">
      <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-xs">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-2xl font-bold text-slate-900 dark:text-white">{typeof value === 'number' ? value.toLocaleString() : value}</div>
    </div>
  )
}

function DistBar({ label, dist, colorMap }: { label: string; dist: Record<string, number>; colorMap: Record<string, string> }) {
  const total = Object.values(dist).reduce((a, b) => a + b, 0)
  if (total === 0) return null
  return (
    <div className="bg-slate-100/60 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 rounded-lg p-4">
      <div className="text-xs text-slate-500 dark:text-slate-400 mb-3">{label}</div>
      <div className="flex h-2 rounded-full overflow-hidden mb-3">
        {Object.entries(dist).map(([k, v]) => (
          <div
            key={k}
            className={colorMap[k] ?? 'bg-slate-600'}
            style={{ width: `${(v / total) * 100}%` }}
            title={`${k}: ${v}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {Object.entries(dist).map(([k, v]) => (
          <div key={k} className="flex items-center gap-1.5 text-xs">
            <span className={`w-2 h-2 rounded-sm ${colorMap[k] ?? 'bg-slate-600'}`} />
            <span className="text-slate-500 dark:text-slate-400">{k}</span>
            <span className="text-slate-800 dark:text-slate-200 font-medium">{v.toLocaleString()}</span>
            <span className="text-slate-400 dark:text-slate-600">({((v / total) * 100).toFixed(0)}%)</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function SummaryCards({ summary }: Props) {
  return (
    <div className="space-y-5">
      {/* Stat grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon={<Activity size={14} />} label="Processes" value={summary.total_processes} />
        <StatCard icon={<GitBranch size={14} />} label="Edges" value={summary.total_edges} />
        <StatCard icon={<Database size={14} />} label="Databases" value={summary.unique_databases} />
        <StatCard icon={<Layers size={14} />} label="Schemas" value={summary.unique_schemas} />
        <StatCard icon={<Table2 size={14} />} label="Tables" value={summary.unique_tables} />
        <StatCard icon={<Columns size={14} />} label="Columns" value={summary.unique_columns} />
      </div>

      {/* Distribution bars */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {Object.keys(summary.confidence_distribution).length > 0 && (
          <DistBar
            label="Edge Confidence"
            dist={summary.confidence_distribution}
            colorMap={{ HIGH: 'bg-emerald-500', MEDIUM: 'bg-amber-500', LOW: 'bg-red-500' }}
          />
        )}
        {Object.keys(summary.query_type_distribution).length > 0 && (
          <DistBar
            label="Query Types"
            dist={summary.query_type_distribution}
            colorMap={{ INSERT: 'bg-blue-500', UPDATE: 'bg-violet-500', MERGE: 'bg-indigo-500', DELETE: 'bg-rose-500', CTAS: 'bg-teal-500', COPY: 'bg-sky-500' }}
          />
        )}
        {Object.keys(summary.transform_type_distribution).length > 0 && (
          <DistBar
            label="Transform Types"
            dist={summary.transform_type_distribution}
            colorMap={{ DIRECT_COPY: 'bg-cyan-500', CONSTANT: 'bg-pink-500', EXPRESSION: 'bg-orange-500', WINDOW_FUNCTION: 'bg-purple-500', LATERAL_FLATTEN: 'bg-yellow-500', UNKNOWN: 'bg-slate-500' }}
          />
        )}
        {Object.keys(summary.resolution_type_distribution).length > 0 && (
          <DistBar
            label="Resolution Types"
            dist={summary.resolution_type_distribution}
            colorMap={{ column_resolved: 'bg-emerald-500', table_fallback: 'bg-amber-500' }}
          />
        )}
      </div>

      {/* System names */}
      {summary.system_names.length > 0 && (
        <div className="text-xs text-slate-500 dark:text-slate-400">
          System: {summary.system_names.map(s => (
            <span key={s} className="ml-1.5 font-mono text-indigo-600 dark:text-indigo-400">{s}</span>
          ))}
        </div>
      )}
    </div>
  )
}
