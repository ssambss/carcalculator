// Saving up: the growth formulas, the cash a price takes, and the watcher's
// reading of the check-ins against the plan.
//
// The cash a price takes is the ceiling solved the other way round, so the
// strongest test is the round trip: give `affordability` exactly that much
// saved and it has to land on the price again.

import { describe, expect, it } from 'vitest'

import { DEFAULT_HOUSING, affordability, type HousingSituation } from '../src/housing'
import { dayOf, isoOf } from '../src/mileage'
import {
  DAYS_PER_MONTH,
  DEFAULT_PLAN,
  aspReadyMonth,
  balanceMonths,
  cashNeeded,
  grow,
  householdAt,
  monthlyFor,
  planAt,
  pointsOf,
  reachedOn,
  savingStatus,
  type SavingPlan,
  type SavingReading,
  type Saver,
} from '../src/saving'

const day = (iso: string) => dayOf(iso)!

/** A household like the one this was built for: two borrowers, ASP, the reform's 5 %. */
const couple: HousingSituation = {
  ...DEFAULT_HOUSING,
  netIncomePerMonth: 3300,
  otherLoanPaymentsPerMonth: 150,
  buyingTogether: true,
  partnerNetIncomePerMonth: 3000,
  partnerOtherLoanPaymentsPerMonth: 170,
  housingSharePct: 40,
  termYears: 40,
  maintenanceEstimatePerMonth: 200,
  useAspLoan: true,
  aspRatePct: 2.8,
  aspMaxLoan: 345_000,
}

const single: HousingSituation = { ...couple, buyingTogether: false, useAspLoan: false }

const plan = (over: Partial<SavingPlan> = {}): SavingPlan => ({
  ...DEFAULT_PLAN,
  targetDate: '2028-06-01',
  monthlyDeposit: 700,
  partnerMonthlyDeposit: 700,
  interestPct: 0,
  bonusPct: 0,
  ...over,
})

let seq = 0
const reading = (
  date: string,
  amount: number,
  saver: Saver = 'self',
  updatedAt = '2026-09-01T00:00:00.000Z',
): SavingReading => ({
  id: `r${++seq}`,
  date,
  saver,
  amount,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt,
})

describe('the growth', () => {
  it('is the deposits alone at no interest', () => {
    expect(grow(1000, 700, 0, 12)).toBeCloseTo(1000 + 700 * 12, 9)
    expect(grow(1000, 700, 0, 2.5)).toBeCloseTo(1000 + 700 * 2.5, 9)
  })

  it('compounds a year to the yearly rate', () => {
    expect(grow(10_000, 0, 1, 12)).toBeCloseTo(10_100, 6)
  })

  it('matches a deposit at each month end, on whole months', () => {
    const g = Math.pow(1.01, 1 / 12)
    let b = 2000
    for (let k = 0; k < 20; k++) b = b * g + 700
    expect(grow(2000, 700, 1, 20)).toBeCloseTo(b, 6)
  })

  it('never goes back in time', () => {
    expect(grow(1234, 700, 1, -3)).toBe(1234)
  })

  it('integrates to B·m + D·m²/2 at no interest', () => {
    expect(balanceMonths(1000, 700, 0, 12)).toBeCloseTo(1000 * 12 + (700 * 144) / 2, 9)
  })

  it('integrates the compounding curve too', () => {
    // A plain midpoint sum over small steps, against the closed form.
    const m = 20
    const steps = 20_000
    let sum = 0
    for (let k = 0; k < steps; k++) sum += grow(1500, 700, 3, ((k + 0.5) * m) / steps) * (m / steps)
    expect(balanceMonths(1500, 700, 3, m)).toBeCloseTo(sum, 3)
  })
})

