import { useEffect, useState } from 'react'
import { Loader2, Tags, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { getBiNames } from '../../api/lineage'
import type { BiNamesInfo, LineageSummary } from '../../types'

interface Props {
  /** What the bundle calls each kind of asset (from its summary): the counts of names found are labelled with these. */
  typeNames?: LineageSummary['bi_asset_type_names']
  folder: string
  /** Crawl folder chosen by hand; null = look for the crawl next to the bundle. */
  crawl: string | null
  onCrawlChange: (crawl: string | null) => void
}


/**
 * Where the Power BI names (models, reports, dashboards, tiles) come from. The crawl is looked up next to the
 * bundle, and the bundle's own scanner result (when it has one) names what the crawl doesn't; the box below can
 * point at any other crawl folder at any time, found or not, to try another scenario.
 */
export default function BiNamesBar({ folder, crawl, onCrawlChange, typeNames }: Props) {
  const [info, setInfo] = useState<BiNamesInfo | null>(null)
  const [draft, setDraft] = useState(crawl ?? '')

  useEffect(() => {
    let cancelled = false
    setInfo(null)
    getBiNames(folder, crawl)
      .then(i => {
        if (cancelled) return
        setInfo(i)
        // Show what is in use, so the auto-found folder can be edited or replaced.
        setDraft(crawl ?? i.path ?? '')
      })
      .catch(e => { if (!cancelled) setInfo({ status: 'invalid', path: null, message: e.message, counts: null }) })
    return () => { cancelled = true }
  }, [folder, crawl])

  if (info?.status === 'none') return null

  const applied = (crawl ?? info?.path ?? '').trim()
  const trimmed = draft.trim()
  const apply = () => { if (trimmed && trimmed !== applied) onCrawlChange(trimmed) }

  let status: React.ReactNode
  if (!info) {
    status = <span className="flex items-center gap-1.5 text-slate-500"><Loader2 size={12} className="animate-spin" /> Looking for names…</span>
  } else if (info.status === 'auto' || info.status === 'manual' || info.status === 'bundle') {
    const c = info.counts
    status = (
      <span className="flex items-start gap-1.5 text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 size={13} className="shrink-0 mt-px" />
        <span>
          {info.status === 'auto' ? 'Found next to this bundle' : info.status === 'manual' ? 'Using the folder you chose' : "Names from this bundle's own scanner result"}
          {c && <> · {([['models', c.models], ['reports', c.reports], ['dashboards', c.dashboards], ['tiles', c.tiles]] as const)
            .flatMap(([key, n]) => (typeNames?.[key] ? [`${typeNames[key]} (${n})`] : [])).join(', ')}</>}
          {info.status === 'bundle'
            ? '. Enter a crawl folder above to use its names instead.'
            : info.scan_path && ". Assets the crawl doesn't know are named from the bundle's own scanner result."}
        </span>
      </span>
    )
  } else if (info.status === 'missing') {
    status = (
      <span className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
        <AlertTriangle size={13} className="shrink-0 mt-px" />
        <span>{info.message} Assets are shown by id; enter the crawl folder above to show their names.</span>
      </span>
    )
  } else {
    status = (
      <span className="flex items-start gap-1.5 text-red-700 dark:text-red-400">
        <XCircle size={13} className="shrink-0 mt-px" />
        <span>{info.message} {info.scan_path ? "The names from the bundle's own scanner result are shown instead." : 'Assets are shown by id.'}</span>
      </span>
    )
  }

  return (
    <div className="shrink-0 mb-3 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 text-xs space-y-1.5" data-testid="bi-names-bar">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-300 shrink-0">
          <Tags size={13} /> Power BI names
        </span>
        <input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') apply() }}
          spellCheck={false}
          aria-label="Power BI crawl folder"
          placeholder="Path to a Power BI crawl folder, e.g. …\crawl-metadata\powerbi\conn-…\crawl-…\2026…"
          className="flex-1 min-w-[16rem] px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-400"
        />
        <button
          onClick={apply}
          disabled={!trimmed || trimmed === applied}
          title="Show the names from this crawl folder (it can be the snapshot itself or any folder above it)"
          className="px-2.5 py-1 rounded border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-200 bg-white dark:bg-slate-900 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Apply
        </button>
        {crawl !== null && (
          <button
            onClick={() => onCrawlChange(null)}
            title="Go back to the crawl found next to this bundle"
            className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            Auto-detect
          </button>
        )}
      </div>
      <div className="leading-snug" role="status">{status}</div>
    </div>
  )
}
