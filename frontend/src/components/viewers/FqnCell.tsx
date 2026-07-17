import { isFqn, FQN_SEGMENT_COLORS } from '../../utils/fqn'

interface Props {
  value: string
  truncate?: boolean
}

export default function FqnCell({ value, truncate = true }: Props) {
  if (!value || !isFqn(value)) {
    return (
      <span className={`font-mono text-xs text-slate-700 dark:text-slate-300 ${truncate ? 'block truncate' : ''}`}>
        {value || '—'}
      </span>
    )
  }

  const parts = value.split('/').filter(Boolean)

  return (
    <span className={`font-mono text-xs ${truncate ? 'block truncate' : 'break-all'}`} title={value}>
      <span className="text-slate-400 dark:text-slate-600">/</span>
      {parts.map((part, i) => (
        <span key={i}>
          <span className={FQN_SEGMENT_COLORS[i] ?? 'text-slate-700 dark:text-slate-300'}>{part}</span>
          {i < parts.length - 1 && <span className="text-slate-400 dark:text-slate-600">/</span>}
        </span>
      ))}
    </span>
  )
}
