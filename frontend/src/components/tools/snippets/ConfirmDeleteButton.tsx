import { useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'

interface Props {
  onConfirm: () => void
  title?: string
  size?: number
}

export default function ConfirmDeleteButton({ onConfirm, title = 'Delete', size = 12 }: Props) {
  const [confirming, setConfirming] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const handleClick = () => {
    if (confirming) {
      if (timer.current) clearTimeout(timer.current)
      setConfirming(false)
      onConfirm()
      return
    }
    setConfirming(true)
    timer.current = setTimeout(() => setConfirming(false), 3000)
  }

  return (
    <button
      onClick={handleClick}
      title={confirming ? 'Click again to confirm delete' : title}
      className={confirming
        ? 'p-1 rounded text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/40'
        : 'p-1 rounded text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors'}
    >
      <Trash2 size={size} />
    </button>
  )
}
