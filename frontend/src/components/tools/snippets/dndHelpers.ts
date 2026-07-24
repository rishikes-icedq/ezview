import type { SnippetCollection } from '../../../types'

export const groupsContainerId = (collectionId: string) => `groups:${collectionId}`
export const collectionSnippetsContainerId = (collectionId: string) => `csnippets:${collectionId}`
export const groupSnippetsContainerId = (groupId: string) => `gsnippets:${groupId}`

export interface SnippetOwner { collectionId: string; groupId: string | null }

/** Drag payload attached to every draggable/droppable so onDragEnd never has to re-derive ownership by searching the tree. */
export type DragData =
  | { type: 'collection'; title: string }
  | { type: 'group'; collectionId: string; title: string }
  | { type: 'snippet'; collectionId: string; groupId: string | null; title: string }
  | { type: 'container'; collectionId: string; groupId: string | null }

function getSnippetList(collections: SnippetCollection[], owner: SnippetOwner) {
  const collection = collections.find(c => c.id === owner.collectionId)
  if (!collection) return null
  if (owner.groupId === null) return collection.snippets
  return collection.groups.find(g => g.id === owner.groupId)?.snippets ?? null
}

/**
 * Moves the snippet `snippetId` from `fromOwner` to `toOwner`, inserted at
 * `toIndex` (appended to the end if omitted/out of range). `fromOwner`/`toOwner`
 * come straight from the drag event's captured data, never re-derived by
 * searching the tree, so this can't drift from what the user actually dragged.
 */
export function moveSnippet(
  collections: SnippetCollection[],
  snippetId: string,
  fromOwner: SnippetOwner,
  toOwner: SnippetOwner,
  toIndex?: number,
): SnippetCollection[] {
  const fromList = getSnippetList(collections, fromOwner)
  const snippet = fromList?.find(s => s.id === snippetId)
  if (!snippet) return collections

  return collections.map(c => {
    let next = c

    if (fromOwner.collectionId === c.id) {
      if (fromOwner.groupId === null) {
        next = { ...next, snippets: next.snippets.filter(s => s.id !== snippetId) }
      } else {
        next = { ...next, groups: next.groups.map(g => (g.id === fromOwner.groupId ? { ...g, snippets: g.snippets.filter(s => s.id !== snippetId) } : g)) }
      }
    }

    if (toOwner.collectionId === c.id) {
      if (toOwner.groupId === null) {
        const list = next.snippets.slice()
        const idx = toIndex === undefined || toIndex > list.length ? list.length : toIndex
        list.splice(idx, 0, snippet)
        next = { ...next, snippets: list }
      } else {
        next = {
          ...next,
          groups: next.groups.map(g => {
            if (g.id !== toOwner.groupId) return g
            const list = g.snippets.slice()
            const idx = toIndex === undefined || toIndex > list.length ? list.length : toIndex
            list.splice(idx, 0, snippet)
            return { ...g, snippets: list }
          }),
        }
      }
    }

    return next
  })
}
