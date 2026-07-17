interface Props {
  onMouseDown: (e: React.MouseEvent) => void
  onTouchStart?: (e: React.TouchEvent) => void
  active?: boolean
}

/** Drag handle for a resizable column; parent <th> must be `position: relative`. */
export default function ColResizeHandle({ onMouseDown, onTouchStart, active }: Props) {
  return (
    <div
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      className={`absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none transition-colors ${active ? 'bg-indigo-500/70' : 'hover:bg-indigo-500/50'}`}
    />
  )
}