describe('the cash a price takes', () => {
  const prices = [150_000, 250_000, 329_000, 430_000, 600_000]

  it('is the ceiling backwards: that much saved reaches exactly the price', () => {
    for (const s of [couple, single]) {
      for (const kind of ['', 'flat', 'terraced', 'detached'] as const) {
        for (const price of prices) {
          const need = cashNeeded(price, kind, s)
          const back = affordability({ ...s, savings: need.needed, partnerSavings: 0 }, kind)
          expect(back.maxPrice).toBeCloseTo(price, 4)
        }
      }
    }
  })

  it('is the cash share, the tax and the costs while income carries the loan', () => {
    const s = { ...couple, buyingCosts: 1500 }
    const need = cashNeeded(300_000, 'flat', s)
    expect(need.limitedBy).toBe('rules')
    expect(need.bridge).toBe(0)
    expect(need.cashShare).toBeCloseTo(15_000, 6)
    expect(need.transferTax).toBeCloseTo(4_500, 6)
    expect(need.needed).toBeCloseTo(15_000 + 4_500 + 1_500, 6)
  })

  it('pays the real-estate rate for a detached house', () => {
    const need = cashNeeded(300_000, 'detached', couple)
    expect(need.transferTax).toBeCloseTo(9_000, 6)
    expect(need.needed).toBeCloseTo(15_000 + 9_000, 6)
  })

  it('bridges with cash once the price outgrows the loan the income carries', () => {
    const need = cashNeeded(600_000, 'flat', couple)
    expect(need.limitedBy).toBe('income')
    expect(need.bridge).toBeGreaterThan(0)
    expect(need.needed).toBeCloseTo(600_000 * 1.015 - need.maxLoan, 4)
    expect(need.needed - need.bridge).toBeCloseTo(600_000 * (0.05 + 0.015), 4)
  })

  it('asks the whole price in cash when there is no income to borrow on', () => {
    const s = { ...single, netIncomePerMonth: 0, otherLoanPaymentsPerMonth: 0 }
    expect(cashNeeded(200_000, 'flat', s).needed).toBeCloseTo(203_000, 6)
  })
})

describe('the check-ins', () => {
  it('keep one a day per saver, the last typed, in day order', () => {
    const pts = pointsOf(
      [
        reading('2026-10-30', 2400),
        reading('2026-09-30', 1000, 'self', '2026-09-30T10:00:00.000Z'),
        reading('2026-09-30', 1700, 'self', '2026-09-30T11:00:00.000Z'),
        reading('2026-09-30', 900, 'partner'),
        { ...reading('2026-11-30', 3000), date: 'not a day' },
      ],
      'self',
    )
    expect(pts).toEqual([
      { day: day('2026-09-30'), amount: 1700 },
      { day: day('2026-10-30'), amount: 2400 },
    ])
  })
})

describe('against the plan', () => {
  const today = day('2026-12-30')

  /** A saver exactly on the plan: the first check-in, then what the plan says since. */
  function onPlan(p: SavingPlan, first: string, amount: number, deposit: number, saver: Saver) {
    const d0 = day(first)
    return [0, 30, 61, 91].map((offset) =>
      reading(
        isoOf(d0 + offset),
        grow(amount, deposit, p.interestPct, offset / DAYS_PER_MONTH),
        saver,
      ),
    )
  }

  it('reads a saver who keeps to the plan as on it', () => {
    const p = plan({ interestPct: 1 })
    const status = savingStatus(p, single, onPlan(p, '2026-09-30', 1000, 700, 'self'), today)
    expect(status.savers).toHaveLength(1)
    expect(status.vsPlan).toBeCloseTo(0, 6)
  })

  it('reads a skipped deposit as a deposit behind', () => {
    const p = plan()
    const rs = onPlan(p, '2026-09-30', 1000, 700, 'self')
    rs[rs.length - 1].amount -= 700
    expect(savingStatus(p, single, rs, today).vsPlan).toBeCloseTo(-700, 6)
  })

  it('carries on from the last check-in to the purchase', () => {
    const p = plan({ interestPct: 1 })
    const status = savingStatus(p, single, [reading('2026-09-30', 1000)], today)
    const months = (day('2028-06-01') - day('2026-09-30')) / DAYS_PER_MONTH
    expect(status.atTarget).toBeCloseTo(grow(1000, 700, 1, months), 6)
    expect(status.savedNow).toBe(1000)
    expect(status.asOf).toBe(day('2026-09-30'))
  })

  it('adds the second borrower only when buying together', () => {
    const p = plan()
    const rs = [reading('2026-09-30', 1000), reading('2026-09-30', 800, 'partner')]
    expect(savingStatus(p, single, rs, today).savedNow).toBe(1000)
    const both = savingStatus(p, couple, rs, today)
    expect(both.savedNow).toBe(1800)
    expect(both.monthlyTotal).toBe(1400)
    expect(both.atTarget).toBeCloseTo(both.savers[0].total + both.savers[1].total, 9)
  })

  it('counts a saver with no check-in from zero today', () => {
    const p = plan()
    const status = savingStatus(p, couple, [reading('2026-12-30', 3000)], today)
    const months = (day('2028-06-01') - today) / DAYS_PER_MONTH
    expect(status.savers[1].last).toBeNull()
    expect(status.savers[1].atTarget).toBeCloseTo(700 * months, 6)
    expect(status.vsPlan).toBeCloseTo(0, 9)
  })

  it('adds the ASP bonus at the purchase, and only with an ASP loan', () => {
    const p = plan({ bonusPct: 2, targetDate: isoOf(day('2026-12-30') + Math.round(365.25)) })
    const rs = [reading('2026-12-30', 1000)]
    const months = Math.round(365.25) / DAYS_PER_MONTH
    const expected = ((1000 * months + (700 * months * months) / 2) * 0.02) / 12
    const asp = savingStatus(p, { ...single, useAspLoan: true }, rs, today)
    expect(asp.savers[0].bonus).toBeCloseTo(expected, 6)
    expect(asp.bonusCounted).toBe(true)
    const plain = savingStatus(p, single, rs, today)
    expect(plain.savers[0].bonus).toBe(0)
    expect(plain.bonusCounted).toBe(false)
  })

  it('counts the bonus over the check-ins already logged, as a straight line', () => {
    const p = plan({ bonusPct: 3, targetDate: '2027-03-30' })
    const s = { ...single, useAspLoan: true }
    const rs = [reading('2026-09-30', 1000), reading('2026-12-30', 3100)]
    const past = ((1000 + 3100) / 2) * ((day('2026-12-30') - day('2026-09-30')) / DAYS_PER_MONTH)
    const m = (day('2027-03-30') - day('2026-12-30')) / DAYS_PER_MONTH
    const future = 3100 * m + (700 * m * m) / 2
    expect(savingStatus(p, s, rs, today).savers[0].bonus).toBeCloseTo(
      ((past + future) * 0.03) / 12,
      6,
    )
  })

  it('stops the bonus five calendar years after the first saving year', () => {
    // First deposit 2021 → bonus through 2026, none in 2027.
    const s = { ...single, useAspLoan: true }
    const cut = plan({ bonusPct: 2, targetDate: '2027-12-30', aspFirstMonth: '2021-03' })
    const open = plan({ bonusPct: 2, targetDate: '2026-12-31' })
    const rs = [reading('2026-06-30', 5000)]
    const bonusCut = savingStatus(cut, s, rs, day('2026-06-30')).savers[0].bonus
    const bonusToYearEnd = savingStatus(open, s, rs, day('2026-06-30')).savers[0].bonus
    // The window closes on 1.1.2027; up to 31.12.2026 is one day short of it.
    expect(bonusCut).toBeGreaterThan(bonusToYearEnd)
    expect(bonusCut - bonusToYearEnd).toBeLessThan(10)
  })
})

