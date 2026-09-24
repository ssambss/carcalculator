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
 *
 * A file that is not a backup is refused before anything is asked. Read as one
 * it would be a backup with no cars - every key it lacks falls back to a
 * default - and the confirm would offer to empty the calculator and reset its
 * assumptions, one click from happening.
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

/** Why a file was refused, in words for the person who picked it. Nothing was changed. */
export class NotABackupError extends Error {}

const NOT_A_BACKUP = 'That file is not a backup from this app, so nothing was changed.'
const DATA_PACKAGE =
  'That is a vehicle data package from the VW Group data portal, not a backup from ' +
  'this app, so nothing was changed.'
const ZIP_FILE =
  'That is a ZIP file — the VW Group portal’s data packages come as ZIPs — and ' +
  'Import reads only this app’s own backups and spreadsheets, so nothing was changed.'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Whether a parsed file is one of this app's backups. The test is the car
 * list at the top level rather than a version number: every backup ever
 * written has had it, from the first one, which had nothing else but the
 * version and the settings.
 */
function isBackup(raw: unknown): boolean {
  return isRecord(raw) && Array.isArray(raw.cars)
}

/** The portal's package: a VIN and a list of data points, and no cars. */
function isDataPackage(raw: unknown): boolean {
  return isRecord(raw) && typeof raw.vin === 'string' && Array.isArray(raw.Data)
}

/** One section of the file, normalised - or null when the file predates it. */
function section<T>(raw: unknown, key: string, normalize: (v: unknown) => T): T | null {
  return typeof raw === 'object' && raw !== null && key in raw
    ? normalize((raw as Record<string, unknown>)[key])
    : null
}

export function parseBackup(text: string): Backup {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new NotABackupError(NOT_A_BACKUP)
  }
  if (!isBackup(raw)) throw new NotABackupError(isDataPackage(raw) ? DATA_PACKAGE : NOT_A_BACKUP)
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
  // Said before reading it: a ZIP's bytes would only fail as unreadable JSON.
  if (/\.zip$/i.test(file.name)) throw new NotABackupError(ZIP_FILE)
  return parseBackup(await file.text())
}
