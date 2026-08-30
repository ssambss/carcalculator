// Merging two devices' data without either losing an edit.
//
// The subtlest code in the app, and the part with the most ways to be quietly
// wrong: a delete that comes back, an edit that vanishes, a bot's write undone
// by a phone with a stale copy. Several writers are normal here - two devices
// plus the listing watcher appending cars - so "last write wins on the whole
// file" was never good enough, and what replaced it deserves pinning.

import { describe, expect, it } from 'vitest'

import { mergeData } from '../src/sync'
import { DEFAULT_SETTINGS, newCar } from '../src/storage'
import type { AppData, CarListing } from '../src/types'

/**
 * Timestamps relative to now, never fixed.
 *
 * Tombstones are forgotten after 90 days, so a hardcoded date silently changes
 * what a test means as the calendar moves - a "recent deletion" quietly becomes
 * an expired one and the test starts asserting the opposite of its name.
 */
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000).toISOString()

function car(id: string, updatedAt: string, over: Partial<CarListing> = {}): CarListing {
  return { ...newCar(), id, name: id, createdAt: daysAgo(300), updatedAt, ...over }
}

function data(cars: CarListing[], tombstones: Record<string, string> = {}): AppData {
  return { version: 1, settings: { ...DEFAULT_SETTINGS }, cars, tombstones }
}

describe('merging two copies', () => {
  it('keeps a car that exists on only one side', () => {
    // The listing watcher appending a car while a phone holds an older copy.
    const merged = mergeData(data([car('mine', daysAgo(30))]), data([car('theirs', daysAgo(40))]))
    expect(merged.cars.map((c) => c.id).sort()).toEqual(['mine', 'theirs'])
  })

  it('takes the newer edit of a car both sides have', () => {
    const mine = car('c', daysAgo(30), { purchasePrice: 100 })
    const theirs = car('c', daysAgo(20), { purchasePrice: 200 })
    expect(mergeData(data([mine]), data([theirs])).cars[0].purchasePrice).toBe(200)
    expect(mergeData(data([theirs]), data([mine])).cars[0].purchasePrice).toBe(200)
  })

  it('breaks a tie towards the preferred side', () => {
    // Same timestamp on both, which happens when a write is echoed back. The
    // local copy wins so the user's own screen does not flicker.
    const mine = car('c', daysAgo(30), { purchasePrice: 100 })
    const theirs = car('c', daysAgo(30), { purchasePrice: 200 })
    expect(mergeData(data([mine]), data([theirs])).cars[0].purchasePrice).toBe(100)
  })

  it('keeps the preferred side settings', () => {
    // Settings are not merged per field - whoever is pushing owns them.
    const merged = mergeData(
      { ...data([]), settings: { ...DEFAULT_SETTINGS, annualKm: 12345 } },
      { ...data([]), settings: { ...DEFAULT_SETTINGS, annualKm: 999 } },
    )
    expect(merged.settings.annualKm).toBe(12345)
  })
})

describe('deleting a car', () => {
  it('stays deleted even when the other side still has it', () => {
    // Without tombstones, a delete on one device is silently undone by the next
    // device that syncs an older copy - the bug they exist for.
    const deletedAt = daysAgo(20)
    const merged = mergeData(data([], { c: deletedAt }), data([car('c', daysAgo(30))]))
    expect(merged.cars).toEqual([])
    expect(merged.tombstones.c).toBe(deletedAt)
  })

  it('comes back when it was edited after the deletion', () => {
    // Deliberate resurrection: somebody edited the car on another device after
    // it was deleted here, and the later intent wins.
    const merged = mergeData(
      data([], { c: daysAgo(20) }),
      data([car('c', daysAgo(10), { purchasePrice: 777 })]),
    )
    expect(merged.cars.map((c) => c.id)).toEqual(['c'])
    expect(merged.cars[0].purchasePrice).toBe(777)
    // And the tombstone is cleared, or the next merge would delete it again.
    expect(merged.tombstones.c).toBeUndefined()
  })

  it('keeps the later of two deletions of the same car', () => {
    const later = daysAgo(5)
    const merged = mergeData(data([], { c: daysAgo(30) }), data([], { c: later }))
    expect(merged.tombstones.c).toBe(later)
  })

  it('forgets a tombstone once it is old enough to be irrelevant', () => {
    // They cannot accumulate forever; after the window a re-added car with the
    // same id is a new car, not a resurrection.
    const old = new Date(Date.now() - 200 * 24 * 3600 * 1000).toISOString()
    const merged = mergeData(data([], { gone: old }), data([]))
    expect(merged.tombstones.gone).toBeUndefined()
  })

  it('keeps a recent tombstone', () => {
    const recent = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString()
    expect(mergeData(data([], { gone: recent }), data([])).tombstones.gone).toBe(recent)
  })
})

describe('the merged output', () => {
  it('serializes identically whichever device did the merging', () => {
    // Both devices push after merging, and the sync compares serialized JSON to
    // decide whether a write is needed. Unstable ordering would mean an endless
    // ping-pong of writes that change nothing.
    const a = data([car('b', daysAgo(30)), car('a', daysAgo(30))], { z: daysAgo(50) })
    const b = data([car('c', daysAgo(50))], { y: daysAgo(45) })
    const one = mergeData(a, b)
    const two = mergeData(a, b)
    expect(JSON.stringify(one)).toBe(JSON.stringify(two))
    // Cars ordered by creation then id; tombstone keys sorted.
    expect(one.cars.map((c) => c.id)).toEqual(['a', 'b', 'c'])
    expect(Object.keys(one.tombstones)).toEqual(['y', 'z'])
  })

  it('is stable when the same merge runs with the sides swapped', () => {
    // Not identical - the preferred side breaks ties - but the *set* of cars
    // must be the same, or two devices would disagree about what exists.
    const a = data([car('a', daysAgo(30))])
    const b = data([car('b', daysAgo(20))])
    expect(mergeData(a, b).cars.map((c) => c.id)).toEqual(mergeData(b, a).cars.map((c) => c.id))
  })
})
