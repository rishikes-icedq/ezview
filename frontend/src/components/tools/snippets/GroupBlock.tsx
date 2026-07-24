import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronRight, ChevronDown, Tag, Plus, Pencil, GripVertical } from 'lucide-react'
import SnippetRow from './SnippetRow'
import SnippetEditForm from './SnippetEditForm'
import InlineTextForm from './InlineTextForm'
import ConfirmDeleteButton from './ConfirmDeleteButton'
import SnippetDropZone from './SnippetDropZone'
import { groupSnippetsContainerId, type DragData } from './dndHelpers'
import type { SnippetGroup } from '../../../types'

interface Props {
  group: SnippetGroup
  collectionId: string
  isOpen: boolean
  onToggle: () => void
  onRename: (title: string) => void
  onDelete: () => void
  onAddSnippet: (snippet: { title: string; content: string }) => void
  onUpdateSnippet: (snippetId: string, patch: { title: string; content: string }) => void
  onDeleteSnippet: (snippetId: string) => void
}

const iconBtnClass = 'p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors'
const addBtnClass = 'flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 border border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 px-1.5 py-0.5 rounded transition-colors'

export default function GroupBlock({ group, collectionId, isOpen, onToggle, onRename, onDelete, onAddSnippet, onUpdateSnippet, onDeleteSnippet }: Props) {
  const [renaming, setRenaming] = useState(false)
  const [addingSnippet, setAddingSnippet] = useState(false)

  const dragData: DragData = { type: 'group', collectionId, title: group.title }
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: group.id, data: dragData })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }

  return (
    <div ref={setNodeRef} style={style} className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-900/40">
        {renaming ? (
          <div className="flex-1">
            <InlineTextForm
              placeholder="Group name"
              initialValue={group.title}
              onSubmit={t => { onRename(t); setRenaming(false) }}
              onCancel={() => setRenaming(false)}
            />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <button {...attributes} {...listeners} title="Drag to reorder" className="p-0.5 text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 cursor-grab active:cursor-grabbing touch-none shrink-0">
                <GripVertical size={13} />
              </button>
              <button onClick={onToggle} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                {isOpen ? <ChevronDown size={13} className="text-slate-400 shrink-0" /> : <ChevronRight size={13} className="text-slate-400 shrink-0" />}
                <Tag size={13} className="text-amber-600 dark:text-amber-400 shrink-0" />
                <span className="font-medium text-sm text-slate-700 dark:text-slate-300 truncate">{group.title}</span>
                <span className="text-xs text-slate-400 shrink-0">{group.snippets.length}</span>
              </button>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => setAddingSnippet(true)} className={addBtnClass}><Plus size={11} /> Snippet</button>
              <button onClick={() => setRenaming(true)} title="Rename group" className={iconBtnClass}><Pencil size={12} /></button>
              <ConfirmDeleteButton onConfirm={onDelete} title="Delete group" />
            </div>
          </>
        )}
      </div>

      {isOpen && (
        <div className="p-2.5 space-y-2">
          <SnippetDropZone
            containerId={groupSnippetsContainerId(group.id)}
            collectionId={collectionId}
            groupId={group.id}
            items={group.snippets.map(s => s.id)}
          >
            {group.snippets.map(s => (
              <SnippetRow
                key={s.id}
                snippet={s}
                collectionId={collectionId}
                groupId={group.id}
                onUpdate={(title, content) => onUpdateSnippet(s.id, { title, content })}
                onDelete={() => onDeleteSnippet(s.id)}
              />
            ))}
          </SnippetDropZone>
          {addingSnippet && (
            <div className="rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
              <SnippetEditForm
                onSave={(title, content) => { onAddSnippet({ title, content }); setAddingSnippet(false) }}
                onCancel={() => setAddingSnippet(false)}
              />
            </div>
          )}
          {group.snippets.length === 0 && !addingSnippet && (
            <div className="text-xs text-slate-400 italic px-1 py-1">No snippets yet — drag one here or click "+ Snippet".</div>
          )}
        </div>
      )}
    </div>
  )
}
