import { useState, useEffect } from 'react'
import { Loader2, Download } from 'lucide-react'
import api from '../../api/client'

interface Props { path: string }

export default function TextViewer({ path }: Props) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    api.get('/markdown/read', { params: { path } })
      .then(r => setText(r.data.content))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [path])

  const filename = path.split(/[\\/]/).pop() ?? 'file'
  const lines = text.split('\n')

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-900/50 shrink-0">
        <span className="text-slate-700 dark:text-slate-300 text-sm font-medium">{filename}</span>
        {text && (
          <span className="text-slate-500 text-xs">{lines.length} lines</span>
        )}
      </div>
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center gap-2 text-slate-500"><Loader2 size={16} className="animate-spin" /> Loading…</div>
        ) : error ? (
          <div className="text-red-600 dark:text-red-300 text-sm">{error}</div>
        ) : (
          <pre className="font-mono text-xs text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap break-words">{text}</pre>
        )}
      </div>
    </div>
  )
}
