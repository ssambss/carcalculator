/**
 * What this device has picked to compare, per calculator.
 *
 * Selection is deliberately device-local (not synced): what one person picks
 * to compare shouldn't rearrange another device's view. Cars and places keep
 * separate keys — the two calculators are separate questions, and switching
 * between them should not clear either pick.
 */

export function loadSelection(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((x): x is string => typeof x === 'string'))
      }
    }
  } catch {
    // corrupt or unavailable — start unselected
  }
  return new Set()
}

export function saveSelection(key: string, ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]))
  } catch {
    // ignore
  }
}
