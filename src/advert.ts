const URL_RE = /https?:\/\/[^\s<>"']+/i

export interface Advert {
  url: string
  /** "nettiauto.com", for the link's title */
  host: string
  /** the notes left to show, without a line that was only this address */
  notes: string
}

/**
 * The listing a car came from: the first web address in its notes.
 *
 * Read out of the notes rather than kept in a field of its own. The watcher
 * already writes the nettiauto link as the notes' first line, one pasted in by
 * hand works the same, and a new field in the car data would be stripped by a
 * device still on an older cached bundle the next time it saved.
 */
export function advertOf(notes: string): Advert | null {
  const match = URL_RE.exec(notes)
  if (!match) return null
  // Prose around a link ends it with punctuation that is not part of it.
  const raw = match[0].replace(/[.,;:!?)\]]+$/, '')
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  const rest = notes
    .split('\n')
    .filter((line) => line.trim() !== raw)
    .join('\n')
    .trim()
  return { url: parsed.href, host: parsed.hostname.replace(/^www\./, ''), notes: rest }
}
