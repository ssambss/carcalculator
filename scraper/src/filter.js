// Deciding whether a listing meets a filter's spec.
//
// Nettiauto exposes no filter for battery size, drivetrain or option packages,
// and the packages are never structured data - they live in seller free text.
// So everything below the year/mileage/price line is text matching, and every
// verdict carries the evidence that produced it so a human can sanity-check
// the call.
//
// Three kinds of text check, in increasing looseness:
//
//   variantMust / variantMustNot  the variant name and the spec chips only -
//                                short, structured, trustworthy
//   textMust / textMustNot        everything, the seller's free text included
//   packages                      a name that has to read as an option
//                                package, not a passing mention
//
// plus `implications`, which let a filter accept the shorthand sellers use:
// "seeing Neliveto proves Dual Motor" is a fact about the car, not about the
// advert, and stating it once beats teaching the matcher every model's range.

import { checkRanges } from './fields.js';
import { normalizeFilter } from './filters.js';

/** Words that mark a package name as an actual option package. */
const PACKAGE_NOUN = /^(paket|pkt|pack|package|varuste)/;

/** How many tokens apart two words may sit and still count as related. */
const MAX_GAP = 3;

/**
 * Shortest phrase word that may match the *start* of a longer token. Finnish
 * glues words together and inflects the tail, so "lasikatto" has to find
 * "lasikattoluukku" - but a three-letter phrase matching by prefix would find
 * something in every listing.
 */
const PREFIX_MIN = 5;

/**
 * Sort a filter's package qualifiers into two lookups.
 *
 * A qualifier is a word that changes what a package name means when it follows
 * it, and there are two kinds. `lesser`: "Pilot Lite" is a reduced version of
 * the Pilot pack, sold as its own option, so it must not satisfy a requirement
 * for Pilot. `feature`: "Pilot Assist" ships in both Pilot and Pilot Lite, so
 * seeing it says nothing about which of the two a car has.
 *
 * These used to be constants in this module, which made the matcher carry one
 * car's vocabulary for every filter. They belong to the filter that needs them
 * - the same argument that already puts `implications` there.
 */
export function vocabularyOf(qualifiers = []) {
  const lesser = new Map();
  const featureOnly = new Map();
  for (const rule of qualifiers) {
    const into = rule.means === 'feature' ? featureOnly : lesser;
    into.set(rule.package, [...(into.get(rule.package) ?? []), rule.word]);
  }
  return {
    lesser: (name) => lesser.get(name) ?? [],
    featureOnly: (name) => featureOnly.get(name) ?? [],
  };
}

const NO_VOCABULARY = vocabularyOf([]);

/**
 * True when the token after `span` leaves the package name meaning the package
 * itself, rather than a lesser variant or a feature out of it.
 */
function namesThePackage(tokens, span, name, { acceptLite = false, vocab = NO_VOCABULARY } = {}) {
  const next = tokens[span.end + 1];
  if (!next) return true;
  if (vocab.featureOnly(name).includes(next)) return false;
  if (!acceptLite && vocab.lesser(name).includes(next)) return false;
  return true;
}

/**
 * Every place a package name appears, as `{ start, end }` token spans.
 *
 * A package name is not always one word - "M Sport" and "Tech Pack" are two,
 * and sellers hyphenate them as freely as anything else, so the name is
 * tokenised the same way the text is. Matching stays exact word for word: a
 * package is a claim about equipment, and `plus` must not be satisfied by
 * `plussa`.
 */
