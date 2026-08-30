/**
 * The numeric facts a filter can put limits on.
 *
 * Mirrors `scraper/src/fields.js`, deliberately rather than by sharing code —
 * the same arrangement the filter shape already has. The two sides normalize
 * independently and neither trusts the other, so an older app and a newer
 * scraper (or the reverse) still work.
 *
 * A filter's limits are a bag keyed by field:
 *
 *   ranges: { year: { min: 2021, max: 2023 }, mileage: { max: 120000 } }
 *
 * Nothing here knows what a car is. When there is more than one source these
 * declarations belong to it, and the editor renders whatever it declares —
 * square metres and a room count read the same way as years and kilometres.
 */

export interface ListingField {
  key: string
  /** Shown as the input's label, so this one is title-case unlike the scraper's. */
  label: string
  /** Suffix inside the input, where the number reads naturally with one. */
  unit?: string
  /** Years are not grouped with thousands separators, and read as from/to. */
  style?: 'year'
  /** Only on the field where an explanation earns its space. */
  hint?: string
  /**
   * Which ends the editor offers, when only one of them is worth the space.
   * A maximum odometer is what everyone filters on; a minimum is noise. Both
   * ends by default, because a price wants both and so does a build year.
   */
  ends?: ('min' | 'max')[]
}

export interface Range {
  min: number | null
  max: number | null
}

export type Ranges = Record<string, Range>

/** Which ends of a range the editor offers, and what to call them. */
export interface RangeEnd {
  side: 'min' | 'max'
  label: string
}

export const NETTIAUTO_FIELDS: ListingField[] = [
  { key: 'year', label: 'Year', style: 'year' },
  { key: 'mileage', label: 'Odometer', unit: 'km', ends: ['max'] },
  {
    key: 'price',
    label: 'Price',
    unit: '€',
    hint: 'A minimum rules out parts cars and price-on-request adverts.',
  },
]

/**
 * The inputs the editor should render, in order.
 *
 * Years read "Year from / Year to"; everything else reads "Max price / Min
 * price", with the maximum first because it is the one nearly every filter
 * sets. A field may narrow this to one end (see `ends`), which is how the
 * generated form comes out identical to the hand-written one it replaced.
 */
export function rangeInputs(fields: ListingField[] = NETTIAUTO_FIELDS): {
  field: ListingField
  side: 'min' | 'max'
  label: string
}[] {
  const out: { field: ListingField; side: 'min' | 'max'; label: string }[] = []
  for (const field of fields) {
    const named: RangeEnd[] =
      field.style === 'year'
        ? [
            { side: 'min', label: `${field.label} from` },
            { side: 'max', label: `${field.label} to` },
          ]
        : [
            { side: 'max', label: `Max ${field.label.toLowerCase()}` },
            { side: 'min', label: `Min ${field.label.toLowerCase()}` },
          ]
    const wanted = field.ends ?? ['min', 'max']
    for (const end of named) {
      if (wanted.includes(end.side)) out.push({ field, side: end.side, label: end.label })
    }
  }
  return out
}

const fi = new Intl.NumberFormat('fi-FI')

function format(value: number, field: ListingField): string {
  const number = field.style === 'year' ? String(value) : fi.format(value)
  return field.unit ? `${number} ${field.unit}` : number
}

/** The limits as short phrases, for the one-line summary in the filter list. */
export function describeRanges(
  ranges: Ranges,
  fields: ListingField[] = NETTIAUTO_FIELDS,
): string[] {
  const known = new Map(fields.map((field) => [field.key, field]))
  const order = new Map(fields.map((field, index) => [field.key, index]))
  const entries = Object.entries(ranges ?? {}).sort(
    ([a], [b]) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity),
  )

  const parts: string[] = []
  for (const [key, range] of entries) {
    const field = known.get(key) ?? { key, label: key }
    const min = range?.min ?? null
    const max = range?.max ?? null
    // A closed range carries its unit once, at the end: "20 000–29 000 €".
    if (min !== null && max !== null) {
      const bare = { ...field, unit: undefined }
      const span = `${format(min, bare)}–${format(max, bare)}`
      parts.push(field.unit ? `${span} ${field.unit}` : span)
    } else if (max !== null) parts.push(`≤ ${format(max, field)}`)
    else if (min !== null) parts.push(`≥ ${format(min, field)}`)
  }
  return parts
}

/** Read one end of one field, for the editor's inputs. */
export function rangeValue(ranges: Ranges, key: string, side: 'min' | 'max'): number | null {
  return ranges?.[key]?.[side] ?? null
}

/**
 * Set one end of one field, dropping a field that ends up asking for nothing.
 *
 * An empty range must not survive: the scraper treats a field with bounds as a
 * requirement, so `{ year: { min: null, max: null } }` would reject every
 * listing whose facts do not mention a year.
 */
export function withRange(
  ranges: Ranges,
  key: string,
  side: 'min' | 'max',
  value: number | null,
): Ranges {
  const current = ranges?.[key] ?? { min: null, max: null }
  const next: Range = { ...current, [side]: value }
  const out: Ranges = { ...ranges }
  if (next.min === null && next.max === null) delete out[key]
  else out[key] = next

  // Sorted, so two devices serialize an identical set identically - the filter
  // sync compares serialized sets to decide whether a push is needed.
  const sorted: Ranges = {}
  for (const field of Object.keys(out).sort()) sorted[field] = out[field]
  return sorted
}
