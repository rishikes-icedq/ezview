import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { getCatalog, getAsset } from '../../api/okf'
import { useResizableColumns } from '../../hooks/useResizableColumns'
import ColResizeHandle from '../shared/ColResizeHandle'
import CatalogTree from './okf/CatalogTree'
import CatalogOverview from './okf/CatalogOverview'
import AssetDetail from './okf/AssetDetail'
import type { OkfCatalog as OkfCatalogType, OkfAssetDetail } from '../../types'

interface Props { folder: string }

const TREE_INITIAL_WIDTH = 260
const TREE_MIN_WIDTH = 180
const TREE_MAX_WIDTH = 480

export default function OkfCatalog({ folder }: Props) {
  const [catalog, setCatalog] = useState<OkfCatalogType | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [asset, setAsset] = useState<OkfAssetDetail | null>(null)
  const [assetLoading, setAssetLoading] = useState(false)
  const { widths: [treeWidth], startResize } = useResizableColumns([TREE_INITIAL_WIDTH], TREE_MIN_WIDTH, TREE_MAX_WIDTH)

  useEffect(() => {
    setLoading(true)
    setError(null)
    setSelectedPath(null)
    setAsset(null)
    getCatalog(folder).then(setCatalog).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [folder])

  useEffect(() => {
    if (!selectedPath) { setAsset(null); return }
    setAssetLoading(true)
    getAsset(folder, selectedPath).then(setAsset).catch(e => setError(e.message)).finally(() => setAssetLoading(false))
  }, [folder, selectedPath])

  if (loading) return <div className="flex items-center gap-2 text-slate-500 py-4"><Loader2 size={16} className="animate-spin" /> Loading…</div>
  if (error) return <div className="px-3 py-2 bg-red-50 dark:bg-red-900/40 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 text-sm rounded">{error}</div>
  if (!catalog || !catalog.found) {
    return (
      <div className="text-slate-500 italic text-sm py-4">
        No OKF knowledge bundle found for this lineage folder. EZView looks for a sibling{' '}
        <code className="font-mono not-italic">okf-bundle*/conn-&lt;id&gt;</code> folder next to the lineage data.
      </div>
    )
  }

  return (
    <div className="flex h-full border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
      <div style={{ width: treeWidth }} className="relative shrink-0 border-r border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30">
        <CatalogTree databases={catalog.databases ?? []} selectedPath={selectedPath} onSelect={setSelectedPath} />
        <ColResizeHandle onMouseDown={startResize(0)} />
      </div>
      <div className="flex-1 min-w-0 overflow-y-auto p-5">
        {assetLoading ? (
          <div className="flex items-center gap-2 text-slate-500 py-4"><Loader2 size={16} className="animate-spin" /> Loading asset…</div>
        ) : asset ? (
          <AssetDetail asset={asset} onNavigate={setSelectedPath} />
        ) : (
          <CatalogOverview catalog={catalog} />
        )}
      </div>
    </div>
  )
}
