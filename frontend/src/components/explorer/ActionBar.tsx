import { useState, useEffect } from 'react'
import { Play, Loader2 } from 'lucide-react'
import { detectFile } from '../../api/browser'
import type { FileDetection, ViewMode } from '../../types'
import { actionLabel } from '../../utils/format'

interface Props {
  selectedPath: string | null
  onOpen: (detection: FileDetection, action: ViewMode) => void
}

export default function ActionBar({ selectedPath, onOpen }: Props) {
  const [detection, setDetection] = useState<FileDetection | null>(null)
  const [selectedAction, setSelectedAction] = useState<string>('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!selectedPath) { setDetection(null); setSelectedAction(''); return }
    setLoading(true)
    detectFile(selectedPath)
      .then(d => {
        setDetection(d)
        setSelectedAction(d.suggested_actions[0] ?? '')
      })
      .catch(() => { setDetection(null); setSelectedAction('') })
      .finally(() => setLoading(false))
  }, [selectedPath])

  if (!selectedPath) return null

  return (
    <div className="px-3 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-900/80 shrink-0">
      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-xs">
          <Loader2 size={12} className="animate-spin" /> Detecting…
        </div>
      ) : detection ? (
        <div className="flex items-center gap-2">
          <select
            value={selectedAction}
            onChange={e => setSelectedAction(e.target.value)}
            className="flex-1 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs rounded px-2 py-1.5 border border-slate-300 dark:border-slate-700 focus:outline-none focus:border-indigo-500"
          >
            {detection.suggested_actions.map(a => (
              <option key={a} value={a}>{actionLabel(a)}</option>
            ))}
          </select>
          <button
            disabled={!selectedAction}
            onClick={() => onOpen(detection, selectedAction as ViewMode)}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-medium px-3 py-1.5 rounded transition-colors"
          >
            <Play size={11} />
            Open
          </button>
        </div>
      ) : null}
    </div>
  )
}
