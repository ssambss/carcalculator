import { useEffect, useRef, useState, type RefObject } from 'react'

/**
 * The rendered width of an element, so SVG text stays at CSS pixel size.
 * Shared by every hand-rolled chart; its own file so the chart components
 * export nothing but components.
 */
export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // ResizeObserver reports once on observe, so the first size arrives
    // without a synchronous read here.
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}
