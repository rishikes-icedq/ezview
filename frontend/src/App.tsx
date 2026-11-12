import { useState, useCallback, useEffect } from 'react'
import { Toaster } from 'sonner'
import Header from './components/layout/Header'
import FileBrowser from './components/explorer/FileBrowser'
import ActionBar from './components/explorer/ActionBar'
import TableViewer from './components/viewers/TableViewer'
import JsonViewer from './components/viewers/JsonViewer'
import TextViewer from './components/viewers/TextViewer'
import LineageAnalysis from './components/analysis/LineageAnalysis'
import MarkdownEditor from './components/markdown/MarkdownEditor'
import JsonFormatterTool from './components/tools/JsonFormatterTool'
import SqlFormatterTool from './components/tools/SqlFormatterTool'
import DiffTool from './components/tools/DiffTool'
import SnippetsTool from './components/tools/snippets/SnippetsTool'
import ColResizeHandle from './components/shared/ColResizeHandle'
import SidebarToggle from './components/layout/SidebarToggle'
import { useResizableColumns } from './hooks/useResizableColumns'
import { usePersistentBoolean } from './hooks/usePersistentBoolean'
import { useTheme } from './contexts/ThemeContext'
import type { FileDetection, ViewMode } from './types'
import { Eye } from 'lucide-react'

const SIDEBAR_INITIAL_WIDTH = 288
const SIDEBAR_MIN_WIDTH = 220
const SIDEBAR_MAX_WIDTH = 640

interface ActiveView {
  path: string
  action: ViewMode
  folder?: string
  label?: string
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-4 p-8">
      <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
        <Eye size={28} className="text-indigo-500 dark:text-indigo-400" />
      </div>
      <div>
        <div className="text-slate-800 dark:text-slate-200 text-lg font-semibold mb-1">EZView</div>
        <div className="text-slate-500 text-sm max-w-xs">
          Browse files in the left panel, select a file, choose an action, then click <span className="text-indigo-600 dark:text-indigo-400">Open</span>.
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs mt-2">
        {[
          ['🗄️ Parquet', 'Table view, JSON export, Lineage analysis'],
          ['📋 JSON', 'Formatted, collapsible, color-coded'],
          ['📝 Markdown', 'Edit with toolbar + live preview'],
          ['📄 Text', 'Syntax-highlighted plain text'],
        ].map(([type, desc]) => (
          <div key={type} className="bg-slate-100/60 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-left">
            <div className="text-slate-700 dark:text-slate-300 mb-0.5">{type}</div>
            <div className="text-slate-500">{desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function App() {
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<ActiveView | null>(null)
  const [activeTool, setActiveTool] = useState<string | null>(null)
  const { widths: [sidebarWidth], startResize } = useResizableColumns(
    [SIDEBAR_INITIAL_WIDTH], SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH,
  )
  const { theme } = useTheme()
  // Collapsed sidebar is remembered between visits. While it is being dragged wider or narrower the width animation
  // is switched off, or the panel would trail the mouse.
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistentBoolean('ezview.sidebarCollapsed', false)
  const [resizing, setResizing] = useState(false)
  // The lineage graph fills the whole window (header, sidebar and the rest of the lineage view are hidden).
  const [lineageMaximized, setLineageMaximized] = useState(false)

  // Ctrl/Cmd + \ toggles the sidebar (as in Notion). Not Ctrl+B: the Markdown editor uses that for bold.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '\\' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return
      e.preventDefault()
      setSidebarCollapsed(c => !c)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setSidebarCollapsed])

  const handleSelect = useCallback((path: string, type: 'file' | 'directory') => {
    setSelectedPath(path)
    setActiveTool(null)
    // Auto-clear the content pane when navigating away
    if (activeView && activeView.path !== path) {
      // keep pane until user explicitly opens something new
    }
  }, [activeView])

  const handleOpen = useCallback((detection: FileDetection, action: ViewMode) => {
    const folder = detection.lineage_bundle?.folder ?? detection.path
    setActiveTool(null)
    setActiveView({
      path: detection.path,
      action,
      folder,
      label: detection.name,
    })
  }, [])

  const handleClear = () => {
    setSelectedPath(null)
    setActiveView(null)
  }

  const renderContent = () => {
    if (activeTool === 'json_formatter') return <JsonFormatterTool />
    if (activeTool === 'sql_formatter') return <SqlFormatterTool />
    if (activeTool === 'diff_tool') return <DiffTool />
    if (activeTool === 'snippets') return <SnippetsTool />
    if (!activeView) return <EmptyState />
    const { path, action, folder, label } = activeView

    switch (action) {
      case 'view_table':
        return <TableViewer path={path} />
      case 'convert_to_json':
        return <JsonViewer path={path} source="parquet" />
      case 'view_json':
        return <JsonViewer path={path} />
      case 'analyze_lineage':
        return <LineageAnalysis folder={folder!} label={label} maximized={lineageMaximized} onMaximizedChange={setLineageMaximized} />
      case 'edit_markdown':
        return <MarkdownEditor path={path} />
      case 'view_text':
        return <TextViewer path={path} />
      default:
        return <EmptyState />
    }
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Toaster position="top-right" theme={theme} />
      {/* Hidden (not unmounted) while the lineage is maximized; `contents` keeps the layout identical otherwise. */}
      <div className={lineageMaximized ? 'hidden' : 'contents'}>
        <Header
          selectedPath={selectedPath}
          onClear={handleClear}
          activeTool={activeTool}
          onSelectTool={setActiveTool}
          onCloseTool={() => setActiveTool(null)}
        />
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar. Collapsing animates its width to 0 but keeps it mounted, so the file tree keeps its state; the inner
            panel keeps its width while the outer one shrinks, so its contents are clipped instead of re-wrapping. */}
        <div className={`relative shrink-0 ${lineageMaximized ? 'hidden' : 'flex'}`}>
          <aside
            id="app-sidebar"
            aria-label="File explorer"
            style={{ width: sidebarCollapsed ? 0 : sidebarWidth }}
            className={`flex flex-col overflow-hidden bg-white dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800
              ${resizing ? '' : 'transition-[width] duration-200 ease-out motion-reduce:transition-none'}`}
          >
            {/* `invisible` (applied once the animation ends) also takes the hidden controls out of the tab order. */}
            <div
              style={{ width: sidebarWidth - 1 }}
              className={`relative flex-1 min-h-0 flex flex-col transition-[visibility] duration-200 motion-reduce:transition-none ${sidebarCollapsed ? 'invisible' : ''}`}
            >
              <div className="flex-1 min-h-0">
                <FileBrowser onSelect={handleSelect} selectedPath={selectedPath} />
              </div>
              <ActionBar selectedPath={selectedPath} onOpen={handleOpen} />
              <ColResizeHandle
                onMouseDown={e => {
                  setResizing(true)
                  window.addEventListener('mouseup', () => setResizing(false), { once: true })
                  startResize(0)(e)
                }}
              />
            </div>
          </aside>
          <SidebarToggle collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(c => !c)} controls="app-sidebar" />
        </div>

        {/* Content pane */}
        <div className="flex-1 min-w-0 bg-slate-50 dark:bg-slate-900 overflow-hidden">
          {renderContent()}
        </div>
      </div>
    </div>
  )
}
