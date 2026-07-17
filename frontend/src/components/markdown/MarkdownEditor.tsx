import { useState, useEffect } from 'react'
import MDEditor from '@uiw/react-md-editor'
import { Save, Download, Loader2, Check, Columns2, Eye, PenLine } from 'lucide-react'
import { readMarkdown, writeMarkdown, downloadUrl } from '../../api/markdown'
import { useTheme } from '../../contexts/ThemeContext'
import { toast } from 'sonner'

type Mode = 'edit' | 'live' | 'preview'

interface Props { path: string }

export default function MarkdownEditor({ path }: Props) {
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [mode, setMode] = useState<Mode>('live')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { theme } = useTheme()

  const filename = path.split(/[\\/]/).pop() ?? 'file'
  const isDirty = content !== savedContent

  useEffect(() => {
    setLoading(true)
    setError(null)
    readMarkdown(path)
      .then(d => { setContent(d.content); setSavedContent(d.content) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [path])

  const save = async () => {
    setSaving(true)
    try {
      await writeMarkdown(path, content)
      setSavedContent(content)
      toast.success('Saved')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const MODES: { id: Mode; label: string; icon: React.ReactNode }[] = [
    { id: 'edit',    label: 'Edit',    icon: <PenLine size={13} /> },
    { id: 'live',    label: 'Split',   icon: <Columns2 size={13} /> },
    { id: 'preview', label: 'Preview', icon: <Eye size={13} /> },
  ]

  return (
    <div className="flex flex-col h-full" data-color-mode={theme}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-900/50 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-slate-700 dark:text-slate-300 text-sm font-medium">{filename}</span>
          {isDirty && <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">● Unsaved</span>}
        </div>

        <div className="flex items-center gap-2">
          {/* Mode switcher */}
          <div className="flex border border-slate-300 dark:border-slate-700 rounded overflow-hidden">
            {MODES.map(m => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs transition-colors
                  ${mode === m.id ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
              >
                {m.icon}
                {m.label}
              </button>
            ))}
          </div>

          <a
            href={downloadUrl(path)}
            download
            className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 border border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 px-2.5 py-1 rounded transition-colors"
          >
            <Download size={12} /> Download
          </a>

          <button
            onClick={save}
            disabled={saving || !isDirty}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-medium px-3 py-1.5 rounded transition-colors"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : isDirty ? <Save size={12} /> : <Check size={12} className="text-emerald-400" />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-slate-500 gap-2">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : error ? (
          <div className="m-4 px-3 py-2 bg-red-50 dark:bg-red-900/40 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 text-sm rounded">{error}</div>
        ) : (
          <MDEditor
            value={content}
            onChange={v => setContent(v ?? '')}
            preview={mode}
            height="100%"
            style={{ height: '100%' }}
            visibleDragbar={false}
          />
        )}
      </div>
    </div>
  )
}
