import { useState } from 'react'

interface Props {
  initialTitle?: string
  initialContent?: string
  onSave: (title: string, content: string) => void
  onCancel: () => void
}

export default function SnippetEditForm({ initialTitle = '', initialContent = '', onSave, onCancel }: Props) {
  const [title, setTitle] = useState(initialTitle)
  const [content, setContent] = useState(initialContent)
  const canSave = title.trim().length > 0

  return (
    <div className="p-2.5 space-y-2 bg-slate-50 dark:bg-slate-900/40">
      <input
        autoFocus
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Snippet title"
        className="w-full bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded px-2 py-1.5 outline-none focus:border-indigo-400 dark:focus:border-indigo-500"
      />
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="Paste command / code / text…"
        spellCheck={false}
        rows={6}
        className="w-full resize-y bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 font-mono text-xs leading-relaxed p-2 border border-slate-300 dark:border-slate-700 rounded outline-none focus:border-indigo-400 dark:focus:border-indigo-500 placeholder:text-slate-400 dark:placeholder:text-slate-600"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => canSave && onSave(title.trim(), content)}
          disabled={!canSave}
          className="text-xs text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 px-2.5 py-1 rounded transition-colors"
        >
          Save
        </button>
      </div>
    </div>
  )
}
