import { ChevronLeft, ChevronRight } from 'lucide-react'

interface Props {
  collapsed: boolean
  onToggle: () => void
  /** id of the panel this button shows and hides. */
  controls: string
}

/**
 * Collapse / expand tab for the sidebar. It sits on the sidebar's right edge, halfway down, straddling the divider
 * line. Collapsed, the sidebar has no width left to straddle, so the tab sits flush against the window's left edge.
 * It belongs to the sidebar's wrapper (not the sidebar itself), so it stays on screen while the sidebar is hidden.
 */
export default function SidebarToggle({ collapsed, onToggle, controls }: Props) {
  const Icon = collapsed ? ChevronRight : ChevronLeft
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar'
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      aria-expanded={!collapsed}
      aria-controls={controls}
      title={`${label} (Ctrl+\\)`}
      data-testid="sidebar-toggle"
      className={`absolute top-1/2 -translate-y-1/2 z-30 flex items-center justify-center w-5 h-10 border border-slate-300 dark:border-slate-700
        bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 shadow-sm transition-colors
        hover:text-indigo-600 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-slate-800 hover:border-indigo-300 dark:hover:border-indigo-600
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500
        ${collapsed ? 'left-0 rounded-r-full border-l-0' : 'right-0 translate-x-1/2 rounded-full'}`}
    >
      <Icon size={14} strokeWidth={2.25} />
    </button>
  )
}
