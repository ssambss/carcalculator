/**
 * The JSON backup: an exact copy of all three calculators, for keeping or
 * restoring.
 *
 * The car data sits at the top level, exactly where a backup has always had it,
 * and housing and mileage ride beside it under a key each - so a backup from
 * before either existed still reads, and an older copy of the app handed a new
 * backup reads its cars and ignores the rest (`normalizeData` drops keys it does
 * not know).
 *
 * Its own module rather than a pair of functions in `storage.ts`: the housing
 * side's storage imports the gist code, which imports `storage.ts`, and the
 * backup needs both.
 */

import type { AppData } from './types'
import { normalizeData } from './storage'
import { type HousingData, normalizeHousing } from './housingStorage'
import { type MileageData, normalizeMileage } from './mileageStorage'

export interface Backup {
  data: AppData
  /** null for a backup written before housing was in it - nothing to restore */
  housing: HousingData | null
  /** null for a backup written before mileage was in it - likewise */
  mileage: MileageData | null
}

export function backupJson(data: AppData, housing: HousingData, mileage: MileageData): string {
  return JSON.stringify({ ...data, housing, mileage }, null, 2)
}

/** One section of the file, normalised - or null when the file predates it. */
function section<T>(raw: unknown, key: string, normalize: (v: unknown) => T): T | null {
  return typeof raw === 'object' && raw !== null && key in raw
    ? normalize((raw as Record<string, unknown>)[key])
    : null
}

export function parseBackup(text: string): Backup {
  const raw: unknown = JSON.parse(text)
  return {
    data: normalizeData(raw),
    housing: section(raw, 'housing', normalizeHousing),
    mileage: section(raw, 'mileage', normalizeMileage),
  }
}

export function exportBackup(data: AppData, housing: HousingData, mileage: MileageData): void {
  const blob = new Blob([backupJson(data, housing, mileage)], { type: 'application/json' })
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
