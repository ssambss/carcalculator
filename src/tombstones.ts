/**
 * The tombstones without `id` - what saving an item again does to them.
 *
 * A merge already lets an item edited after its deletion win over the
 * tombstone. Dropping it at save time as well keeps this device's own copy
 * honest before any merge runs, which is what an undone delete relies on when
 * sync is off. The same object comes back when there is nothing to drop.
 */
export function untombstone(
  tombstones: Record<string, string>,
  id: string,
): Record<string, string> {
  if (!(id in tombstones)) return tombstones
  const next = { ...tombstones }
  delete next[id]
  return next
}
