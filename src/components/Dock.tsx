import type { UndoOffer } from '../undo'

/**
 * What sits at the bottom of the screen above the page: the undo for what was
 * just deleted, and the compare bar. Always mounted, so the status region is
 * there before the first message - a live region added with its text in it is
 * often not read out.
 */
export function UndoToast({
  offer,
  onUndo,
  onDismiss,
}: {
  offer: UndoOffer | null
  onUndo: () => void
  onDismiss: () => void
}) {
  return (
    <div className="dock-slot" role="status">
      {offer && (
        <div className="toast">
          <span className="toast-text">{offer.message}</span>
          <button className="toast-action" onClick={onUndo}>
            Undo
          </button>
          <button className="toast-close" aria-label="Dismiss" onClick={onDismiss}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M3 3l6 6M9 3l-6 6" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Two or more cards ticked is a comparison waiting to happen: this offers it,
 * so nobody has to find "Selected only" and then scroll to the table. On a
 * phone the table fits about one car column - narrowed to the ticked ones it
 * is the comparison actually wanted.
 */
export function CompareBar({
  count,
  comparing,
  onCompare,
  onShowAll,
  onClear,
}: {
  count: number
  /** "Selected only" is on */
  comparing: boolean
  onCompare: () => void
  onShowAll: () => void
  onClear: () => void
}) {
  if (!comparing && count < 2) return null
  return (
    <div className="toast compare-bar">
      {comparing ? (
        <>
          <span className="toast-text">Comparing {count} selected</span>
          <button className="toast-action" onClick={onShowAll}>
            Show all
          </button>
        </>
      ) : (
        <>
          <span className="toast-text">{count} selected</span>
          <button className="toast-action" onClick={onCompare}>
            Compare
          </button>
          <button className="toast-action quiet" onClick={onClear}>
            Clear
          </button>
        </>
      )}
    </div>
  )
}
