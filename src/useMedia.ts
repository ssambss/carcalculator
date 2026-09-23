import { useCallback, useSyncExternalStore } from 'react'

/**
 * Whether a media query matches, following it as the window resizes.
 *
 * For the few places where a phone gets different markup rather than
 * different styling - a menu that holds what the desktop shows as buttons -
 * so each width's accessible names are its own instead of CSS hiding half.
 */
export function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches)
}

/** The phone layout's breakpoint - the one index.css uses. */
export const NARROW = '(max-width: 640px)'
