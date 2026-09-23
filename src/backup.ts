/**
 * The JSON backup: an exact copy of both calculators, for keeping or restoring.
 *
 * The car data sits at the top level, exactly where a backup has always had it,
 * and housing rides beside it under `housing` - so a backup from before housing
 * existed still reads, and an older copy of the app handed a new backup reads
 * its cars and ignores the rest (`normalizeData` drops keys it does not know).
 *
 * Its own module rather than a pair of functions in `storage.ts`: the housing
 * side's storage imports the gist code, which imports `storage.ts`, and the
 * backup needs both.
 */

import type { AppData } from './types'
import { normalizeData } from './storage'
import { type HousingData, normalizeHousing } from './housingStorage'

export interface Backup {
  data: AppData
  /** null for a backup written before housing was in it - nothing to restore */
  housing: HousingData | null
}

export function backupJson(data: AppData, housing: HousingData): string {
  return JSON.stringify({ ...data, housing }, null, 2)
}

export function parseBackup(text: string): Backup {
  const raw: unknown = JSON.parse(text)
  const housing =
    typeof raw === 'object' && raw !== null && 'housing' in raw
      ? normalizeHousing((raw as { housing: unknown }).housing)
      : null
  return { data: normalizeData(raw), housing }
}

export function exportBackup(data: AppData, housing: HousingData): void {
  const blob = new Blob([backupJson(data, housing)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `car-tco-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export async function importBackup(file: File): Promise<Backup> {
  return parseBackup(await file.text())
}
