// Saving an item again drops its tombstone - what an undone delete relies on.

import { describe, expect, it } from 'vitest'

import { untombstone } from '../src/tombstones'

describe('untombstone', () => {
  it('drops the one id, and leaves the others', () => {
    const tombstones = { a: '2026-10-01T10:00:00.000Z', b: '2026-10-02T10:00:00.000Z' }
    expect(untombstone(tombstones, 'a')).toEqual({ b: '2026-10-02T10:00:00.000Z' })
    expect(tombstones).toHaveProperty('a') // not mutated
  })

  it('hands back the same object when there is nothing to drop', () => {
    const tombstones = { a: '2026-10-01T10:00:00.000Z' }
    expect(untombstone(tombstones, 'z')).toBe(tombstones)
  })
})
