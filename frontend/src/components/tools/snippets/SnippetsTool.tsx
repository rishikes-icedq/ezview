import { useEffect, useState } from 'react'
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter, DragOverlay,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { BookOpen, Plus, Loader2, FolderOpen, Tag } from 'lucide-react'
import { toast } from 'sonner'
import { getSnippets, saveSnippets } from '../../../api/snippets'
import CollectionBlock from './CollectionBlock'
import InlineTextForm from './InlineTextForm'
import { moveSnippet, type DragData, type SnippetOwner } from './dndHelpers'
import type { SnippetCollection, Snippet } from '../../../types'

function toggleSet(setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) {
  setter(s => {
    const n = new Set(s)
    if (n.has(key)) n.delete(key)
    else n.add(key)
    return n
  })
}

function DragPreview({ data }: { data: DragData }) {
  if (data.type === 'collection') {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-indigo-400 dark:border-indigo-600 bg-white dark:bg-slate-800 shadow-lg text-sm font-medium text-slate-800 dark:text-slate-200">
        <FolderOpen size={15} className="text-indigo-600 dark:text-indigo-400" /> {data.title}
      </div>
    )
  }
  if (data.type === 'group') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-400 dark:border-amber-600 bg-white dark:bg-slate-800 shadow-lg text-sm font-medium text-slate-700 dark:text-slate-300">
        <Tag size={13} className="text-amber-600 dark:text-amber-400" /> {data.title}
      </div>
    )
  }
  if (data.type === 'snippet') {
    return (
      <div className="px-3 py-1.5 rounded border border-indigo-400 dark:border-indigo-600 bg-white dark:bg-slate-950 shadow-lg text-xs font-mono font-medium text-slate-600 dark:text-slate-300">
        {data.title}
      </div>
    )
  }
  return null
}

