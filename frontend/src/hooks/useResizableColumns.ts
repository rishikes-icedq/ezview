import { useCallback, useRef, useState } from 'react'

/**
 * Manages drag-to-resize column widths for plain HTML tables (no table
 * library). Widths are session-only state, reset on remount.
 */
export function useResizableColumns(initial: number[], min = 60, max = Infinity) {
  const [widths, setWidths] = useState<number[]>(initial)
  const drag = useRef<{ index: number; startX: number; startWidth: number } | null>(null)

  const onMouseMove = useCallback((e: MouseEvent) => {
    const d = drag.current
    if (!d) return
    const delta = e.clientX - d.startX
    setWidths(w => {
      const next = [...w]
      next[d.index] = Math.min(max, Math.max(min, d.startWidth + delta))
      return next
    })
  }, [min, max])

  const stopDrag = useCallback(() => {
    drag.current = null
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', stopDrag)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [onMouseMove])

  const startResize = useCallback((index: number) => (e: React.MouseEvent) => {
    e.preventDefault()
    drag.current = { index, startX: e.clientX, startWidth: widths[index] }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', stopDrag)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [widths, onMouseMove, stopDrag])

  return { widths, startResize }
}

/**
 * The same drag-to-resize for a table whose columns are only known from the data it shows: each column is known by its
 * name and starts at `initial(name)`. Widths are session-only state; a column that is not resized needs none.
 */
export function useColumnWidths(initial: (name: string) => number, min = 60, max = Infinity) {
  const [resized, setResized] = useState<Record<string, number>>({})
  const drag = useRef<{ name: string; startX: number; startWidth: number } | null>(null)
  const widthOf = (name: string) => resized[name] ?? initial(name)

  const onMouseMove = useCallback((e: MouseEvent) => {
    const d = drag.current
    if (!d) return
    setResized(w => ({ ...w, [d.name]: Math.min(max, Math.max(min, d.startWidth + e.clientX - d.startX)) }))
  }, [min, max])

  const stopDrag = useCallback(() => {
    drag.current = null
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', stopDrag)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [onMouseMove])

  const startResize = (name: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    drag.current = { name, startX: e.clientX, startWidth: widthOf(name) }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', stopDrag)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  return { widthOf, startResize }
}
