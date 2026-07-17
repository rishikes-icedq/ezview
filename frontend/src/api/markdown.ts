import api from './client'

export const readMarkdown = (path: string) =>
  api.get<{ path: string; name: string; content: string }>('/markdown/read', { params: { path } }).then(r => r.data)

export const writeMarkdown = (path: string, content: string) =>
  api.post<{ ok: boolean; path: string }>('/markdown/write', { path, content }).then(r => r.data)

export const downloadUrl = (path: string) =>
  `/api/markdown/download?path=${encodeURIComponent(path)}`
