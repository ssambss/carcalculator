#!/usr/bin/env node
// Fetch Statistics Finland's dwelling-price series for the cities of the
// capital region and write them to src/data/areaPrices.ts, which the housing
// mode's "Prices by area" card reads. No dependencies; Node 18+ for fetch.
//
//   npm run fetch:prices
//
// Run it when a new year lands - the yearly tables update each May - and
// commit the result. The app never fetches at runtime: it is a static page
// that has to work offline in a stairwell, and the figures change once a year.
//
// Tables (StatFin, statistics "ashi" - osakeasuntojen hinnat):
//   13mu  €/m² and sales of old dwellings by postal code, yearly, 2009-
//   13mx  the same by municipality, yearly, 2006-           (each city as a whole)
//   13mz  price indices by area, yearly, 1988-              (each city + its zones)
//   15is  the latest quarters: index, €/m², sales           (the newest reading)
//
// The postal code → price zone classification comes from Statistics Finland's
// classification service, as the very division the tables name in their area
// variable: the quarterly table's (the current base year) first, and for a
// postal code that one leaves out, the yearly index table's (the base year
// before). Before 2026-10 the zones were copied by hand from a 2018 page
// (ashi_2018-05-02_luo_001), which had gone out of date for a dozen areas.
//
// Adding a city is a line in CITIES - its municipality names as 13mu spells
// them, and its code in 13mx and 13mz - plus, if wanted, zone names in
// src/areas.ts (ZONE_LABELS); without them the zones are named by price level.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const API = 'https://pxdata.stat.fi/PxWeb/api/v1/fi/StatFin/ashi'
const CLASSIFICATIONS = 'https://data.stat.fi/api/classifications/v2/classifications'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'areaPrices.ts')

/**
 * key: what the app calls it. name: the card's name for it. municipalities:
 * whose postal codes it takes, as 13mu labels them ("02700 Kauniainen
 * (Kauniainen)"). kunta: the 13mx municipality for the city as a whole. index:
 * the 13mz/15is area - Statistics Finland prices Kauniainen, an enclave inside
 * Espoo, together with it, so its one postal code goes with Espoo here too.
 */
const CITIES = [
  { key: 'helsinki', name: 'Helsinki', municipalities: ['Helsinki'], kunta: '091', index: '091' },
  { key: 'espoo', name: 'Espoo', municipalities: ['Espoo', 'Kauniainen'], kunta: '049', index: '049' },
  { key: 'vantaa', name: 'Vantaa', municipalities: ['Vantaa'], kunta: '092', index: '092' },
]

// 13mu / 13mx house-type codes → our keys
const AREA_TYPES = { studio: '1', two: '2', three: '3', terraced: '5' }
const CITY_TYPES = { all: '0', terraced: '1', flats: '3' }

/* ---------------------------------------------------------------- fetching */

