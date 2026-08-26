// Deciding whether a listing meets the spec.
//
// Nettiauto exposes no filter for battery size, drivetrain or option packages,
// and the packages are never structured data - they live in seller free text.
// So everything below the year/mileage line is text matching, and every verdict
// carries the evidence that produced it so a human can sanity-check the call.

import config from './config.js';

/** Words that mark a package name as an actual option package. */
const PACKAGE_NOUN = /^(paket|pkt|pack|package|varuste)/;

/** How many tokens apart two words may sit and still count as related. */
const MAX_GAP = 3;

/**
 * Words that turn a package name into something *smaller* than the package.
 * "Pilot Lite" is a reduced version of the Pilot pack and is sold as its own
 * option, so it must not satisfy a requirement for Pilot.
 */
const LESSER_VARIANT = { pilot: ['lite'] };

/**
 * Words that turn a package name into an individual feature rather than the
 * package. "Pilot Assist" ships in both Pilot and Pilot Lite, so seeing it
 * says nothing about which of the two a car actually has.
 */
const FEATURE_NOT_PACKAGE = { pilot: ['assist'] };

/**
 * True when the token at `index` names the package itself, rather than a
 * lesser variant of it ("Pilot Lite") or a feature from it ("Pilot Assist").
 */
function namesThePackage(tokens, index, { acceptLite = false } = {}) {
  const name = tokens[index];
  const next = tokens[index + 1];
  if (!next) return true;
  if ((FEATURE_NOT_PACKAGE[name] ?? []).includes(next)) return false;
  if (!acceptLite && (LESSER_VARIANT[name] ?? []).includes(next)) return false;
  return true;
}

/**
 * Split text into comparable lowercase tokens.
 *
 * Every separator sellers use becomes whitespace, so "Pilot- ja Plus-pkt.",
 * "Pilot&Plus" and "Pilot / Plus" all reduce to the same token sequence.
 */
