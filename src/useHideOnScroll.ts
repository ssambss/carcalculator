import { useEffect, useState } from 'react'

/** How far the page has to move before it counts as a direction. */
const SLACK_PX = 6

/**
 * Whether a floating control should step aside: while the page is scrolled
 * down, and back on the way up or near either end. A fixed button otherwise
 * sits on whatever passes under it - the bar and figures of a card, mostly.
 * The bottom padding was already enough for the end of the page to clear it.
 */
export function useHideOnScroll(enabled: boolean): boolean {
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let last = window.scrollY
    let frame = 0
    function onScroll() {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const y = window.scrollY
        const nearEnd =
          window.innerHeight + y >= document.documentElement.scrollHeight - SLACK_PX * 4
        if (y < 80 || nearEnd) setHidden(false)
        else if (y > last + SLACK_PX) setHidden(true)
        else if (y < last - SLACK_PX) setHidden(false)
        // A slow scroll adds up rather than resetting every frame.
        else return
        last = y
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [enabled])

  return enabled && hidden
}
