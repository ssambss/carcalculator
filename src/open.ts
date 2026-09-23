import { useState } from 'react'

const OPEN_KEY = 'carcalculator.open'

function readAll(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}')
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * Whether a folding section is open. Device-local like the theme and the
 * mode, not synced: one person reads the loan card on a laptop and wants it
 * shut on the phone. Every section shares one stored map, keyed by `key`.
 */
export function useOpen(key: string, fallback = false): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    const saved = readAll()[key]
    return typeof saved === 'boolean' ? saved : fallback
  })

  function toggle() {
    const next = !open
    setOpen(next)
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify({ ...readAll(), [key]: next }))
    } catch {
      // fine — it still folds for this session
    }
  }

  return [open, toggle]
}
