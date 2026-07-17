import { useState } from 'react'
import { Braces, Copy, Check, Eraser, Wand2 } from 'lucide-react'
import { JsonNode } from '../viewers/JsonNode'
import { smartParseJson } from '../../utils/smartJsonParse'

export default function JsonFormatterTool() {
  const [input, setInput] = useState('')
  const [value, setValue] = useState<unknown>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [unwrapped, setUnwrapped] = useState(0)
  const [copied, setCopied] = useState(false)

  const format = (text: string) => {
    if (!text.trim()) {
      setValue(undefined)
      setError(null)
      setUnwrapped(0)
      return
    }
    const result = smartParseJson(text)
    if ('error' in result && result.error) {
      setValue(undefined)
      setError(result.error)
      setUnwrapped(0)
    } else {
      setValue(result.value)
      setError(null)
      setUnwrapped(result.unwrapped)
    }
  }

  const handleChange = (text: string) => {
    setInput(text)
    format(text)
  }

  const clear = () => {
    setInput('')
    setValue(undefined)
    setError(null)
    setUnwrapped(0)
  }

  const copyFormatted = () => {
    navigator.clipboard.writeText(JSON.stringify(value, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const hasResult = value !== undefined

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-900/50 shrink-0">
        <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300 text-sm font-medium">
          <Braces size={15} className="text-indigo-500 dark:text-indigo-400" /> JSON Formatter
        </div>
        <div className="flex items-center gap-2">
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
            Paste JSON — plain or stringified/escaped
          </div>
          <textarea
            value={input}
            onChange={e => handleChange(e.target.value)}
            placeholder={'{"code": "IceDQAPIError", "message": "..."}'}
            spellCheck={false}
            className="flex-1 min-h-0 resize-none bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 font-mono text-xs leading-relaxed p-3 outline-none placeholder:text-slate-400 dark:placeholder:text-slate-600"
          />
        </div>

        {/* Output pane */}
        <div className="w-1/2 flex flex-col min-h-0">
          <div className="px-3 py-1.5 text-xs text-slate-500 border-b border-slate-200 dark:border-slate-800/60 shrink-0 flex items-center gap-1.5">
            {unwrapped > 0 && hasResult && (
              <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <Wand2 size={11} /> unwrapped {unwrapped} layer{unwrapped !== 1 ? 's' : ''} of stringified JSON
              </span>
            )}
            {!hasResult && !error && <span>Formatted result</span>}
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-4">
            {error ? (
              <div className="px-3 py-2 bg-red-50 dark:bg-red-900/40 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 text-sm rounded">{error}</div>
            ) : hasResult ? (
              <div className="font-mono text-xs leading-relaxed text-slate-800 dark:text-slate-200">
                <JsonNode value={value} depth={0} collapsed={false} />
              </div>
            ) : (
              <div className="text-slate-400 dark:text-slate-600 italic text-sm">Nothing to show yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
