import api from './client'
import type { OkfCatalog, OkfAssetDetail } from '../types'

export const getCatalog = (folder: string) =>
  api.get<OkfCatalog>('/okf/catalog', { params: { folder } }).then(r => r.data)

export const getAsset = (folder: string, path: string) =>
  api.get<OkfAssetDetail>('/okf/asset', { params: { folder, path } }).then(r => r.data)
