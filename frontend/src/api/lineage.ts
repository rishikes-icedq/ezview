import api from './client'
import type { LineageSummary, AssetDatabase, EdgePage, ProcessRecord, LineageGraph, GraphMode, LineageBundle, SortDirection } from '../types'

export const detectBundle = (path: string) =>
  api.get<LineageBundle>('/lineage/detect', { params: { path } }).then(r => r.data)

export const getSummary = (folder: string) =>
  api.get<LineageSummary>('/lineage/summary', { params: { folder } }).then(r => r.data)

export const getAssets = (folder: string) =>
  api.get<AssetDatabase[]>('/lineage/assets', { params: { folder } }).then(r => r.data)

export const getEdges = (folder: string, params: {
  page?: number
  page_size?: number
  confidence?: string
  transform?: string
  direction?: string
  source_type?: string
  target_type?: string
  source_search?: string
  target_search?: string
  sort_by?: 'source_fqn' | 'target_fqn'
  sort_dir?: SortDirection
}) => api.get<EdgePage>('/lineage/edges', { params: { folder, ...params } }).then(r => r.data)

export const getProcesses = (folder: string) =>
  api.get<ProcessRecord[]>('/lineage/processes', { params: { folder } }).then(r => r.data)

export const getGraph = (folder: string, mode: GraphMode = 'all') =>
  api.get<LineageGraph>('/lineage/graph', { params: { folder, mode } }).then(r => r.data)
