const eur0 = new Intl.NumberFormat('fi-FI', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})

const eur2 = new Intl.NumberFormat('fi-FI', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const num = new Intl.NumberFormat('fi-FI', { maximumFractionDigits: 2 })

/** whole euros: "12 345 €" */
export const fmtEur = (v: number): string => eur0.format(v)

/** cents shown: "458,80 €" */
export const fmtEurExact = (v: number): string => eur2.format(v)

/** plain number with fi grouping */
export const fmtNum = (v: number): string => num.format(v)

/**
 * A rate or a change, signed: "+1,2 %" / "−0,8 %". One decimal, and a hair
 * below zero reads "0 %" rather than "−0 %".
 */
export const fmtPct = (v: number): string => {
  const r = Math.round(v * 10) / 10
  const shown = r === 0 ? 0 : r
  return `${shown > 0 ? '+' : ''}${num.format(shown)} %`
}

const dateTime = new Intl.DateTimeFormat('fi-FI', { dateStyle: 'short', timeStyle: 'short' })

/** "26.8.2026 klo 19.05" style short timestamp; empty string for bad input */
export const fmtDateTime = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : dateTime.format(d)
}
