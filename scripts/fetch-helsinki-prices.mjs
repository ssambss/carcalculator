#!/usr/bin/env node
// Fetch Statistics Finland's dwelling-price series for Helsinki and write them
// to src/data/helsinkiPrices.ts, which the housing mode's "Helsinki by area"
// card reads. No dependencies; Node 18+ for fetch.
//
//   npm run fetch:prices
//
// Run it when a new year lands - the yearly tables update each May - and
// commit the result. The app never fetches at runtime: it is a static page
// that has to work offline in a stairwell, and the figures change once a year.
//
// Tables (StatFin, statistics "ashi" - osakeasuntojen hinnat):
//   13mu  €/m² and sales of old dwellings by postal code, yearly, 2009-
//   13mx  the same by municipality, yearly, 2006-           (Helsinki as a whole)
//   13mz  price indices by area, yearly, 1988-              (Helsinki + its four zones)
//   15is  the latest quarters: index, €/m², sales           (the newest reading)
//
// The postal code → zone classification is Statistics Finland's regional
// division for the quarterly statistics (ashi_2018-05-02_luo_001), the one its
// quality description points to. Zone 4 is "every other postal code".

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const API = 'https://pxdata.stat.fi/PxWeb/api/v1/fi/StatFin/ashi'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'helsinkiPrices.ts')

const ZONES_FROM = 'Tilastokeskus, aluejako neljännesvuositilastossa (ashi_2018-05-02_luo_001)'
const ZONE_CODES = {
  1: ['00100', '00120', '00130', '00140', '00150', '00160', '00170', '00180', '00220', '00260'],
  2: [
    '00200', '00210', '00250', '00270', '00280', '00290', '00300', '00310', '00320', '00330',
    '00340', '00380', '00500', '00510', '00520', '00530', '00540', '00550', '00560', '00570',
    '00580', '00590', '00610', '00810', '00850', '00990',
  ],
  3: [
    '00240', '00350', '00360', '00370', '00400', '00430', '00440', '00620', '00650', '00660',
    '00670', '00680', '00690', '00730', '00780', '00790', '00800', '00830', '00840', '00950',
  ],
}
const zoneOf = (code) => {
  for (const [zone, codes] of Object.entries(ZONE_CODES)) if (codes.includes(code)) return Number(zone)
  return 4
}

// 13mu / 13mx house-type codes → our keys
const AREA_TYPES = { studio: '1', two: '2', three: '3', terraced: '5' }
const CITY_TYPES = { all: '0', terraced: '1', flats: '3' }
const INDEX_AREAS = {
  helsinki: '091',
  zone1: '091-1',
  zone2: '091-2',
  zone3: '091-3',
  zone4: '091-4',
  capitalRegion: 'pks',
  finland: 'ksu',
}

/* ---------------------------------------------------------------- fetching */

