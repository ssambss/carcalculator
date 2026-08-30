// The numeric facts a filter can put limits on.
//
// A filter used to name its numbers directly - yearFrom, maxMileage, maxPrice -
// which made the matcher a thing that only understood cars. An apartment has a
// size and a room count and a maintenance fee, and none of them could be
// expressed. So the limits became a bag of ranges keyed by field:
//
//   ranges: { year: { min: 2021, max: 2023 }, mileage: { max: 120000 } }
//
// Nothing here knows what a car is. A source declares which fields its listings
// carry and what to call them; the checking below is the same either way, and
// `price` is just another field rather than a special case.
//
// The declarations live in this module for now. They belong to the source, and
// move into it when there is more than one (see PLAN.md, phase 2).

/**
 * Fields on a nettiauto listing that a filter can bound.
 *
 * `unit` labels the number where one reads naturally ("120 000 km"), and its
 * absence is what makes the message name the field instead ("rooms 2 under 3").
 * `style: 'year'` picks before/after over under/over and leaves the digits
 * ungrouped, because "year 2 019" is not a year.
 */
export const NETTIAUTO_FIELDS = [
  { key: 'year', label: 'year', style: 'year' },
  { key: 'mileage', label: 'mileage', unit: 'km' },
  { key: 'price', label: 'price', unit: '€' },
];

/** Field declarations by key, for whichever source is in play. */
export function fieldMap(fields = NETTIAUTO_FIELDS) {
  return new Map(fields.map((field) => [field.key, field]));
}

/**
 * Read a numeric fact off a listing.
 *
 * Checks the `facts` bag first and the listing's own properties second, so a
 * source that types its facts flatly (as the nettiauto parser does today) and
 * one that collects them into `facts` both work without the matcher caring.
 */
export function factOf(listing, key) {
  const value = listing?.facts?.[key] ?? listing?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function format(value, field) {
  const number = field?.style === 'year' ? String(value) : value.toLocaleString('fi-FI');
  return field?.unit ? `${number} ${field.unit}` : number;
}

/**
 * Describe a value that fell outside its bounds.
 *
 * Kept close to the wording these messages have always had, since they are what
 * the run log and `--verbose` show while a filter is being tuned: a unit says
 * which number it is, so only an unlabelled field needs its name spelled out.
 */
function outOfRange(field, value, bound, side) {
  const words = field?.style === 'year' ? { low: 'before', high: 'after' } : { low: 'under', high: 'over' };
  const prefix = field?.unit ? '' : `${field?.label ?? field?.key} `;
  return `${prefix}${format(value, field)} ${words[side]} ${format(bound, field)}`;
}

/**
 * Check every range a filter asks for.
 *
 * Returns the reasons it failed, empty when it passes. A range over a field the
 * listing has no value for fails rather than passing: "under 120 000 km" is a
 * claim about the car, and an advert that does not say cannot support it.
 *
 * Every reason here is *settled* - no amount of extra text from a listing page
 * can turn a number that misses into one that hits - which is what lets the
 * caller skip the detail fetch entirely.
 */
export function checkRanges(listing, ranges, fields = NETTIAUTO_FIELDS) {
  const known = fieldMap(fields);
  const reasons = [];

  for (const [key, range] of Object.entries(ranges ?? {})) {
    const field = known.get(key) ?? { key, label: key };
    const { min = null, max = null } = range ?? {};
    if (min === null && max === null) continue;

    const value = factOf(listing, key);
    if (value === null) {
      reasons.push(`${field.label ?? key} unknown`);
      continue;
    }
    // Both bounds are inclusive: "max 120 000 km" accepts a car showing
    // exactly that. Only one reason per field, since over and under cannot
    // both be true.
    if (max !== null && value > max) reasons.push(outOfRange(field, value, max, 'high'));
    else if (min !== null && value < min) reasons.push(outOfRange(field, value, min, 'low'));
  }

  return reasons;
}

/**
 * The numeric limits, as one line, for the run log and `--list`.
 *
 * Ordered by the source's field declarations rather than by whatever order the
 * ranges happen to be stored in, so two filters over the same source read the
 * same way.
 */
export function describeRanges(ranges, fields = NETTIAUTO_FIELDS) {
  const parts = [];
  const entries = Object.entries(ranges ?? {});
  const order = new Map(fields.map((field, index) => [field.key, index]));
  entries.sort(([a], [b]) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity));

  for (const [key, range] of entries) {
    const field = fieldMap(fields).get(key) ?? { key, label: key };
    const { min = null, max = null } = range ?? {};
    // A closed range carries its unit once, at the end: "20 000-29 000 €".
    if (min !== null && max !== null) {
      const span = `${format(min, { ...field, unit: '' })}-${format(max, { ...field, unit: '' })}`;
      parts.push(field.unit ? `${span} ${field.unit}` : span);
    } else if (max !== null) parts.push(`max ${format(max, field)}`);
    else if (min !== null) parts.push(`min ${format(min, field)}`);
  }

  return parts;
}
