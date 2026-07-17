import { useState } from 'react'
import { isFqn, FQN_SEGMENT_COLORS } from '../../utils/fqn'

interface NodeProps {
  value: unknown
  depth?: number
  collapsed?: boolean
}

export function FqnSpan({ value }: { value: string }) {
  const parts = value.split('/').filter(Boolean)
  return (
    <span className="font-mono">
      <span className="text-slate-400 dark:text-slate-600">/</span>
      {parts.map((p, i) => (
        <span key={i}>
          <span className={FQN_SEGMENT_COLORS[i] ?? 'text-slate-700 dark:text-slate-300'}>{p}</span>
          {i < parts.length - 1 && <span className="text-slate-400 dark:text-slate-600">/</span>}
        </span>
      ))}
    </span>
  )
}

export function JsonNode({ value, depth = 0, collapsed: initCollapsed = false }: NodeProps) {
  const [open, setOpen] = useState(!initCollapsed && depth < 2)

  if (value === null) return <span className="text-slate-500">null</span>
  if (typeof value === 'boolean') return <span className="text-orange-600 dark:text-orange-400">{String(value)}</span>
  if (typeof value === 'number') return <span className="text-cyan-700 dark:text-cyan-400">{String(value)}</span>
  if (typeof value === 'string') {
    if (isFqn(value)) return <FqnSpan value={value} />
    return <span className="text-emerald-700 dark:text-emerald-400 break-all">"{value}"</span>
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-slate-500">[]</span>
    return (
      <span>
        <button onClick={() => setOpen(!open)} className="text-yellow-600 dark:text-yellow-400 hover:text-yellow-800 dark:hover:text-yellow-200 font-mono text-xs transition-colors">
          {open ? '▾' : '▸'} [{value.length}]
        </button>
        {open && (
          <div className="ml-4 border-l border-slate-200 dark:border-slate-800 pl-3 mt-0.5">
            {value.map((v, i) => (
              <div key={i} className="py-0.5">
                <span className="text-slate-400 dark:text-slate-600 text-xs mr-1">{i}:</span>
                <JsonNode value={v} depth={depth + 1} />
                {i < value.length - 1 && <span className="text-slate-400 dark:text-slate-600">,</span>}
              </div>
            ))}
          </div>
        )}
      </span>
    )
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value as object)
    if (keys.length === 0) return <span className="text-slate-500">{'{}'}</span>
    return (
      <span>
        <button onClick={() => setOpen(!open)} className="text-yellow-600 dark:text-yellow-400 hover:text-yellow-800 dark:hover:text-yellow-200 font-mono text-xs transition-colors">
          {open ? '▾' : '▸'} {'{'}…{'}'} <span className="text-slate-400 dark:text-slate-600 text-xs">{keys.length} keys</span>
        </button>
        {open && (
          <div className="ml-4 border-l border-slate-200 dark:border-slate-800 pl-3 mt-0.5">
            {keys.map((k, i) => (
              <div key={k} className="py-0.5">
                <span className="text-blue-700 dark:text-blue-400 text-xs mr-1">"{k}"</span>
                <span className="text-slate-400 dark:text-slate-600 mr-1">:</span>
                <JsonNode value={(value as Record<string, unknown>)[k]} depth={depth + 1} />
                {i < keys.length - 1 && <span className="text-slate-400 dark:text-slate-600">,</span>}
              </div>
            ))}
          </div>
        )}
      </span>
    )
  }

  return <span className="text-slate-700 dark:text-slate-300">{String(value)}</span>
}