async function getJson(url, init) {
  const res = await fetch(url, init)
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

/* ------------------------------------------------------------------- build */

async function build() {
  // 13mu: which postal codes are Helsinki's, and what they are called
  const m = await meta('13mu')
  const postal = m.variables.find((v) => v.code.startsWith('postinumeroalue'))
  const typeVar = m.variables.find((v) => v.code.startsWith('talotyyppi')).code
  const codes = postal.values.filter((c) => /^00\d{3}$/.test(c))
  const names = Object.fromEntries(
    postal.values.map((c, i) => [
      c,
      postal.valueTexts[i]
        .replace(/^\d{5}\s+/, '')
        .replace(/\s*\(Helsinki\)\s*$/, '')
        .trim(),
    ]),
  )
  console.error(`13mu: ${codes.length} Helsinki postal-code areas`)

  const areasData = dataset(
    await query('13mu', {
      [postal.code]: codes,
      [typeVar]: Object.values(AREA_TYPES),
      contentscode: ['keskihinta_aritm_nw', 'lkm_julk20'],
    }),
  )
  const years = areasData.dim('timeperiod_y').codes.map(Number)
  const areas = codes.map((code) => {
    const price = {}
    const count = {}
    for (const [key, t] of Object.entries(AREA_TYPES)) {
      price[key] = years.map((y) =>
        round(
          areasData.get({
            timeperiod_y: String(y),
            [postal.code]: code,
            [typeVar]: t,
            contentscode: 'keskihinta_aritm_nw',
          }),
        ),
      )
      count[key] = years.map((y) =>
        round(
          areasData.get({
            timeperiod_y: String(y),
            [postal.code]: code,
            [typeVar]: t,
            contentscode: 'lkm_julk20',
          }),
        ),
      )
    }
    return { code, name: names[code], zone: zoneOf(code), price, count }
  })

  // 13mx: Helsinki as a whole, back to 2006
  const mx = await meta('13mx')
  const kuntaVar = mx.variables.find((v) => v.code.startsWith('kunta')).code
  const cityTypeVar = mx.variables.find((v) => v.code.startsWith('talotyyppi')).code
  const cityData = dataset(
    await query('13mx', {
      [kuntaVar]: ['091'],
      [cityTypeVar]: Object.values(CITY_TYPES),
      contentscode: ['keskihinta_aritm_nw', 'lkm_julk19', 'lkm_julk20'],
    }),
  )
  const cityYears = cityData.dim('timeperiod_y').codes.map(Number)
  const city = { years: cityYears, price: {}, count: {} }
  for (const [key, t] of Object.entries(CITY_TYPES)) {
    const cell = (y, c) =>
      cityData.get({ timeperiod_y: String(y), [kuntaVar]: '091', [cityTypeVar]: t, contentscode: c })
    city.price[key] = cityYears.map((y) => round(cell(y, 'keskihinta_aritm_nw')))
    // Sales counts changed source in 2020 (transfer-tax records); the two
    // columns do not overlap, so whichever is published is the figure.
    city.count[key] = cityYears.map((y) => round(cell(y, 'lkm_julk20') ?? cell(y, 'lkm_julk19')))
  }

  // 13mz: the long index, Helsinki and its four zones, 2000 = 100
  const mz = await meta('13mz')
  const alueVar = mz.variables.find((v) => v.code.startsWith('alue')).code
  const mzType = mz.variables.find((v) => v.code.startsWith('talotyyppi')).code
  const mzRooms = mz.variables.find((v) => v.code.startsWith('huoneluku')).code
  const indexData = dataset(
    await query('13mz', {
      [alueVar]: Object.values(INDEX_AREAS),
      [mzType]: ['0'],
      [mzRooms]: ['00'],
      contentscode: ['ind00', 'rind00'],
    }),
  )
  const indexYears = indexData.dim('timeperiod_y').codes.map(Number)
  const index = { years: indexYears, series: {} }
  for (const [key, a] of Object.entries(INDEX_AREAS)) {
    const cell = (y, c) =>
      indexData.get({
        timeperiod_y: String(y),
        [alueVar]: a,
        [mzType]: '0',
        [mzRooms]: '00',
        contentscode: c,
      })
    index.series[key] = {
      nominal: indexYears.map((y) => round(cell(y, 'ind00'), 1)),
      real: indexYears.map((y) => round(cell(y, 'rind00'), 1)),
    }
  }

  // 15is: the newest quarter for Helsinki
  const is = await meta('15is')
  const isAlue = is.variables.find((v) => v.code.startsWith('alue')).code
  const isType = is.variables.find((v) => v.code.startsWith('talotyyppi')).code
  const isRooms = is.variables.find((v) => v.code.startsWith('huoneluku')).code
  const quarterData = dataset(
    await query('15is', {
      [isAlue]: ['091'],
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
  const qCell = (c) =>
    quarterData.get({ timeperiod_q: q, [isAlue]: '091', [isType]: '0', [isRooms]: '00', contentscode: c })
  const latest = {
    quarter: q,
    yearChangePct: round(qCell('ashivq_indeksi_vmuutos_2025'), 1),
    realYearChangePct: round(qCell('ashivq_realindeksi_vmuutos_2025'), 1),
    pricePerM2: round(qCell('ashivq_keskineliohinta')),
    count: round(qCell('ashivq_kauppamaara_vvero')),
    preliminary: /\*/.test(qDim.labels[q] ?? ''),
  }

  return {
    source: 'Tilastokeskus (Statistics Finland), osakeasuntojen hinnat',
    tables: ['13mu', '13mx', '13mz', '15is'],
    updated: (areasData.updated ?? '').slice(0, 10),
    fetchedAt: new Date().toISOString().slice(0, 10),
    zonesFrom: ZONES_FROM,
    years,
    areas,
    city,
    index,
    latest,
  }
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

const data = await build()
const header = `// Generated by scripts/fetch-helsinki-prices.mjs on ${data.fetchedAt} - do not edit by hand.
// Source: ${data.source}; tables ${data.tables.join(', ')}; yearly tables updated ${data.updated}.
// Zones: ${data.zonesFrom}.
import type { PriceData } from '../areas'

export const HELSINKI_PRICES: PriceData = `
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${header}${serialize(data)}\n`)
const cells = data.areas.reduce(
  (n, a) => n + Object.values(a.price).reduce((m, s) => m + s.filter((v) => v !== null).length, 0),
  0,
)
console.error(
  `wrote ${OUT}: ${data.areas.length} areas, ${data.years[0]}-${data.years[data.years.length - 1]}, ${cells} published €/m² figures, latest quarter ${data.latest.quarter}`,
)
