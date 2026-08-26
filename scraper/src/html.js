// Small HTML helpers. A regex parser is the right size of tool here: the
// nettiauto markup we read is server-rendered and stable, and pulling in a
// DOM library for six fields would cost more than it returns.

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  thinsp: ' ',
  ensp: ' ',
  emsp: ' ',
  euro: '€',
  deg: '°',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  bull: '•',
  middot: '·',
  auml: 'ä',
  ouml: 'ö',
  Auml: 'Ä',
  Ouml: 'Ö',
  aring: 'å',
  Aring: 'Å',
};

/** Decode the HTML entities that actually show up in nettiauto pages. */
export function decodeEntities(input) {
  if (!input) return '';
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity) => {
    if (entity[0] === '#') {
      const codePoint =
        entity[1] === 'x' || entity[1] === 'X'
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return match;
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    }
    return Object.hasOwn(NAMED_ENTITIES, entity) ? NAMED_ENTITIES[entity] : match;
  });
}

/** Strip tags to readable text, keeping block boundaries as separators. */
export function htmlToText(html, { separator = ' ' } = {}) {
  if (!html) return '';
  return decodeEntities(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, separator),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Collapse to a single whitespace-normalised line. */
export function oneLine(html) {
  return htmlToText(html).replace(/\s+/g, ' ').trim();
}

/** First capture group of `re` against `html`, as text, or ''. */
export function pick(html, re) {
  const match = re.exec(html);
  return match ? oneLine(match[1]) : '';
}

/** Parse a Finnish-formatted integer such as "149 000" or "26 390". */
export function parseInteger(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
  const digits = String(value).replace(/[^\d]/g, '');
  if (!digits) return null;
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
