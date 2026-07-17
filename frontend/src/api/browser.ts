import api from './client'
import type { FileEntry, FileDetection } from '../types'

export const getRoots = () => api.get<{ label: string; path: string }[]>('/browser/roots').then(r => r.data)

export const listDir = (path: string) =>
  api.get<{ path: string; entries: FileEntry[] }>('/browser/list', { params: { path } }).then(r => r.data)

export const detectFile = (path: string) =>
  api.get<FileDetection>('/browser/detect', { params: { path } }).then(r => r.data)

// Opens a native OS folder/file picker (blocks server-side until the user
// responds). Only viable for this tool's local, single-user usage model.
export const pickPath = (mode: 'folder' | 'file') =>
  api.get<{ path: string | null }>('/browser/pick', { params: { mode } }).then(r => r.data)

export const readText = (path: string) =>
  api.get<{ path: string; name: string; content: string; size: number }>('/browser/read-text', { params: { path } }).then(r => r.data)
