import api from './client'
import type { LineageSummary, AssetDatabase, EdgePage, ProcessRecord, LineageGraph, GraphMode, LineageBundle, SortDirection, BiNamesInfo, ColumnLineage } from '../types'

export const detectBundle = (path: string) =>
  api.get<LineageBundle>('/lineage/detect', { params: { path } }).then(r => r.data)

export const getSummary = (folder: string) =>
  api.get<LineageSummary>('/lineage/summary', { params: { folder } }).then(r => r.data)

/** `crawl`: a Power BI crawl folder chosen by hand; null/omitted = the one found next to the bundle. */
export const getAssets = (folder: string, crawl: string | null = null) =>
  api.get<AssetDatabase[]>('/lineage/assets', { params: { folder, crawl: crawl || undefined } }).then(r => r.data)

export const getBiNames = (folder: string, crawl: string | null = null) =>
  api.get<BiNamesInfo>('/lineage/bi-names', { params: { folder, crawl: crawl || undefined } }).then(r => r.data)

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

export const getGraph = (folder: string, mode: GraphMode = 'all', crawl: string | null = null) =>
  api.get<LineageGraph>('/lineage/graph', { params: { folder, mode, crawl: crawl || undefined } }).then(r => r.data)

/** Where the fields of one table of a Power BI model (`model` = its id) come from and where they go. */
export const getColumnLineage = (folder: string, model: string, table: string, crawl: string | null = null) =>
  api.get<ColumnLineage>('/lineage/column-lineage', { params: { folder, model, table, crawl: crawl || undefined } }).then(r => r.data)