async function getJson(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${url}: HTTP ${res.status}`)
  return res.json()
}

const meta = (table) => getJson(`${API}/${table}.px`)

const query = (table, selections) =>
  getJson(`${API}/${table}.px`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: Object.entries(selections).map(([code, values]) => ({
        code,
        selection: { filter: 'item', values },
      })),
      response: { format: 'json-stat2' },
    }),
  })

/** A JSON-stat2 dataset as a getter keyed by dimension code → category code. */
function dataset(d) {
  const dims = d.id.map((id) => {
    const cat = d.dimension[id].category
    const codes = Object.keys(cat.index).sort((a, b) => cat.index[a] - cat.index[b])
    return { id, codes, labels: cat.label ?? {} }
  })
  const strides = d.size.map((_, i) => d.size.slice(i + 1).reduce((a, b) => a * b, 1))
  const get = (sel) => {
    let idx = 0
    dims.forEach((dim, i) => {
      const k = dim.codes.indexOf(sel[dim.id])
      if (k < 0) throw new Error(`no ${sel[dim.id]} in ${dim.id}`)
      idx += k * strides[i]
    })
    const v = d.value[idx]
    return v === null || v === undefined ? null : v
  }
  const dim = (id) => dims.find((x) => x.id === id)
  return { get, dim, updated: d.updated }
}

const round = (v, digits = 0) => (v === null ? null : Number(v.toFixed(digits)))

/**
 * One area classification as postal code → area code ("00730" → "091-3"), for
 * the old-dwelling zones of the cities asked for. The service lists each
 * zone's postal codes as prose in the item's note ("00100, 00120, ..."), with
 * the odd trailing full stop; the new-dwelling zones beside them ("0911")
 * have no hyphen and are not ours.
 */
async function zoneDivision(id, indexCodes) {
  const items = await getJson(`${CLASSIFICATIONS}/${id}/classificationItems?content=data&meta=max&lang=fi&format=json`)
  const name = items[0]?.classification?.classificationName?.[0]?.name ?? id
  const zoneOf = new Map()
  for (const it of items) {
    const m = /^(\d{3})-(\d)$/.exec(it.code)
    if (!m || !indexCodes.includes(m[1])) continue
    const text = (it.explanatoryNotes ?? []).flatMap((n) => n.includes ?? []).join(' ')
    for (const code of text.match(/\d{5}/g) ?? []) zoneOf.set(code, it.code)
  }
  return { id, name, zoneOf }
}

/* ------------------------------------------------------------------- build */

async function build() {
  const indexCodes = CITIES.map((c) => c.index)

  // 13mu: which postal codes belong to which city, and what they are called
  const m = await meta('13mu')
  const postal = m.variables.find((v) => v.code.startsWith('postinumeroalue'))
  const typeVar = m.variables.find((v) => v.code.startsWith('talotyyppi')).code
  const municipalityOf = new Map()
  const names = new Map()
  postal.values.forEach((code, i) => {
    const label = postal.valueTexts[i].replace(/^\d{5}\s+/, '').trim()
    const mm = /^(.*?)\s*\(([^)]+)\)$/.exec(label)
    if (!mm) return
    names.set(code, mm[1].trim())
    municipalityOf.set(code, mm[2])
  })
  const codesFor = (city) => postal.values.filter((c) => city.municipalities.includes(municipalityOf.get(c)))

  // The zones: the quarterly table's division, then the yearly index's for
  // what that one leaves out.
  const mz = await meta('13mz')
  const is = await meta('15is')
  const alueOf = (t) => t.variables.find((v) => v.code.startsWith('alue'))
  const current = await zoneDivision(alueOf(is).code, indexCodes)
  const previous = await zoneDivision(alueOf(mz).code, indexCodes)
  const zonesFrom = `Tilastokeskus, ${current.name} (${current.id}); ${previous.name} (${previous.id}) where the first has no zone`

  const allCodes = CITIES.flatMap(codesFor)
  console.error(`13mu: ${allCodes.length} postal-code areas in ${CITIES.map((c) => c.name).join(', ')}`)
  const areasData = dataset(
    await query('13mu', {
      [postal.code]: allCodes,
      [typeVar]: Object.values(AREA_TYPES),
      contentscode: ['keskihinta_aritm_nw', 'lkm_julk20'],
    }),
  )
  const years = areasData.dim('timeperiod_y').codes.map(Number)

  // 13mx: each city as a whole, back to 2006
  const mx = await meta('13mx')
  const kuntaVar = mx.variables.find((v) => v.code.startsWith('kunta')).code
  const cityTypeVar = mx.variables.find((v) => v.code.startsWith('talotyyppi')).code
  const cityData = dataset(
    await query('13mx', {
      [kuntaVar]: CITIES.map((c) => c.kunta),
      [cityTypeVar]: Object.values(CITY_TYPES),
      contentscode: ['keskihinta_aritm_nw', 'lkm_julk19', 'lkm_julk20'],
    }),
  )
  const cityYears = cityData.dim('timeperiod_y').codes.map(Number)

  // 13mz: the long index, each city and its zones, 2000 = 100. A zone the
  // division added later has no 2000 base at all - Vantaa 3 starts with the
  // 2015 one - so it takes the earliest base it does have; only the ratios
  // are ever read, and those do not depend on the base.
  const alueVar = alueOf(mz).code
  const mzType = mz.variables.find((v) => v.code.startsWith('talotyyppi')).code
  const mzRooms = mz.variables.find((v) => v.code.startsWith('huoneluku')).code
  const indexAreas = alueOf(mz).values.filter((a) => indexCodes.some((c) => a === c || a.startsWith(`${c}-`)))
  const indexNames = Object.fromEntries(alueOf(mz).values.map((a, i) => [a, alueOf(mz).valueTexts[i]]))
  const BASES = ['00', '05', '10', '15']
  const indexData = dataset(
    await query('13mz', {
      [alueVar]: indexAreas,
      [mzType]: ['0'],
      [mzRooms]: ['00'],
      contentscode: BASES.flatMap((b) => [`ind${b}`, `rind${b}`]),
    }),
  )
  const indexYears = indexData.dim('timeperiod_y').codes.map(Number)
  const indexSeries = (a) => {
    const cell = (y, c) =>
      indexData.get({ timeperiod_y: String(y), [alueVar]: a, [mzType]: '0', [mzRooms]: '00', contentscode: c })
    const series = (c) => indexYears.map((y) => round(cell(y, c), 1))
    const base = BASES.find((b) => series(`ind${b}`).some((v) => v !== null)) ?? BASES[0]
    if (base !== BASES[0]) {
      const from = indexYears[series(`ind${base}`).findIndex((v) => v !== null)]
      console.error(`  ${indexNames[a]}: no 20${BASES[0]} index, using 20${base} = 100 (from ${from})`)
    }
    return { nominal: series(`ind${base}`), real: series(`rind${base}`) }
  }

  // 15is: the newest quarter for each city
  const isAlue = alueOf(is).code
  const isType = is.variables.find((v) => v.code.startsWith('talotyyppi')).code
  const isRooms = is.variables.find((v) => v.code.startsWith('huoneluku')).code
  const quarterData = dataset(
    await query('15is', {
      [isAlue]: indexCodes,
      [isType]: ['0'],
      [isRooms]: ['00'],
      contentscode: [
        'ashivq_indeksi_vmuutos_2025',
        'ashivq_realindeksi_vmuutos_2025',
        'ashivq_keskineliohinta',
        'ashivq_kauppamaara_vvero',
      ],
    }),
  )
  const qDim = quarterData.dim('timeperiod_q')
  const q = qDim.codes[qDim.codes.length - 1]

  return CITIES.map((city) => {
    const zoneCodes = indexAreas.filter((a) => a.startsWith(`${city.index}-`))
    const zones = zoneCodes.map((a) => Number(a.slice(city.index.length + 1)))

    const areas = []
    for (const code of codesFor(city)) {
      const zoneCode = current.zoneOf.get(code) ?? previous.zoneOf.get(code)
      if (!zoneCode || !zoneCode.startsWith(`${city.index}-`)) {
        console.error(`  ${code} ${names.get(code)}: in no ${city.name} zone of either division - left out`)
        continue
      }
      if (!current.zoneOf.has(code)) {
        console.error(`  ${code} ${names.get(code)}: not in ${current.id}, zone taken from ${previous.id}`)
      }
      const price = {}
      const count = {}
      for (const [key, t] of Object.entries(AREA_TYPES)) {
        const cell = (y, c) =>
          areasData.get({ timeperiod_y: String(y), [postal.code]: code, [typeVar]: t, contentscode: c })
        price[key] = years.map((y) => round(cell(y, 'keskihinta_aritm_nw')))
        count[key] = years.map((y) => round(cell(y, 'lkm_julk20')))
      }
      areas.push({ code, name: names.get(code), zone: Number(zoneCode.slice(-1)), price, count })
    }

    const whole = { years: cityYears, price: {}, count: {} }
    for (const [key, t] of Object.entries(CITY_TYPES)) {
      const cell = (y, c) =>
        cityData.get({ timeperiod_y: String(y), [kuntaVar]: city.kunta, [cityTypeVar]: t, contentscode: c })
      whole.price[key] = cityYears.map((y) => round(cell(y, 'keskihinta_aritm_nw')))
      // Sales counts changed source in 2020 (transfer-tax records); the two
      // columns do not overlap, so whichever is published is the figure.
      whole.count[key] = cityYears.map((y) => round(cell(y, 'lkm_julk20') ?? cell(y, 'lkm_julk19')))
    }

    const qCell = (c) =>
      quarterData.get({ timeperiod_q: q, [isAlue]: city.index, [isType]: '0', [isRooms]: '00', contentscode: c })

    return {
      key: city.key,
      name: city.name,
      indexName: indexNames[city.index],
      municipalities: city.municipalities,
      zones,
      source: 'Tilastokeskus (Statistics Finland), osakeasuntojen hinnat',
      tables: ['13mu', '13mx', '13mz', '15is'],
      updated: (areasData.updated ?? '').slice(0, 10),
      fetchedAt: new Date().toISOString().slice(0, 10),
      zonesFrom,
      years,
      areas,
      city: whole,
      index: {
        years: indexYears,
        city: indexSeries(city.index),
        zones: Object.fromEntries(zoneCodes.map((a, i) => [zones[i], indexSeries(a)])),
      },
      latest: {
        quarter: q,
        yearChangePct: round(qCell('ashivq_indeksi_vmuutos_2025'), 1),
        realYearChangePct: round(qCell('ashivq_realindeksi_vmuutos_2025'), 1),
        pricePerM2: round(qCell('ashivq_keskineliohinta')),
        count: round(qCell('ashivq_kauppamaara_vvero')),
        preliminary: /\*/.test(qDim.labels[q] ?? ''),
      },
    }
  })
}

/* ------------------------------------------------------------------- write */

/** JSON with arrays of primitives kept on one line - a series per line, not a number per line. */
function serialize(value, indent = '') {
  if (Array.isArray(value)) {
    if (value.every((v) => v === null || typeof v !== 'object')) return JSON.stringify(value)
    const inner = indent + '  '
    return `[\n${value.map((v) => inner + serialize(v, inner)).join(',\n')}\n${indent}]`
  }
  if (value && typeof value === 'object') {
    const inner = indent + '  '
    const entries = Object.entries(value).map(
      ([k, v]) => `${inner}${JSON.stringify(k)}: ${serialize(v, inner)}`,
    )
    return `{\n${entries.join(',\n')}\n${indent}}`
  }
  return JSON.stringify(value)
}

const cities = await build()
const first = cities[0]
const header = `// Generated by scripts/fetch-area-prices.mjs on ${first.fetchedAt} - do not edit by hand.
// Source: ${first.source}; tables ${first.tables.join(', ')}; yearly tables updated ${first.updated}.
// Zones: ${first.zonesFrom}.
import type { PriceData } from '../areas'

export const AREA_PRICES: PriceData[] = `
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${header}${serialize(cities)}\n`)
for (const c of cities) {
  const cells = c.areas.reduce(
    (n, a) => n + Object.values(a.price).reduce((s, v) => s + v.filter((x) => x !== null).length, 0),
    0,
  )
  console.error(
    `${c.name}: ${c.areas.length} areas in zones ${c.zones.join('/')}, ${c.years[0]}-${c.years[c.years.length - 1]}, ${cells} published €/m² figures, latest quarter ${c.latest.quarter}`,
  )
}
console.error(`wrote ${OUT}`)
