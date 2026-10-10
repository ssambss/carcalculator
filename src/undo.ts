import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

/** A delete that has already happened, and how to take it back. */
export interface UndoOffer {
  message: string
  undo: () => void
}

export interface UndoController {
  current: UndoOffer | null
  offer: (o: UndoOffer) => void
  /** run the current offer's undo and close it */
  take: () => void
  dismiss: () => void
}

/** How long the Undo stays on offer. Long enough to read it and reach for it. */
export const UNDO_MS = 7000

const NONE: UndoController = { current: null, offer: () => {}, take: () => {}, dismiss: () => {} }

export const UndoContext = createContext<UndoController>(NONE)

/** Offer an undo for something just deleted - in place of asking first. */
export function useUndo(): (o: UndoOffer) => void {
  return useContext(UndoContext).offer
}

/** The whole controller, for whatever shows the offer. */
export function useUndoControls(): UndoController {
  return useContext(UndoContext)
}

/**
 * One offer at a time. A second delete replaces the first offer, and the
 * first delete simply stands - it was applied when it was made, so there is
 * nothing left to commit.
 */
export function useUndoController(): UndoController {
  const [current, setCurrent] = useState<UndoOffer | null>(null)
  // The undo runs from here rather than inside a state updater, which React
  // may call twice.
  const currentRef = useRef<UndoOffer | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    currentRef.current = null
    setCurrent(null)
  }, [])

  const offer = useCallback(
    (o: UndoOffer) => {
      dismiss()
      currentRef.current = o
      setCurrent(o)
      timer.current = setTimeout(dismiss, UNDO_MS)
    },
    [dismiss],
  )

  const take = useCallback(() => {
    const o = currentRef.current
    dismiss()
    o?.undo()
  }, [dismiss])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  return useMemo(() => ({ current, offer, take, dismiss }), [current, offer, take, dismiss])
}
