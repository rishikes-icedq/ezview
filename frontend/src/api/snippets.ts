import api from './client'
import type { SnippetCollection } from '../types'

export const getSnippets = () =>
  api.get<{ collections: SnippetCollection[] }>('/snippets').then(r => r.data.collections)

export const saveSnippets = (collections: SnippetCollection[]) =>
  api.put<{ collections: SnippetCollection[] }>('/snippets', { collections }).then(r => r.data.collections)
