export function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function formatDate(ts: number): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function confidenceColor(c: string): string {
  switch (c?.toUpperCase()) {
    case 'HIGH':   return 'bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-900/60 dark:text-emerald-300 dark:border-emerald-700'
    case 'MEDIUM': return 'bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-900/60 dark:text-amber-300 dark:border-amber-700'
    case 'LOW':    return 'bg-red-100 text-red-800 border border-red-300 dark:bg-red-900/60 dark:text-red-300 dark:border-red-700'
    default:       return 'bg-slate-100 text-slate-600 border border-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-600'
  }
}

export function queryTypeBadge(qt: string): string {
  const colors: Record<string, string> = {
    INSERT: 'bg-blue-100 text-blue-800 border border-blue-300 dark:bg-blue-900/60 dark:text-blue-300 dark:border-blue-700',
    UPDATE: 'bg-violet-100 text-violet-800 border border-violet-300 dark:bg-violet-900/60 dark:text-violet-300 dark:border-violet-700',
    MERGE:  'bg-indigo-100 text-indigo-800 border border-indigo-300 dark:bg-indigo-900/60 dark:text-indigo-300 dark:border-indigo-700',
    DELETE: 'bg-rose-100 text-rose-800 border border-rose-300 dark:bg-rose-900/60 dark:text-rose-300 dark:border-rose-700',
    CTAS:   'bg-teal-100 text-teal-800 border border-teal-300 dark:bg-teal-900/60 dark:text-teal-300 dark:border-teal-700',
    COPY:   'bg-sky-100 text-sky-800 border border-sky-300 dark:bg-sky-900/60 dark:text-sky-300 dark:border-sky-700',
    SELECT: 'bg-slate-100 text-slate-700 border border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600',
  }
  return colors[qt?.toUpperCase()] ?? 'bg-slate-100 text-slate-700 border border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600'
}

export function truncate(s: string, max = 80): string {
  if (!s) return ''
  return s.length > max ? s.slice(0, max) + '…' : s
}

export function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    view_table: 'View as Table',
    convert_to_json: 'Convert to JSON',
    analyze_lineage: 'Analyze Lineage',
    view_json: 'View Formatted JSON',
    edit_markdown: 'Edit Markdown',
    view_text: 'View Text',
    browse: 'Browse Folder',
  }
  return labels[action] ?? action
}
