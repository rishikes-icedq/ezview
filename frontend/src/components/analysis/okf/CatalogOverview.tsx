import { CheckCircle2, AlertTriangle, History } from 'lucide-react'
import type { OkfCatalog } from '../../../types'

interface Props { catalog: OkfCatalog }

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-slate-100/60 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-3">
      <div className="text-2xl font-semibold text-slate-800 dark:text-slate-200 tabular-nums">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  )
}

export default function CatalogOverview({ catalog }: Props) {
  const s = catalog.summary
  const rq = catalog.review_queue
  const hasReviewItems = (rq?.blocked.length ?? 0) > 0 || (rq?.events.length ?? 0) > 0

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2">Bundle Summary</h3>
        {s && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            <StatCard label="Databases" value={s.databases} />
            <StatCard label="Schemas" value={s.schemas} />
            <StatCard label="Tables" value={s.tables} />
            <StatCard label="Views" value={s.views} />
            <StatCard label="Columns" value={s.columns} />
          </div>
        )}
        {catalog.generated_at && (
          <div className="text-xs text-slate-400 mt-2">Last generated {catalog.generated_at}</div>
        )}
      </div>

      <div>
        <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2">Review Queue</h3>
        {hasReviewItems ? (
          <div className="space-y-2">
            {rq!.blocked.map((item, i) => (
              <div key={`b${i}`} className="flex items-start gap-2 text-sm px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded">
                <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <span className="text-slate-700 dark:text-slate-300">{item}</span>
              </div>
            ))}
            {rq!.events.map((item, i) => (
              <div key={`e${i}`} className="flex items-start gap-2 text-sm px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-300 dark:border-blue-700 rounded">
                <AlertTriangle size={14} className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                <span className="text-slate-700 dark:text-slate-300">{item}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 size={14} /> All clear — nothing pending review.
          </div>
        )}
      </div>

      {catalog.history && catalog.history.length > 0 && (
        <div>
          <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2 flex items-center gap-1.5"><History size={12} /> Update History</h3>
          <div className="space-y-3">
            {catalog.history.map((h, i) => (
              <div key={i} className="border-l-2 border-slate-200 dark:border-slate-800 pl-3">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-medium text-slate-700 dark:text-slate-300">{h.date}</span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 text-[10px]">{h.kind}</span>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{h.summary}</p>
                {h.details.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {h.details.map((d, j) => (
                      <li key={j} className="text-[11px] font-mono text-slate-400 dark:text-slate-500 truncate">{d}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
