import { useEffect, useState } from 'react'

export type Mode = 'cars' | 'housing'

const MODE_KEY = 'carcalculator.mode'

/**
 * Which calculator this device is looking at. Device-local like the theme,
 * not synced: two people sharing a gist can be on different questions.
 */
export function useMode(): [Mode, (m: Mode) => void] {
  const [mode, setMode] = useState<Mode>(() => {
    try {
      const saved = localStorage.getItem(MODE_KEY)
      if (saved === 'cars' || saved === 'housing') return saved
    } catch {
      // storage unavailable — start on cars
    }
    return 'cars'
  })

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode)
    } catch {
      // fine — the toggle still works for this session
    }
  }, [mode])

  return [mode, setMode]
}
