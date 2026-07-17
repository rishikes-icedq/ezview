import { useEffect, useRef, useState } from 'react'
import { Eye, Wrench, X, Braces, Code2, FileDiff, Sun, Moon } from 'lucide-react'
import { useTheme } from '../../contexts/ThemeContext'

export interface ToolDef {
  id: string
  label: string
  icon: React.ReactNode
}

export const TOOLS: ToolDef[] = [
  { id: 'json_formatter', label: 'JSON Formatter', icon: <Braces size={13} /> },
  { id: 'sql_formatter', label: 'SQL Formatter', icon: <Code2 size={13} /> },
  { id: 'diff_tool', label: 'Diff / Compare', icon: <FileDiff size={13} /> },
]

interface Props {
  selectedPath: string | null
  onClear: () => void
  activeTool: string | null
  onSelectTool: (id: string) => void
  onCloseTool: () => void
}

export default function Header({ selectedPath, onClear, activeTool, onSelectTool, onCloseTool }: Props) {
  const filename = selectedPath ? selectedPath.split(/[\\/]/).pop() : null
  const activeToolDef = TOOLS.find(t => t.id === activeTool) ?? null
  const { theme, toggleTheme } = useTheme()

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [menuOpen])

  return (
    <header className="flex items-center gap-3 px-5 py-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shrink-0">
      <div className="flex items-center gap-2 text-indigo-500 dark:text-indigo-400 font-semibold tracking-wide select-none">
        <Eye size={18} />
        <span className="text-slate-900 dark:text-white text-lg font-bold">EZView</span>
      </div>

      <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1" />

      {filename ? (
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-slate-500 dark:text-slate-400 text-sm truncate max-w-xl font-mono">{selectedPath}</span>
          <button
            onClick={onClear}
            className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 text-xs px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 transition-colors shrink-0"
          >
            Clear
          </button>
        </div>
      ) : !activeToolDef ? (
        <span className="text-slate-400 dark:text-slate-500 text-sm italic">Select a file or folder to begin</span>
      ) : null}

      <div className="ml-auto flex items-center gap-2 shrink-0">
        {activeToolDef && (
          <div className="flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-900/40 border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 text-xs px-2.5 py-1 rounded">
            {activeToolDef.icon}
            {activeToolDef.label}
            <button onClick={onCloseTool} className="hover:text-indigo-900 dark:hover:text-white transition-colors">
              <X size={12} />
            </button>
          </div>
        )}

        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          className="flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 border border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 p-1.5 rounded transition-colors"
        >
          {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
        </button>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(o => !o)}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border transition-colors
              ${menuOpen
                ? 'text-slate-900 dark:text-white border-slate-400 dark:border-slate-500 bg-slate-100 dark:bg-slate-800'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500'}`}
          >
            <Wrench size={13} /> Tools
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-1 w-48 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded shadow-lg z-20 py-1">
              {TOOLS.map(t => (
                <button
                  key={t.id}
                  onClick={() => { onSelectTool(t.id); setMenuOpen(false) }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors
                    ${t.id === activeTool
                      ? 'text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-700'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white'}`}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