function spansOf(tokens, words) {
  const spans = [];
  if (words.length === 0) return spans;
  for (let start = 0; start + words.length - 1 < tokens.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < words.length; offset += 1) {
      if (tokens[start + offset] !== words[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) spans.push({ start, end: start + words.length - 1 });
  }
  return spans;
}

/** Token distance between two spans; 1 means they are adjacent. */
function gapBetween(a, b) {
  return a.start > b.end ? a.start - b.end : b.start - a.end;
}

/**
 * Split text into comparable lowercase tokens.
 *
 * Every separator sellers use becomes whitespace, so "Pilot- ja Plus-pkt.",
 * "Pilot&Plus" and "Pilot / Plus" all reduce to the same token sequence.
 */
export function tokenize(text) {
  return (text ?? '')
    .toLowerCase()
    .normalize('NFC')
    .replace(/[-–—/|*&+,.;:!?()[\]{}"'`~<>=#%\\]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Is this phrase present in the tokenised text?
 *
 * The phrase is tokenised the same way as the text, so how the seller spelled
 * the separators stops mattering: "long range" finds "Long-Range",
 * "Long Range" and "LONG RANGE / 78kWh" alike.
 */
export function containsPhrase(tokens, phrase) {
  const words = tokenize(phrase);
  if (words.length === 0) return false;
  const last = words.length - 1;

  for (let start = 0; start + last < tokens.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset <= last; offset += 1) {
      const token = tokens[start + offset];
      const word = words[offset];
      if (token === word) continue;
      // Only the final word may match a longer token, and only if it is long
      // enough to mean something on its own. See PREFIX_MIN.
      if (offset === last && word.length >= PREFIX_MIN && token.startsWith(word)) continue;
      matched = false;
      break;
    }
    if (matched) return true;
  }
  return false;
}

/**
 * Work out which phrases the filter's implication rules prove.
 *
 * Rules chain - "Neliveto proves Dual Motor" plus "Dual Motor proves Long
 * Range" together prove Long Range from an AWD badge alone - so this runs to a
 * fixed point. Returns phrase -> the phrase it was inferred from.
 */
export function applyImplications(tokens, implications) {
  const implied = new Map();
  if (!implications.length) return implied;

  for (let round = 0; round < implications.length; round += 1) {
    let changed = false;
    for (const rule of implications) {
      if (implied.has(rule.then) || containsPhrase(tokens, rule.then)) continue;
      if (!containsPhrase(tokens, rule.if) && !implied.has(rule.if)) continue;
      implied.set(rule.then, rule.if);
      changed = true;
    }
    if (!changed) break;
  }
  return implied;
}

/**
 * Locate a package by name, returning where it appears and how strong the
 * evidence is.
 *
 * "Pilot Lite" is a distinct, smaller package than "Pilot", so a `pilot`
 * immediately followed by `lite` is recorded separately and does not satisfy a
 * requirement for Pilot unless the caller opts in.
 */
function findPackage(tokens, name, { others = [], acceptLite = false, vocab = NO_VOCABULARY } = {}) {
  const words = tokenize(name);
  const lesser = vocab.lesser(name);
  const featureOnly = vocab.featureOnly(name);
  // Where each of the other required packages sits, so a pairing can be
  // spotted whatever either of them is called.
  const partners = others.map((other) => ({ name: other, spans: spansOf(tokens, tokenize(other)) }));
  const hits = [];
  let sawLite = false;
  let sawFeature = false;

  for (const span of spansOf(tokens, words)) {
    const next = tokens[span.end + 1];
    const isLite = Boolean(next && lesser.includes(next));
    const isFeature = Boolean(next && featureOnly.includes(next));
    if (isLite) sawLite = true;
    if (isFeature) sawFeature = true;
    if (isFeature) continue;
    if (isLite && !acceptLite) continue;

    // Strong evidence: sits next to a "paketti"/"pack"/"varuste" word, or is
    // paired with another required package ("Pilot ja Plus", "Plus&Pilot").
    let nearNoun = false;
    let nearPartner = null;
    for (let offset = 1; offset <= MAX_GAP; offset += 1) {
      for (const token of [tokens[span.start - offset], tokens[span.end + offset]]) {
        if (token && PACKAGE_NOUN.test(token)) nearNoun = true;
      }
    }
    for (const partner of partners) {
      // A partner that is itself a "Lite" or feature mention is not the
      // partner package, so it cannot corroborate this one.
      const near = partner.spans.find(
        (other) =>
          gapBetween(span, other) <= MAX_GAP &&
          namesThePackage(tokens, other, partner.name, { acceptLite, vocab }),
      );
      if (near) nearPartner = partner.name;
    }

    hits.push({ index: span.start, nearNoun, nearPartner, isLite });
  }

  if (hits.length === 0) {
    return {
      found: false,
      strength: 'none',
      liteOnly: sawLite,
      featureOnly: !sawLite && sawFeature,
      sawLite,
    };
  }

  const strong = hits.find((hit) => hit.nearNoun || hit.nearPartner);
  return {
    found: true,
    strength: strong ? 'strong' : 'weak',
    liteOnly: false,
    // A listing that names both "Pilot" and "Pilot Lite" contradicts itself;
    // we take the stronger claim but flag it for a human to confirm.
    sawLite,
    pairedWith: strong?.nearPartner ?? null,
    viaNoun: Boolean(strong?.nearNoun),
  };
}

/**
 * Pull the source fragment that mentions a phrase, for display.
 *
 * Sellers separate equipment with slashes, asterisks, pipes and newlines, so
 * splitting on those yields a short human-readable snippet like
 * "Pilot- ja Plus-paketit".
 */
function evidenceSnippet(text, name) {
  if (!text) return null;
  const segments = text
    .split(/[\n/|*•]|\s{2,}|(?<=[a-zäöå])\s*[-–—]\s*(?=[A-ZÄÖÅ])/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  // Built word by word, so a two-word name quotes the fragment however the
  // seller punctuated it: "M Sport", "M-Sport" and "M&Sport" all show up.
  const escaped = tokenize(name)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\s\\-–—/&+]*');
  const matching = segments
    .filter((segment) => new RegExp(`\\b${escaped}`, 'i').test(segment))
    .sort((a, b) => a.length - b.length);
  const best = matching[0];
  if (!best) return null;
  return best.length > 140 ? `${best.slice(0, 137)}...` : best;
}

/** Text fields that describe the car's variant, in order of trustworthiness. */
function variantText(listing, detail) {
  return [
    detail?.schemaName,
    listing.subTitle,
    listing.title,
    listing.driveType,
    ...(listing.specs ?? []),
  ]
    .filter(Boolean)
    .join(' | ');
}

/** Everything a listing says, the seller's own description included. */
function fullText(listing, detail) {
  return [variantText(listing, detail), listing.usp, detail?.usp, detail?.description]
    .filter(Boolean)
    .join('\n');
}

/**
 * Decide whether a listing meets one filter's spec.
 *
 * `detail` is optional: pass the search-card data alone for a first pass, and
 * re-run with the listing page once fetched. `needsDetail` tells the caller
 * that a detail fetch could still change the verdict.
 */
export function evaluate(listing, detail = null, filter) {
  const spec = normalizeFilter(filter);
  const reasons = [];
  const notes = [];
  const warnings = [];
  // Reasons a detail page could still overturn (`unproven`) versus ones no
  // amount of extra text can (`settled`): numbers that miss, and phrases the
  // listing flatly contradicts.
  let unproven = 0;
  let settled = 0;

  // --- Hard numbers first: these need no text interpretation. ---
  //
  // Whatever the source, and whether they are years and kilometres or square
  // metres and a room count. Every one of these is settled: no amount of extra
  // text from a listing page turns a number that misses into one that hits, so
  // a car ruled out here never costs a detail fetch.
  reasons.push(...checkRanges(listing, spec.ranges));
  settled = reasons.length;

  // --- Text requirements. ---
  const variantTokens = tokenize(variantText(listing, detail));
  const allText = fullText(listing, detail);
  const allTokens = tokenize(allText);

  // Inferences read the variant name and the spec chips only: that is where a
  // fact about the car lives. A seller comparing their car to another one in
  // the description must not accidentally prove anything.
  const implied = applyImplications(variantTokens, spec.implications);
  const inferred = [];

  for (const phrase of spec.variantMust) {
    if (containsPhrase(variantTokens, phrase)) continue;
    const via = implied.get(phrase);
    if (via) {
      notes.push(`${phrase} inferred from ${via}`);
      inferred.push(phrase);
      continue;
    }
    reasons.push(`variant does not say ${phrase}`);
    unproven += 1;
  }

  for (const phrase of spec.variantMustNot) {
    if (!containsPhrase(variantTokens, phrase)) continue;
    reasons.push(phrase);
    settled += 1;
  }

  for (const phrase of spec.textMust) {
    if (containsPhrase(allTokens, phrase)) continue;
    const via = implied.get(phrase);
    if (via) {
      notes.push(`${phrase} inferred from ${via}`);
      inferred.push(phrase);
      continue;
    }
    reasons.push(`no mention of ${phrase}`);
    unproven += 1;
  }

  for (const phrase of spec.textMustNot) {
    if (!containsPhrase(allTokens, phrase)) continue;
    reasons.push(`mentions ${phrase}`);
    settled += 1;
  }

  // --- Option packages: seller free text only. ---
  const acceptWeak = spec.packageEvidence !== 'strong';
  const vocab = vocabularyOf(spec.packageQualifiers);
  const packages = {};

  for (const name of spec.packages) {
    const result = findPackage(allTokens, name, {
      others: spec.packages.filter((other) => other !== name),
      acceptLite: spec.acceptLesserPackages,
      vocab,
    });

    const satisfied = result.found && (result.strength === 'strong' || acceptWeak);
    packages[name] = {
      ...result,
      satisfied,
      snippet: result.found ? evidenceSnippet(allText, name) : null,
    };

    if (satisfied) {
      if (result.sawLite) {
        const lesser = `${name} ${vocab.lesser(name)[0] ?? 'lite'}`;
        warnings.push(
          `listing mentions both ${name} and ${lesser} - worth confirming with the seller`,
        );
      }
      continue;
    }
    unproven += 1;
    if (result.liteOnly) {
      reasons.push(`only ${name} ${vocab.lesser(name)[0] ?? 'lite'} found, not the full ${name} package`);
    } else if (result.featureOnly) {
      const feature = vocab.featureOnly(name)[0] ?? '';
      reasons.push(`only "${name} ${feature}" found - that feature ships without the package too`);
    } else if (result.found) {
      reasons.push(`${name} mentioned but not clearly as a package`);
    } else {
      reasons.push(`no ${name} package found`);
    }
  }

  // A detail fetch adds the seller's full description, which is where packages
  // and equipment are most often named - so an unproven requirement is worth
  // another look. There is no point re-fetching over a number that already
  // disqualifies the car, or over something the listing flatly contradicts:
  // more text can only ever add contradictions, never remove them.
  const needsDetail = !detail && settled === 0 && unproven > 0;

  return {
    matched: reasons.length === 0,
    reasons,
    notes,
    warnings,
    needsDetail,
    packages,
    inferred,
  };
}