function tokenize(text) {
  return (text ?? '')
    .toLowerCase()
    .normalize('NFC')
    .replace(/[-–—/|*&+,.;:!?()[\]{}"'`~<>=#%\\]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Locate a package by name, returning where it appears and how strong the
 * evidence is.
 *
 * "Pilot Lite" is a distinct, smaller package than "Pilot", so a `pilot`
 * immediately followed by `lite` is recorded separately and does not satisfy a
 * requirement for Pilot unless the caller opts in.
 */
function findPackage(tokens, name, { others = [], acceptLite = false } = {}) {
  const lesser = LESSER_VARIANT[name] ?? [];
  const featureOnly = FEATURE_NOT_PACKAGE[name] ?? [];
  const hits = [];
  let sawLite = false;
  let sawFeature = false;

  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] !== name) continue;
    const next = tokens[index + 1];
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
    for (let offset = -MAX_GAP; offset <= MAX_GAP; offset += 1) {
      if (offset === 0) continue;
      const token = tokens[index + offset];
      if (!token) continue;
      if (PACKAGE_NOUN.test(token)) nearNoun = true;
      // A partner that is itself a "Lite" or feature mention is not the
      // partner package, so it cannot corroborate this one.
      if (others.includes(token) && namesThePackage(tokens, index + offset, { acceptLite })) {
        nearPartner = token;
      }
    }

    hits.push({ index, nearNoun, nearPartner, isLite });
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
 * Pull the source fragment that mentions a package, for display.
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
  const matching = segments
    .filter((segment) => new RegExp(`\\b${name}`, 'i').test(segment))
    .sort((a, b) => a.length - b.length);
  const best = matching[0];
  if (!best) return null;
  return best.length > 140 ? `${best.slice(0, 137)}...` : best;
}

/** Text fields that describe the car's variant, in order of trustworthiness. */
function variantText(listing, detail) {
  return [detail?.schemaName, listing.subTitle, listing.title].filter(Boolean).join(' | ');
}

/** Every field that could name an option package. */
function packageText(listing, detail) {
  return [listing.subTitle, listing.usp, detail?.usp, detail?.schemaName, detail?.description]
    .filter(Boolean)
    .join('\n');
}

/**
 * Assess battery and drivetrain from the variant strings.
 *
 * A Polestar 2 Dual Motor was only ever sold as a Long Range car, and the only
 * all-wheel-drive Polestar 2 is the dual motor - so each fact can stand in for
 * the other when a listing spells out just one. Both inferences are opt-in via
 * config and reported in the reasoning.
 */
function checkPowertrain(listing, detail, requirements) {
  const text = variantText(listing, detail);
  const notes = [];

  const saysLongRange = /long\s*-?\s*range/i.test(text);
  const saysStandardRange = /standard\s*-?\s*range/i.test(text);
  const saysDualMotor = /dual\s*-?\s*motor/i.test(text);
  const saysSingleMotor = /single\s*-?\s*motor/i.test(text);
  const isAwd = /neliveto/i.test([listing.driveType, ...(listing.specs ?? [])].join(' '));

  let dualMotor = saysDualMotor;
  if (!dualMotor && !saysSingleMotor && isAwd && requirements.awdImpliesDualMotor) {
    dualMotor = true;
    notes.push('dual motor inferred from AWD (Neliveto)');
  }

  let longRange = saysLongRange;
  if (!longRange && !saysStandardRange && dualMotor && requirements.dualMotorImpliesLongRange) {
    longRange = true;
    notes.push('long range inferred from dual motor');
  }

  const failures = [];
  if (saysSingleMotor) failures.push('single motor');
  else if (!dualMotor) failures.push('drivetrain not confirmed as dual motor');
  if (saysStandardRange) failures.push('standard range');
  else if (!longRange) failures.push('battery not confirmed as long range');

  return { longRange, dualMotor, failures, notes };
}

/**
 * Decide whether a listing meets the spec.
 *
 * `detail` is optional: pass the search-card data alone for a first pass, and
 * re-run with the listing page once fetched. `needsDetail` tells the caller
 * that a detail fetch could still change the verdict.
 */
export function evaluate(listing, detail = null, requirements = config.require) {
  const reasons = [];
  const notes = [];
  const warnings = [];

  // --- Hard numbers first: these need no text interpretation. ---
  if (listing.year === null) reasons.push('year unknown');
  else if (listing.year < requirements.yearFrom || listing.year > requirements.yearTo) {
    reasons.push(`year ${listing.year} outside ${requirements.yearFrom}-${requirements.yearTo}`);
  }

  if (listing.mileage === null) reasons.push('mileage unknown');
  else if (listing.mileage > requirements.maxMileage) {
    reasons.push(`${listing.mileage.toLocaleString('fi-FI')} km over ${requirements.maxMileage.toLocaleString('fi-FI')} km`);
  }

  const powertrain = checkPowertrain(listing, detail, requirements);
  reasons.push(...powertrain.failures);
  notes.push(...powertrain.notes);

  // --- Option packages: seller free text only. ---
  const text = packageText(listing, detail);
  const tokens = tokenize(text);
  const wanted = requirements.packages;
  const acceptWeak = requirements.packageEvidence !== 'strong';

  const packages = {};
  let packagesUnproven = false;

  for (const name of wanted) {
    const result = findPackage(tokens, name, {
      others: wanted.filter((other) => other !== name),
      acceptLite: name === 'pilot' ? Boolean(requirements.acceptPilotLite) : true,
    });

    const satisfied = result.found && (result.strength === 'strong' || acceptWeak);
    packages[name] = {
      ...result,
      satisfied,
      snippet: result.found ? evidenceSnippet(text, name) : null,
    };

    if (satisfied) {
      if (result.sawLite && name === 'pilot') {
        warnings.push('listing mentions both Pilot and Pilot Lite - worth confirming with the seller');
      }
      continue;
    }
    packagesUnproven = true;
    if (result.liteOnly && name === 'pilot') {
      reasons.push('only Pilot Lite found, not the full Pilot package');
    } else if (result.featureOnly && name === 'pilot') {
      reasons.push('only "Pilot Assist" found - that feature ships with Pilot Lite too');
    } else if (result.found) {
      reasons.push(`${name} mentioned but not clearly as a package`);
    } else {
      reasons.push(`no ${name} package found`);
    }
  }

  // A detail fetch adds the seller's full description, which is where packages
  // are most often named - so an unproven package is worth another look. There
  // is no point re-fetching over a year or mileage that already disqualifies.
  const disqualifiedOnFacts = powertrain.failures.some((failure) =>
    /single motor|standard range/.test(failure),
  );
  const numbersFailed = reasons.some((reason) => /year|km|mileage/.test(reason));
  const needsDetail =
    !detail && !numbersFailed && !disqualifiedOnFacts && (packagesUnproven || !powertrain.dualMotor);

  return {
    matched: reasons.length === 0,
    reasons,
    notes,
    warnings,
    needsDetail,
    packages,
    powertrain: { longRange: powertrain.longRange, dualMotor: powertrain.dualMotor },
  };
}

/**
 * Cheap pre-screen used to decide which listings are worth a detail fetch:
 * true when the year and mileage are in range and nothing rules the car out.
 */
export function worthInspecting(listing, requirements = config.require) {
  const verdict = evaluate(listing, null, requirements);
  return verdict.matched || verdict.needsDetail;
}
