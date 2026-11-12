import { useCallback, useState } from 'react'

/**
 * A boolean kept in localStorage, for per-user conveniences such as "sidebar collapsed". Storage can be blocked
 * or throw (private windows, site data cleared), so every access is guarded and the state works without it.
 */
export function usePersistentBoolean(key: string, initial: boolean) {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const stored = window.localStorage.getItem(key)
      return stored === null ? initial : stored === '1'
    } catch {
      return initial
    }
  })

  const update = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    setValue(prev => {
      const resolved = typeof next === 'function' ? next(prev) : next
      try {
        window.localStorage.setItem(key, resolved ? '1' : '0')
      } catch {
        /* not persisted; the state still works for this session */
      }
      return resolved
    })
  }, [key])

  return [value, update] as const
}
