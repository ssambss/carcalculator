import type { ReactNode } from 'react'
import { useOpen } from '../open'

/**
 * Folding sections for the housing side, which grew one analysis at a time
 * until the places themselves sat six screens down.
 *
 * A folded card still answers its question: the line under its title is the
 * card's conclusion ("buying ends 212 573 € ahead"), not a description of it,
 * so shutting a card gives up the working and keeps the result. Open or shut
 * is remembered per device - see `useOpen`.
 */

/** The fold's marker: points right shut, down open (the turn is CSS, off aria-expanded). */
export function Chevron() {
  return (
    <svg
      className="fold-chevron"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 3.5l4.5 4.5L6 12.5" />
    </svg>
  )
}

/** An analysis card that folds to its title and its answer. */
export function FoldCard({
  id,
  title,
  caption,
  summary,
  actions,
  children,
}: {
  /** where the open state is remembered */
  id: string
  title: string
  /** what the card is about - beside the title while it is open */
  caption: string
  /** what the card concludes - under the title while it is shut */
  summary: ReactNode
  /** controls for the head that only mean something open, like Chart / Table */
  actions?: ReactNode
  children: ReactNode
}) {
  const [open, toggle] = useOpen(id)
  return (
    <div className={`card schedule-card fold-card${open ? ' open' : ''}`}>
      <div className="schedule-head">
        <button className="fold-toggle" aria-expanded={open} onClick={toggle}>
          <span className="fold-title">
            <Chevron />
            <span className="cmp-title display">{title}</span>
          </span>
          {open ? (
            <span className="cmp-caption">{caption}</span>
          ) : (
            <span className="fold-summary">{summary}</span>
          )}
        </button>
        {open && actions}
      </div>
      {open && children}
    </div>
  )
}

/** A part of a card that folds on its own - a long table, the notes on method. */
export function Fold({
  id,
  title,
  caption,
  children,
}: {
  id: string
  title: string
  caption?: string
  children: ReactNode
}) {
  const [open, toggle] = useOpen(id)
  return (
    <div className={`fold${open ? ' open' : ''}`}>
      <button className="fold-toggle fold-sub" aria-expanded={open} onClick={toggle}>
        <span className="fold-title">
          <Chevron />
          <span className="schedule-subtitle">{title}</span>
        </span>
        {caption && <span className="cmp-caption">{caption}</span>}
      </button>
      {open && children}
    </div>
  )
}
