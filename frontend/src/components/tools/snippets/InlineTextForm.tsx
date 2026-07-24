import { useState } from 'react'
import { Check, X } from 'lucide-react'

interface Props {
  placeholder: string
  initialValue?: string
  onSubmit: (value: string) => void
  onCancel: () => void
}

export default function InlineTextForm({ placeholder, initialValue = '', onSubmit, onCancel }: Props) {
  const [value, setValue] = useState(initialValue)
  const submit = () => { if (value.trim()) onSubmit(value.trim()) }

  return (
    <div className="flex items-center gap-2">
      <input
        autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel() }}
        placeholder={placeholder}
        className="flex-1 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 text-sm font-medium border border-slate-300 dark:border-slate-700 rounded px-2 py-1 outline-none focus:border-indigo-400 dark:focus:border-indigo-500"
      />
      <button
        onClick={submit}
        disabled={!value.trim()}
        className="p-1.5 rounded text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 disabled:opacity-30 transition-colors"
      >
        <Check size={14} />
      </button>
      <button onClick={onCancel} className="p-1.5 rounded text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
        <X size={14} />
      </button>
    </div>
  )
}
