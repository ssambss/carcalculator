/** Small pieces both analysis charts share; no React in here. */

/** The 1-based year a 1-based month falls in. */
export const yearOf = (month: number) => Math.ceil(month / 12)

/** A whole-number percentage, or 0 when there is nothing to divide by. */
export const pct = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 100) : 0

/**
 * Clean axis ticks spanning `min`..`max` in four to five steps, always
 * including zero. Steps are 1 / 2 / 2.5 / 5 times a power of ten.
 */
export function niceTicks(min: number, max: number): number[] {
  const lo = Math.min(0, min)
  const hi = Math.max(0, max)
  const range = hi - lo
  if (range <= 0) return [0, 1]
  const mag = Math.pow(10, Math.floor(Math.log10(range / 4)))
  let step = mag
  for (const f of [1, 2, 2.5, 5, 10]) {
    step = f * mag
    if (range / step <= 5) break
  }
  const start = Math.floor(lo / step) * step
  const count = Math.ceil(hi / step) - Math.floor(lo / step)
  const ticks: number[] = []
  for (let i = 0; i <= count; i++) ticks.push(Number((start + i * step).toPrecision(12)))
  return ticks
}

/** Which year ends a table twin lists: the first, every fifth, and the last. */
export function tableYears(months: number): number[] {
  const years = new Set<number>([1])
  for (let y = 5; y * 12 <= months; y += 5) years.add(y)
  years.add(yearOf(months))
  return [...years].sort((a, b) => a - b)
}

/** Year ticks: whole years at a spacing that leaves at most eight labels. */
export function yearTicks(months: number): number[] {
  const years = months / 12
  const step = [1, 2, 5, 10, 20].find((s) => years / s <= 8) ?? 20
  const ticks: number[] = []
  for (let y = step; y * 12 <= months; y += step) ticks.push(y)
  return ticks
}
