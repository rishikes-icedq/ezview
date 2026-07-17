import { useState, useEffect } from 'react'
import { Download, Copy, Check, Loader2 } from 'lucide-react'
import api from '../../api/client'
import { getAsJson, downloadUrl } from '../../api/parquet'
import { JsonNode } from './JsonNode'

interface Props { path: string; source?: 'json' | 'parquet' }

export default function JsonViewer({ path, source = 'json' }: Props) {
  const [data, setData] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(null)
    const request = source === 'parquet'
      ? getAsJson(path)
      : api.get('/json/read', { params: { path } }).then(r => r.data)
    request
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [path, source])

  const copyAll = () => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const filename = path.split(/[\\/]/).pop() ?? 'file'

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-900/50 shrink-0">
        <span className="text-slate-700 dark:text-slate-300 text-sm font-medium">{filename}</span>
        <div className="flex items-center gap-2">
          <button onClick={copyAll} className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 border border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 px-2.5 py-1 rounded transition-colors">
            {copied ? <Check size={12} className="text-emerald-600 dark:text-emerald-400" /> : <Copy size={12} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <a
            href={source === 'parquet' ? downloadUrl(path, 'json') : `/api/json/download?path=${encodeURIComponent(path)}`}
            download
            className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 border border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 px-2.5 py-1 rounded transition-colors"
          >
            <Download size={12} /> Download
          </a>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center gap-2 text-slate-500">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : error ? (
          <div className="px-3 py-2 bg-red-50 dark:bg-red-900/40 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 text-sm rounded">{error}</div>
        ) : (
          <div className="font-mono text-xs leading-relaxed text-slate-800 dark:text-slate-200">
            <JsonNode value={data} depth={0} collapsed={false} />
          </div>
        )}
      </div>
    </div>
  )
}
