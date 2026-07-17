import api from './client'
import type { ParquetSchema, ParquetPage } from '../types'

export const getSchema = (path: string) =>
  api.get<ParquetSchema>('/parquet/schema', { params: { path } }).then(r => r.data)

export const getRows = (path: string, page = 1, pageSize = 100) =>
  api.get<ParquetPage>('/parquet/rows', { params: { path, page, page_size: pageSize } }).then(r => r.data)

export const getAsJson = (path: string) =>
  api.get<unknown[]>('/parquet/as-json', { params: { path } }).then(r => r.data)

export const downloadUrl = (path: string, format: 'json' | 'parquet') =>
  `/api/parquet/download?path=${encodeURIComponent(path)}&format=${format}`