describe('the answers', () => {
  const today = day('2026-09-30')

  it('draws the household from the day both have checked in', () => {
    const p = plan()
    const rs = [
      reading('2026-09-01', 500),
      reading('2026-10-01', 1200),
      reading('2026-09-15', 900, 'partner'),
    ]
    const status = savingStatus(p, couple, rs, today)
    expect(householdAt(status, p, day('2026-09-10'))).toBeNull()
    // Mine halfway between 500 and 1200 on 16.9., theirs a day past 900.
    const mid = householdAt(status, p, day('2026-09-16'))!
    expect(mid).toBeCloseTo(850 + 900 + 700 / DAYS_PER_MONTH, 6)
    expect(planAt(status, p, day('2026-09-10'))).toBeNull()
  })

  it('finds the day a sum is reached, at the plan', () => {
    const p = plan()
    const status = savingStatus(p, single, [reading('2026-09-30', 1000)], today)
    expect(reachedOn(status, p, 800)).toBe(today)
    const on = reachedOn(status, p, 1000 + 700 * 6)!
    expect(on - today).toBe(Math.ceil(6 * DAYS_PER_MONTH))
    expect(reachedOn(savingStatus(plan({ monthlyDeposit: 0 }), single, [], today), p, 1)).toBeNull()
  })

  it('names the monthly sum that lands exactly on a goal', () => {
    for (const s of [single, { ...couple, useAspLoan: true }]) {
      const p = plan({ interestPct: 1, bonusPct: 3 })
      const rs = [reading('2026-09-30', 1000), reading('2026-09-30', 1200, 'partner')]
      const status = savingStatus(p, s, rs, today)
      const need = 40_000
      const monthly = monthlyFor(status, p, s, need)!
      // Put it all on the one saver: the projection is linear in the deposit.
      const extra = monthly - status.monthlyTotal
      const again = savingStatus({ ...p, monthlyDeposit: p.monthlyDeposit + extra }, s, rs, today)
      expect(again.atTarget).toBeCloseTo(need, 4)
    }
  })

  it('has no monthly sum once the purchase day has passed', () => {
    const p = plan({ targetDate: '2026-01-01' })
    expect(monthlyFor(savingStatus(p, single, [], today), p, single, 10_000)).toBeNull()
  })

  it('dates the 20th ASP deposit nineteen months after the first', () => {
    expect(aspReadyMonth('2026-08')).toBe('2028-03')
    expect(aspReadyMonth('2026-01')).toBe('2027-08')
    expect(aspReadyMonth('')).toBeNull()
  })
})
