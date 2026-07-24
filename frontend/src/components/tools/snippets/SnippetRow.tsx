import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Copy, Check, Pencil, GripVertical } from 'lucide-react'
import SnippetEditForm from './SnippetEditForm'
import ConfirmDeleteButton from './ConfirmDeleteButton'
import type { DragData } from './dndHelpers'
import type { Snippet } from '../../../types'

interface Props {
  snippet: Snippet
  collectionId: string
  groupId: string | null
  onUpdate: (title: string, content: string) => void
  onDelete: () => void
}

const iconBtnClass = 'p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors'

export default function SnippetRow({ snippet, collectionId, groupId, onUpdate, onDelete }: Props) {
  const [editing, setEditing] = useState(false)
  const [copied, setCopied] = useState(false)

  const dragData: DragData = { type: 'snippet', collectionId, groupId, title: snippet.title }
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: snippet.id, data: dragData })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }

  const copy = () => {
    navigator.clipboard.writeText(snippet.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (editing) {
    return (
      <div ref={setNodeRef} style={style} className="rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
        <SnippetEditForm
          initialTitle={snippet.title}
          initialContent={snippet.content}
          onSave={(title, content) => { onUpdate(title, content); setEditing(false) }}
          onCancel={() => setEditing(false)}
        />
      </div>
    )
  }

  return (
    <div ref={setNodeRef} style={style} className="rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/60 dark:bg-slate-900/30">
        <div className="flex items-center gap-1 min-w-0">
          <button {...attributes} {...listeners} title="Drag to reorder or move" className="p-0.5 text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 cursor-grab active:cursor-grabbing touch-none shrink-0">
            <GripVertical size={12} />
          </button>
          <span className="text-xs font-mono font-medium text-slate-600 dark:text-slate-300 truncate">{snippet.title}</span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={copy} title="Copy" className={iconBtnClass}>
            {copied ? <Check size={12} className="text-emerald-600 dark:text-emerald-400" /> : <Copy size={12} />}
          </button>
          <button onClick={() => setEditing(true)} title="Edit" className={iconBtnClass}>
            <Pencil size={12} />
          </button>
          <ConfirmDeleteButton onConfirm={onDelete} title="Delete snippet" />
        </div>
      </div>
      <pre className="text-xs font-mono text-slate-700 dark:text-slate-300 overflow-x-auto whitespace-pre-wrap break-words leading-relaxed p-3">{snippet.content}</pre>
    </div>
  )
}
