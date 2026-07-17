import { useEffect, useRef, useState } from 'react'
import { diffLines, diffChars, type Change } from 'diff'
import { FileDiff, FolderOpen, Eraser, Loader2 } from 'lucide-react'
import { pickPath, readText } from '../../api/browser'

const DIFF_DEBOUNCE_MS = 350

interface Segment {
  text: string
  changed: boolean
}

interface Row {
  left: Segment[] | null
  right: Segment[] | null
  kind: 'same' | 'removed' | 'added' | 'modified'
}

function linesOf(part: Change): string[] {
  const lines = part.value.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

// Character-level diff for a single changed line pair — only the
// characters that actually differ get marked, the rest of the line is
// shared between both sides unmarked.
function diffLinePair(oldLine: string, newLine: string): { left: Segment[]; right: Segment[] } {
  const parts = diffChars(oldLine, newLine)
  const left: Segment[] = []
  const right: Segment[] = []
  for (const part of parts) {
    if (part.added) {
      right.push({ text: part.value, changed: true })
    } else if (part.removed) {
      left.push({ text: part.value, changed: true })
    } else {
      left.push({ text: part.value, changed: false })
      right.push({ text: part.value, changed: false })
    }
  }
  return { left, right }
}

function buildRows(parts: Change[]): Row[] {
  const rows: Row[] = []
  let i = 0
  while (i < parts.length) {
    const part = parts[i]

    if (part.removed) {
      const removedLines = linesOf(part)
      const next = parts[i + 1]
      if (next?.added) {
        // A removed block immediately followed by an added block is a
        // "replace" — pair up lines 1:1 and diff each pair at the
        // character level so only the actual differences are highlighted.
        const addedLines = linesOf(next)
        const pairCount = Math.min(removedLines.length, addedLines.length)
        for (let j = 0; j < pairCount; j++) {
          const { left, right } = diffLinePair(removedLines[j], addedLines[j])
          rows.push({ left, right, kind: 'modified' })
        }
        for (let j = pairCount; j < removedLines.length; j++) {
          rows.push({ left: [{ text: removedLines[j], changed: true }], right: null, kind: 'removed' })
        }
        for (let j = pairCount; j < addedLines.length; j++) {
          rows.push({ left: null, right: [{ text: addedLines[j], changed: true }], kind: 'added' })
        }
        i += 2
        continue
      }
      for (const line of removedLines) {
        rows.push({ left: [{ text: line, changed: true }], right: null, kind: 'removed' })
      }
      i += 1
      continue
    }

    if (part.added) {
      for (const line of linesOf(part)) {
        rows.push({ left: null, right: [{ text: line, changed: true }], kind: 'added' })
      }
      i += 1
      continue
    }

    for (const line of linesOf(part)) {
      rows.push({ left: [{ text: line, changed: false }], right: [{ text: line, changed: false }], kind: 'same' })
    }
    i += 1
  }
  return rows
}

function Side({
  label, value, onChange, onBrowse, loading, error,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onBrowse: () => void
  loading: boolean
  error: string | null
}) {
  return (
    <div className="w-1/2 flex flex-col min-h-0" style={{ minHeight: 140 }}>
      <div className="px-3 py-1.5 text-xs text-slate-500 border-b border-slate-200 dark:border-slate-800/60 shrink-0 flex items-center justify-between">
        <span>{label}</span>
        <button
          onClick={onBrowse}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 disabled:opacity-40 border border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 px-2 py-0.5 rounded transition-colors"
        >
          {loading ? <Loader2 size={11} className="animate-spin" /> : <FolderOpen size={11} />}
          Browse…
        </button>
      </div>
      {error && (
        <div className="mx-3 mt-2 px-2 py-1.5 bg-red-50 dark:bg-red-900/40 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 text-xs rounded shrink-0">{error}</div>
      )}
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Paste text…"
        spellCheck={false}
        className="flex-1 min-h-0 resize-none bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 font-mono text-xs leading-relaxed p-3 outline-none placeholder:text-slate-400 dark:placeholder:text-slate-600"
      />
    </div>
  )
}

function Cell({ segments, side }: { segments: Segment[] | null; side: 'left' | 'right' }) {
  if (segments === null) return <div className="px-3 py-0.5 bg-slate-100 dark:bg-slate-900/40">&nbsp;</div>
  const changedClass = side === 'left'
    ? 'bg-red-200 text-red-900 dark:bg-red-500/30 dark:text-red-100 font-semibold underline decoration-red-600 dark:decoration-red-400 decoration-2 underline-offset-2'
    : 'bg-emerald-200 text-emerald-900 dark:bg-emerald-500/30 dark:text-emerald-100 font-semibold underline decoration-emerald-600 dark:decoration-emerald-400 decoration-2 underline-offset-2'
  return (
    <div className="px-3 py-0.5 whitespace-pre-wrap break-all text-slate-700 dark:text-slate-300">
      {segments.map((seg, i) => (
        <span key={i} className={seg.changed ? changedClass : undefined}>{seg.text}</span>
      ))}
    </div>
  )
}

export default function DiffTool() {
  const [textA, setTextA] = useState('')
  const [textB, setTextB] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [loadingA, setLoadingA] = useState(false)
  const [loadingB, setLoadingB] = useState(false)
  const [errorA, setErrorA] = useState<string | null>(null)
  const [errorB, setErrorB] = useState<string | null>(null)
  const timer = useRef<number>()

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current)
    if (!textA && !textB) {
      setRows([])
      return
    }
    timer.current = window.setTimeout(() => {
      setRows(buildRows(diffLines(textA, textB)))
    }, DIFF_DEBOUNCE_MS)
    return () => { if (timer.current) window.clearTimeout(timer.current) }
  }, [textA, textB])

  const browse = async (side: 'A' | 'B') => {
    const setLoading = side === 'A' ? setLoadingA : setLoadingB
    const setError = side === 'A' ? setErrorA : setErrorB
    const setText = side === 'A' ? setTextA : setTextB
    setLoading(true)
    setError(null)
    try {
      const { path } = await pickPath('file')
      if (!path) return
      const { content } = await readText(path)
      setText(content)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load file')
    } finally {
      setLoading(false)
    }
  }

  const clear = () => {
    setTextA('')
    setTextB('')
    setRows([])
    setErrorA(null)
    setErrorB(null)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-900/50 shrink-0">
        <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300 text-sm font-medium">
          <FileDiff size={15} className="text-indigo-500 dark:text-indigo-400" /> Diff / Compare
        </div>
        <button
          onClick={clear}
          disabled={!textA && !textB}
          className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 disabled:opacity-40 disabled:hover:text-slate-500 dark:disabled:hover:text-slate-400 border border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 px-2.5 py-1 rounded transition-colors"
        >
          <Eraser size={12} /> Clear
        </button>
      </div>

      <div className="flex border-b border-slate-200 dark:border-slate-800" style={{ height: '35%' }}>
        <Side label="Text A" value={textA} onChange={setTextA} onBrowse={() => browse('A')} loading={loadingA} error={errorA} />
        <div className="w-px bg-slate-200 dark:bg-slate-800" />
        <Side label="Text B" value={textB} onChange={setTextB} onBrowse={() => browse('B')} loading={loadingB} error={errorB} />
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {rows.length === 0 ? (
          <div className="text-slate-400 dark:text-slate-600 italic text-sm p-4">Paste or load text on both sides to see a diff.</div>
        ) : (
          <div className="font-mono text-xs leading-relaxed">
            {rows.map((row, i) => (
              <div key={i} className="grid grid-cols-2">
                <div className="border-r border-slate-200 dark:border-slate-800">
                  <Cell segments={row.left} side="left" />
                </div>
                <Cell segments={row.right} side="right" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
