import type { ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { DragData } from './dndHelpers'

interface Props {
  containerId: string
  collectionId: string
  groupId: string | null
  items: string[]
  children: ReactNode
}

/** A snippet list that can both reorder its own items and accept snippets dragged in from elsewhere. */
export default function SnippetDropZone({ containerId, collectionId, groupId, items, children }: Props) {
  const data: DragData = { type: 'container', collectionId, groupId }
  const { setNodeRef, isOver } = useDroppable({ id: containerId, data })

  return (
    <div
      ref={setNodeRef}
      className={`space-y-2 rounded transition-colors ${isOver ? 'bg-indigo-50/60 dark:bg-indigo-950/30 ring-1 ring-indigo-300 dark:ring-indigo-700 p-1 -m-1' : ''}`}
    >
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </div>
  )
}
