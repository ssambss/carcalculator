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

const dateTime = new Intl.DateTimeFormat('fi-FI', { dateStyle: 'short', timeStyle: 'short' })

/** "26.8.2026 klo 19.05" style short timestamp; empty string for bad input */
export const fmtDateTime = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : dateTime.format(d)
}