export default function SnippetsTool() {
  const [collections, setCollections] = useState<SnippetCollection[]>([])
  const [loading, setLoading] = useState(true)
  const [openCollections, setOpenCollections] = useState<Set<string>>(new Set())
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  const [addingCollection, setAddingCollection] = useState(false)
  const [activeDrag, setActiveDrag] = useState<DragData | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  useEffect(() => {
    getSnippets()
      .then(setCollections)
      .catch(e => toast.error(e instanceof Error ? e.message : 'Failed to load snippets'))
      .finally(() => setLoading(false))
  }, [])

  const persist = async (next: SnippetCollection[]) => {
    setCollections(next)
    try {
      await saveSnippets(next)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save snippets')
    }
  }

  const addCollection = (title: string) =>
    persist([...collections, { id: crypto.randomUUID(), title, groups: [], snippets: [] }])

  const renameCollection = (id: string, title: string) =>
    persist(collections.map(c => (c.id === id ? { ...c, title } : c)))

  const deleteCollection = (id: string) =>
    persist(collections.filter(c => c.id !== id))

  const addGroup = (collectionId: string, title: string) =>
    persist(collections.map(c => (c.id === collectionId
      ? { ...c, groups: [...c.groups, { id: crypto.randomUUID(), title, snippets: [] }] }
      : c)))

  const renameGroup = (collectionId: string, groupId: string, title: string) =>
    persist(collections.map(c => (c.id === collectionId
      ? { ...c, groups: c.groups.map(g => (g.id === groupId ? { ...g, title } : g)) }
      : c)))

  const deleteGroup = (collectionId: string, groupId: string) =>
    persist(collections.map(c => (c.id === collectionId
      ? { ...c, groups: c.groups.filter(g => g.id !== groupId) }
      : c)))

  const addSnippet = (collectionId: string, groupId: string | null, snippet: { title: string; content: string }) => {
    const created: Snippet = { id: crypto.randomUUID(), ...snippet }
    persist(collections.map(c => {
      if (c.id !== collectionId) return c
      if (groupId === null) return { ...c, snippets: [...c.snippets, created] }
      return { ...c, groups: c.groups.map(g => (g.id === groupId ? { ...g, snippets: [...g.snippets, created] } : g)) }
    }))
  }

  const updateSnippet = (collectionId: string, groupId: string | null, snippetId: string, patch: { title: string; content: string }) => {
    const apply = (list: Snippet[]) => list.map(s => (s.id === snippetId ? { ...s, ...patch } : s))
    persist(collections.map(c => {
      if (c.id !== collectionId) return c
      if (groupId === null) return { ...c, snippets: apply(c.snippets) }
      return { ...c, groups: c.groups.map(g => (g.id === groupId ? { ...g, snippets: apply(g.snippets) } : g)) }
    }))
  }

  const deleteSnippet = (collectionId: string, groupId: string | null, snippetId: string) => {
    persist(collections.map(c => {
      if (c.id !== collectionId) return c
      if (groupId === null) return { ...c, snippets: c.snippets.filter(s => s.id !== snippetId) }
      return { ...c, groups: c.groups.map(g => (g.id === groupId ? { ...g, snippets: g.snippets.filter(s => s.id !== snippetId) } : g)) }
    }))
  }

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as DragData | undefined
    if (data) setActiveDrag(data)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDrag(null)
    const { active, over } = event
    if (!over) return
    const activeData = active.data.current as DragData | undefined
    const overData = over.data.current as DragData | undefined
    if (!activeData) return

    if (activeData.type === 'collection') {
      const oldIndex = collections.findIndex(c => c.id === active.id)
      const newIndex = collections.findIndex(c => c.id === over.id)
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return
      persist(arrayMove(collections, oldIndex, newIndex))
      return
    }

    if (activeData.type === 'group') {
      const collection = collections.find(c => c.id === activeData.collectionId)
      if (!collection) return
      const oldIndex = collection.groups.findIndex(g => g.id === active.id)
      const newIndex = collection.groups.findIndex(g => g.id === over.id)
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return
      const reordered = arrayMove(collection.groups, oldIndex, newIndex)
      persist(collections.map(c => (c.id === collection.id ? { ...c, groups: reordered } : c)))
      return
    }

    if (activeData.type === 'snippet') {
      const fromOwner: SnippetOwner = { collectionId: activeData.collectionId, groupId: activeData.groupId }
      let toOwner: SnippetOwner | null = null
      let overSnippetId: string | null = null

      if (overData?.type === 'snippet') {
        toOwner = { collectionId: overData.collectionId, groupId: overData.groupId }
        overSnippetId = String(over.id)
      } else if (overData?.type === 'container') {
        toOwner = { collectionId: overData.collectionId, groupId: overData.groupId }
      }
      if (!toOwner) return

      const sameOwner = fromOwner.collectionId === toOwner.collectionId && fromOwner.groupId === toOwner.groupId

      if (sameOwner && overSnippetId) {
        const collection = collections.find(c => c.id === toOwner!.collectionId)
        const list = toOwner.groupId === null ? collection?.snippets : collection?.groups.find(g => g.id === toOwner!.groupId)?.snippets
        if (!list) return
        const oldIndex = list.findIndex(s => s.id === active.id)
        const newIndex = list.findIndex(s => s.id === overSnippetId)
        if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return
        const reordered = arrayMove(list, oldIndex, newIndex)
        persist(collections.map(c => {
          if (c.id !== toOwner!.collectionId) return c
          if (toOwner!.groupId === null) return { ...c, snippets: reordered }
          return { ...c, groups: c.groups.map(g => (g.id === toOwner!.groupId ? { ...g, snippets: reordered } : g)) }
        }))
        return
      }

      if (sameOwner) return // dropped back onto its own container's empty space — no-op

      let toIndex: number | undefined
      if (overSnippetId) {
        const collection = collections.find(c => c.id === toOwner!.collectionId)
        const list = toOwner.groupId === null ? collection?.snippets : collection?.groups.find(g => g.id === toOwner!.groupId)?.snippets
        const idx = list?.findIndex(s => s.id === overSnippetId)
        toIndex = idx === undefined || idx === -1 ? undefined : idx
      }
      persist(moveSnippet(collections, String(active.id), fromOwner, toOwner, toIndex))
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-900/50 shrink-0">
        <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300 text-sm font-medium">
          <BookOpen size={15} className="text-indigo-500 dark:text-indigo-400" /> Snippets
        </div>
        <button
          onClick={() => setAddingCollection(true)}
          className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 border border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 px-2.5 py-1 rounded transition-colors"
        >
          <Plus size={12} /> New Collection
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-slate-500 py-4"><Loader2 size={16} className="animate-spin" /> Loading…</div>
        ) : (
          <>
            {addingCollection && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 bg-slate-50 dark:bg-slate-900/40">
                <InlineTextForm
                  placeholder="Collection name"
                  onSubmit={t => { addCollection(t); setAddingCollection(false) }}
                  onCancel={() => setAddingCollection(false)}
                />
              </div>
            )}
            {collections.length === 0 && !addingCollection && (
              <div className="text-slate-400 italic text-sm py-4">
                No snippets yet. Click "New Collection" to store your first command or prompt.
              </div>
            )}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveDrag(null)}>
              <SortableContext items={collections.map(c => c.id)} strategy={verticalListSortingStrategy}>
                {collections.map(c => (
                  <CollectionBlock
                    key={c.id}
                    collection={c}
                    isOpen={openCollections.has(c.id)}
                    onToggle={() => toggleSet(setOpenCollections, c.id)}
                    openGroups={openGroups}
                    onToggleGroup={key => toggleSet(setOpenGroups, key)}
                    onRename={title => renameCollection(c.id, title)}
                    onDelete={() => deleteCollection(c.id)}
                    onAddGroup={title => addGroup(c.id, title)}
                    onRenameGroup={(gid, title) => renameGroup(c.id, gid, title)}
                    onDeleteGroup={gid => deleteGroup(c.id, gid)}
                    onAddSnippet={(gid, snippet) => addSnippet(c.id, gid, snippet)}
                    onUpdateSnippet={(gid, sid, patch) => updateSnippet(c.id, gid, sid, patch)}
                    onDeleteSnippet={(gid, sid) => deleteSnippet(c.id, gid, sid)}
                  />
                ))}
              </SortableContext>
              <DragOverlay>{activeDrag && <DragPreview data={activeDrag} />}</DragOverlay>
            </DndContext>
          </>
        )}
      </div>
    </div>
  )
}
