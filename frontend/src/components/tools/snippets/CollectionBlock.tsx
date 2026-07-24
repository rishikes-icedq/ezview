import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronRight, ChevronDown, FolderOpen, Plus, Pencil, GripVertical } from 'lucide-react'
import GroupBlock from './GroupBlock'
import SnippetRow from './SnippetRow'
import SnippetEditForm from './SnippetEditForm'
import InlineTextForm from './InlineTextForm'
import ConfirmDeleteButton from './ConfirmDeleteButton'
import SnippetDropZone from './SnippetDropZone'
import { collectionSnippetsContainerId, type DragData } from './dndHelpers'
import type { SnippetCollection } from '../../../types'

interface Props {
  collection: SnippetCollection
  isOpen: boolean
  onToggle: () => void
  openGroups: Set<string>
  onToggleGroup: (groupKey: string) => void
  onRename: (title: string) => void
  onDelete: () => void
  onAddGroup: (title: string) => void
  onRenameGroup: (groupId: string, title: string) => void
  onDeleteGroup: (groupId: string) => void
  onAddSnippet: (groupId: string | null, snippet: { title: string; content: string }) => void
  onUpdateSnippet: (groupId: string | null, snippetId: string, patch: { title: string; content: string }) => void
  onDeleteSnippet: (groupId: string | null, snippetId: string) => void
}

const iconBtnClass = 'p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors'
const addBtnClass = 'flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 border border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 px-2 py-1 rounded transition-colors'

export default function CollectionBlock({
  collection, isOpen, onToggle, openGroups, onToggleGroup,
  onRename, onDelete, onAddGroup, onRenameGroup, onDeleteGroup,
  onAddSnippet, onUpdateSnippet, onDeleteSnippet,
}: Props) {
  const [renaming, setRenaming] = useState(false)
  const [addingGroup, setAddingGroup] = useState(false)
  const [addingSnippet, setAddingSnippet] = useState(false)

  const total = collection.snippets.length + collection.groups.reduce((n, g) => n + g.snippets.length, 0)
  const isEmpty = collection.groups.length === 0 && collection.snippets.length === 0

  const dragData: DragData = { type: 'collection', title: collection.title }
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: collection.id, data: dragData })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }

  return (
    <div ref={setNodeRef} style={style} className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-slate-100/60 dark:bg-slate-800/60">
        {renaming ? (
          <div className="flex-1">
            <InlineTextForm
              placeholder="Collection name"
              initialValue={collection.title}
              onSubmit={t => { onRename(t); setRenaming(false) }}
              onCancel={() => setRenaming(false)}
            />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <button {...attributes} {...listeners} title="Drag to reorder" className="p-0.5 text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 cursor-grab active:cursor-grabbing touch-none shrink-0">
                <GripVertical size={14} />
              </button>
              <button onClick={onToggle} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                {isOpen ? <ChevronDown size={14} className="text-slate-400 shrink-0" /> : <ChevronRight size={14} className="text-slate-400 shrink-0" />}
                <FolderOpen size={15} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                <span className="font-medium text-sm text-slate-800 dark:text-slate-200 truncate">{collection.title}</span>
                <span className="text-xs text-slate-400 shrink-0">{total} snippet{total !== 1 ? 's' : ''}</span>
              </button>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => setAddingGroup(true)} className={addBtnClass}><Plus size={12} /> Group</button>
              <button onClick={() => setAddingSnippet(true)} className={addBtnClass}><Plus size={12} /> Snippet</button>
              <button onClick={() => setRenaming(true)} title="Rename collection" className={iconBtnClass}><Pencil size={12} /></button>
              <ConfirmDeleteButton onConfirm={onDelete} title="Delete collection" />
            </div>
          </>
        )}
      </div>

      {isOpen && (
        <div className="p-3 space-y-2.5">
          <SortableContext items={collection.groups.map(g => g.id)} strategy={verticalListSortingStrategy}>
            {collection.groups.map(g => {
              const key = `${collection.id}.${g.id}`
              return (
                <GroupBlock
                  key={g.id}
                  group={g}
                  collectionId={collection.id}
                  isOpen={openGroups.has(key)}
                  onToggle={() => onToggleGroup(key)}
                  onRename={title => onRenameGroup(g.id, title)}
                  onDelete={() => onDeleteGroup(g.id)}
                  onAddSnippet={snippet => onAddSnippet(g.id, snippet)}
                  onUpdateSnippet={(sid, patch) => onUpdateSnippet(g.id, sid, patch)}
                  onDeleteSnippet={sid => onDeleteSnippet(g.id, sid)}
                />
              )
            })}
          </SortableContext>

          {addingGroup && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5 bg-slate-50 dark:bg-slate-900/40">
              <InlineTextForm
                placeholder="Group name"
                onSubmit={t => { onAddGroup(t); setAddingGroup(false) }}
                onCancel={() => setAddingGroup(false)}
              />
            </div>
          )}

          <SnippetDropZone
            containerId={collectionSnippetsContainerId(collection.id)}
            collectionId={collection.id}
            groupId={null}
            items={collection.snippets.map(s => s.id)}
          >
            {collection.snippets.map(s => (
              <SnippetRow
                key={s.id}
                snippet={s}
                collectionId={collection.id}
                groupId={null}
                onUpdate={(title, content) => onUpdateSnippet(null, s.id, { title, content })}
                onDelete={() => onDeleteSnippet(null, s.id)}
              />
            ))}
          </SnippetDropZone>

          {addingSnippet && (
            <div className="rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
              <SnippetEditForm
                onSave={(title, content) => { onAddSnippet(null, { title, content }); setAddingSnippet(false) }}
                onCancel={() => setAddingSnippet(false)}
              />
            </div>
          )}

          {isEmpty && !addingGroup && !addingSnippet && (
            <div className="text-xs text-slate-400 italic px-1 py-1">Empty collection — drag a snippet here, or add a group or snippet.</div>
          )}
        </div>
      )}
    </div>
  )
}
