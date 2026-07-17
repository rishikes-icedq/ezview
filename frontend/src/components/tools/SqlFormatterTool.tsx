import { useRef, useState } from 'react'
import { Code2, Copy, Check, Eraser, Wand2 } from 'lucide-react'
import { format, type SqlLanguage } from 'sql-formatter'
import { cleanSqlInput } from '../../utils/cleanSqlInput'

const FORMAT_DEBOUNCE_MS = 350

const DIALECTS: { label: string; value: SqlLanguage }[] = [
  { label: 'Standard SQL', value: 'sql' },
  { label: 'BigQuery', value: 'bigquery' },
  { label: 'Snowflake', value: 'snowflake' },
  { label: 'Oracle', value: 'plsql' },
  { label: 'SQL Server', value: 'tsql' },
]

export default function SqlFormatterTool() {
  const [input, setInput] = useState('')
  const [dialect, setDialect] = useState<SqlLanguage>('sql')
  const [formatted, setFormatted] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cleaned, setCleaned] = useState(false)
  const [copied, setCopied] = useState(false)
  const timer = useRef<number>()

  const runFormat = (text: string, lang: SqlLanguage) => {
    if (!text.trim()) {
      setFormatted('')
      setError(null)
      setCleaned(false)
      return
    }
    const opts = { language: lang, keywordCase: 'upper' as const, tabWidth: 2 }
    try {
      setFormatted(format(text, opts))
      setError(null)
      setCleaned(false)
      return
    } catch { /* fall through to the cleaned-input attempt below */ }

    try {
      setFormatted(format(cleanSqlInput(text), opts))
      setError(null)
      setCleaned(true)
    } catch (e) {
      setFormatted('')
      setError(e instanceof Error ? e.message : String(e))
      setCleaned(false)
    }
  }

  const scheduleFormat = (text: string, lang: SqlLanguage) => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => runFormat(text, lang), FORMAT_DEBOUNCE_MS)
  }

  const handleInputChange = (text: string) => {
    setInput(text)
    scheduleFormat(text, dialect)
  }

  const handleDialectChange = (lang: SqlLanguage) => {
    setDialect(lang)
    scheduleFormat(input, lang)
  }

  const clear = () => {
    setInput('')
    setFormatted('')
    setError(null)
    setCleaned(false)
  }

  const copyFormatted = () => {
    navigator.clipboard.writeText(formatted)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const hasResult = formatted !== ''

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-900/50 shrink-0">
        <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300 text-sm font-medium">
          <Code2 size={15} className="text-indigo-500 dark:text-indigo-400" /> SQL Formatter
        </div>
        <div className="flex items-center gap-2">
          <select
            value={dialect}
            onChange={e => handleDialectChange(e.target.value as SqlLanguage)}
            className="bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs rounded px-2 py-1 border border-slate-300 dark:border-slate-700 focus:outline-none focus:border-indigo-500"
          >
            {DIALECTS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
          <button
            onClick={clear}
            disabled={!input}
            className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 disabled:opacity-40 disabled:hover:text-slate-500 dark:disabled:hover:text-slate-400 border border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 px-2.5 py-1 rounded transition-colors"
          >
            <Eraser size={12} /> Clear
          </button>
          <button
            onClick={copyFormatted}
            disabled={!hasResult}
            className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 disabled:opacity-40 disabled:hover:text-slate-500 dark:disabled:hover:text-slate-400 border border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 px-2.5 py-1 rounded transition-colors"
          >
            {copied ? <Check size={12} className="text-emerald-600 dark:text-emerald-400" /> : <Copy size={12} />}
            {copied ? 'Copied!' : 'Copy formatted'}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* Input pane */}
        <div className="w-1/2 flex flex-col border-r border-slate-200 dark:border-slate-800 min-h-0">
          <div className="px-3 py-1.5 text-xs text-slate-500 border-b border-slate-200 dark:border-slate-800/60 shrink-0">
            Paste raw SQL
          </div>
          <textarea
            value={input}
            onChange={e => handleInputChange(e.target.value)}
            placeholder="SELECT a, b, c FROM t WHERE x = 1 AND y = 2"
            spellCheck={false}
            className="flex-1 min-h-0 resize-none bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 font-mono text-xs leading-relaxed p-3 outline-none placeholder:text-slate-400 dark:placeholder:text-slate-600"
          />
        </div>

        {/* Output pane */}
        <div className="w-1/2 flex flex-col min-h-0">
          <div className="px-3 py-1.5 text-xs text-slate-500 border-b border-slate-200 dark:border-slate-800/60 shrink-0 flex items-center gap-1.5">
            {cleaned && hasResult ? (
              <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <Wand2 size={11} /> cleaned up embedded/escaped JSON text before formatting
              </span>
            ) : (
              <span>Formatted result</span>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-4">
            {error ? (
              <div className="px-3 py-2 bg-red-50 dark:bg-red-900/40 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 text-sm rounded">{error}</div>
            ) : hasResult ? (
              <pre className="text-xs font-mono text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-900/60 overflow-x-auto whitespace-pre-wrap leading-relaxed p-3 rounded">
                {formatted}
              </pre>
            ) : (
              <div className="text-slate-400 dark:text-slate-600 italic text-sm">Nothing to show yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
