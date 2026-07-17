import { useState, useEffect, useCallback } from 'react'
import {
  Folder, FolderOpen, FileJson, FileText, Database, ChevronRight,
  ChevronDown, HardDrive, Home, RefreshCw, FolderSearch, FileSearch,
} from 'lucide-react'
import { getRoots, listDir, pickPath } from '../../api/browser'
import type { FileEntry } from '../../types'
import { formatBytes } from '../../utils/format'

interface TreeNode {
  entry: FileEntry
  children: TreeNode[] | null  // null = not loaded yet
  expanded: boolean
}

interface Props {
  onSelect: (path: string, type: 'file' | 'directory') => void
  selectedPath: string | null
}

function fileIcon(entry: FileEntry) {
  if (entry.type === 'directory') return null
  const ext = entry.extension ?? ''
  if (ext === '.parquet') return <Database size={14} className="text-amber-600 dark:text-amber-400 shrink-0" />
  if (ext === '.json') return <FileJson size={14} className="text-blue-600 dark:text-blue-400 shrink-0" />
  if (ext === '.md' || ext === '.markdown') return <FileText size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
  return <FileText size={14} className="text-slate-500 dark:text-slate-400 shrink-0" />
}

export default function FileBrowser({ onSelect, selectedPath }: Props) {
  const [roots, setRoots] = useState<{ label: string; path: string }[]>([])
  const [customRoot, setCustomRoot] = useState<{ label: string; path: string } | null>(null)
  const [currentRoot, setCurrentRoot] = useState<string>('')
  const [tree, setTree] = useState<TreeNode[]>([])
  const [loading, setLoading] = useState(false)
  const [picking, setPicking] = useState(false)

  const displayRoots = customRoot
    ? [customRoot, ...roots.filter(r => r.path !== customRoot.path)]
    : roots

  const loadRoots = useCallback(async () => {
    try {
      const r = await getRoots()
      setRoots(r)
      if (r.length > 0 && !currentRoot) setCurrentRoot(r[0].path)
    } catch { /* ignore */ }
  }, [currentRoot])

  useEffect(() => { loadRoots() }, [])

  const loadDir = useCallback(async (path: string): Promise<TreeNode[]> => {
    const result = await listDir(path)
    return result.entries.map(e => ({ entry: e, children: null, expanded: false }))
  }, [])

  useEffect(() => {
    if (!currentRoot) return
    setLoading(true)
    loadDir(currentRoot).then(nodes => {
      setTree(nodes)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [currentRoot, loadDir])

  const toggleNode = useCallback(async (path: string) => {
    const expand = async (nodes: TreeNode[]): Promise<TreeNode[]> => {
      return Promise.all(nodes.map(async (n) => {
        if (n.entry.path === path) {
          if (n.entry.type === 'file') return n
          if (!n.expanded) {
            const children = n.children ?? await loadDir(path)
            return { ...n, expanded: true, children }
          }
          return { ...n, expanded: false }
        }
        if (n.children) return { ...n, children: await expand(n.children) }
        return n
      }))
    }
    setTree(await expand(tree))
  }, [tree, loadDir])

  const browseFolder = async () => {
    setPicking(true)
    try {
      const { path } = await pickPath('folder')
      if (!path) return
      setCustomRoot({ label: path.split(/[\\/]/).pop() || path, path })
      setCurrentRoot(path)
      onSelect(path, 'directory')
    } catch {
      /* dialog failed or was cancelled */
    } finally {
      setPicking(false)
    }
  }

  const browseFile = async () => {
    setPicking(true)
    try {
      const { path } = await pickPath('file')
      if (!path) return
      onSelect(path, 'file')
    } catch {
      /* dialog failed or was cancelled */
    } finally {
      setPicking(false)
    }
  }

  const renderNodes = (nodes: TreeNode[], depth = 0): React.ReactNode => {
    return nodes.map(n => {
      const isDir = n.entry.type === 'directory'
      const isSelected = selectedPath === n.entry.path
      const indent = depth * 14

      return (
        <div key={n.entry.path}>
          <div
            className={`flex items-center gap-1.5 py-[3px] pr-2 cursor-pointer rounded-sm text-sm transition-colors
              ${isSelected
                ? 'bg-indigo-100 dark:bg-indigo-600/30 text-indigo-700 dark:text-indigo-200'
                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'}`}
            style={{ paddingLeft: `${8 + indent}px` }}
            onClick={() => {
              if (isDir) toggleNode(n.entry.path)
              onSelect(n.entry.path, n.entry.type)
            }}
          >
            {isDir ? (
              <>
                <span className="text-slate-400 dark:text-slate-500 shrink-0">
                  {n.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </span>
                {n.expanded
                  ? <FolderOpen size={14} className="text-yellow-600 dark:text-yellow-400 shrink-0" />
                  : <Folder size={14} className="text-yellow-600 dark:text-yellow-400 shrink-0" />}
              </>
            ) : (
              <>
                <span className="w-3 shrink-0" />
                {fileIcon(n.entry)}
              </>
            )}
            <span className="truncate min-w-0">{n.entry.name}</span>
            {!isDir && n.entry.size !== null && (
              <span className="ml-auto text-xs text-slate-400 dark:text-slate-600 shrink-0">{formatBytes(n.entry.size)}</span>
            )}
          </div>
          {isDir && n.expanded && n.children && renderNodes(n.children, depth + 1)}
        </div>
      )
    })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Root selector */}
      <div className="flex items-center gap-1.5 px-2 py-2 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <select
          value={currentRoot}
          onChange={e => setCurrentRoot(e.target.value)}
          className="flex-1 min-w-0 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs rounded px-2 py-1.5 border border-slate-300 dark:border-slate-700 focus:outline-none focus:border-indigo-500"
        >
          {displayRoots.map(r => (
            <option key={r.path} value={r.path}>{r.label}</option>
          ))}
        </select>
        <button
          onClick={browseFolder}
          disabled={picking}
          title="Browse for a folder…"
          className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 disabled:opacity-40 p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors shrink-0"
        >
          <FolderSearch size={13} />
        </button>
        <button
          onClick={browseFile}
          disabled={picking}
          title="Browse for a file…"
          className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 disabled:opacity-40 p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors shrink-0"
        >
          <FileSearch size={13} />
        </button>
        <button
          onClick={() => { setTree([]); loadDir(currentRoot).then(setTree) }}
          title="Refresh"
          className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors shrink-0"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {loading ? (
          <div className="text-slate-500 text-xs px-4 py-3">Loading…</div>
        ) : tree.length === 0 ? (
          <div className="text-slate-400 dark:text-slate-600 text-xs px-4 py-3 italic">Empty folder</div>
        ) : (
          renderNodes(tree)
        )}
      </div>
    </div>
  )
}
