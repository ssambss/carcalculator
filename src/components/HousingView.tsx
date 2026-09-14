import { useMemo, useState } from 'react'
import {
  HORIZON_OFFSETS,
  cumulativePct,
  kindShort,
  nominalRates,
  resolveProjectionYear,
  seriesKindFor,
  type NominalRates,
  type SeriesKind,
} from '../areas'
import { HELSINKI_PRICES } from '../data/helsinkiPrices'
import {
  HOME_TYPES,
  HOUSING_CATEGORIES,
  affordability,
  householdIncome,
  householdSavings,
  propertyCost,
  type HousingSituation,
  type PropertyCost,
  type PropertyListing,
} from '../housing'
import {
  ALL_AREAS,
  NO_PROPERTY_FILTERS,
  areaFilterExists,
  listPropertyAreas,
  loadPropertySelection,
  matchesPropertyFilters,
  savePropertySelection,
  type PropertyFilters,
} from '../housingFiltering'
import { newProperty } from '../housingStorage'
import type { HousingStore } from '../useHousing'
import { fmtEur, fmtEurExact, fmtNum, fmtPct } from '../format'
import { AreaOutlook } from './AreaOutlook'
import { BreakdownBar, Legend } from './BreakdownBar'
import { LoanSchedule, type AnalysisSubject } from './LoanSchedule'
import { NumberField } from './NumberField'
import { PropertyFilterBar } from './PropertyFilterBar'
import { RentVsBuy } from './RentVsBuy'
import { PropertyForm } from './PropertyForm'

/** Why the ceiling stops where it does, in words somebody can act on. */
const LIMIT_NOTE: Record<string, string> = {
  income: 'Your monthly budget is the limit — more income or fewer other loans would raise it.',
  stress: 'The bank’s stress test is the limit — it sizes the loan at the test rate, not at yours.',
  savings: 'Your savings are the limit, not your income — the down payment and tax must be cash.',
}

interface DraftState {
  property: PropertyListing
  isNew: boolean
}

export function HousingView({ store }: { store: HousingStore }) {
  const { data } = store
  const [draft, setDraft] = useState<DraftState | null>(null)
  // Which home the analysis cards look at - one choice drives both of them.
  const [subjectId, setSubjectId] = useState<string | null>(null)

  const ceiling = useMemo(() => affordability(data.situation), [data.situation])

  const costs = useMemo(
    () =>
      new Map(
        data.properties.map((p) => [p.id, propertyCost(p, data.situation, ceiling.maxPrice)]),
      ),
    [data.properties, data.situation, ceiling.maxPrice],
  )

  const sorted = useMemo(
    () =>
      [...data.properties].sort(
        (a, b) => (costs.get(a.id)?.costPerMonth ?? 0) - (costs.get(b.id)?.costPerMonth ?? 0),
      ),
    [data.properties, costs],
  )

  const [filters, setFilters] = useState<PropertyFilters>({ ...NO_PROPERTY_FILTERS })
  const [selectedIds, setSelectedIds] = useState<Set<string>>(loadPropertySelection)

  const areaGroups = useMemo(() => listPropertyAreas(data.properties), [data.properties])

  // An area the list no longer offers - its last place deleted, or given a
  // different postal code - would otherwise hide everything with no way back
  // but Clear, so the filter falls back to all areas rather than matching
  // nothing. Kept out of state: the pick is still there if the place returns.
  const active = useMemo<PropertyFilters>(
    () => (areaFilterExists(areaGroups, filters.area) ? filters : { ...filters, area: ALL_AREAS }),
    [areaGroups, filters],
  )

  const visible = useMemo(
    () =>
      sorted.filter((p) =>
        matchesPropertyFilters(p, active, selectedIds, costs.get(p.id)?.fits ?? true),
      ),
    [sorted, active, selectedIds, costs],
  )

  // Cheapest among what is shown, like the car side: a badge on a card that
  // was filtered out would be a claim about places the reader cannot see.
  const cheapestId =
    visible.length > 1 && (costs.get(visible[0].id)?.totalPerMonth ?? 0) > 0 ? visible[0].id : null

  const fitsCount = data.properties.filter((p) => costs.get(p.id)?.fits ?? true).length

  // What the analysis cards can look at: the ceiling first, then each
  // candidate, in the order the cards show them.
  const subjects = useMemo<AnalysisSubject[]>(() => {
    const s = data.situation
    return [
      {
        id: 'ceiling',
        label: 'At the ceiling',
        price: ceiling.maxPrice,
        loan: ceiling.loan,
        cashAtClosing: ceiling.downPayment + ceiling.transferTax + s.buyingCosts,
        chargesPerMonth: s.maintenanceEstimatePerMonth,
      },
      ...sorted.map((p) => {
        const c = costs.get(p.id)
        return {
          id: p.id,
          label: p.name || 'Unnamed place',
          price: p.price,
          loan: c?.loan ?? 0,
          cashAtClosing: (c?.downPayment ?? 0) + (p.price * s.transferTaxPct) / 100 + s.buyingCosts,
          chargesPerMonth: p.maintenancePerMonth + p.financingChargePerMonth + p.otherPerMonth,
        }
      }),
    ]
  }, [ceiling, sorted, costs, data.situation])

  const addProperty = () => setDraft({ property: newProperty(), isNew: true })

  function saveProperty(p: PropertyListing) {
    store.saveProperty(p)
    setDraft(null)
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      savePropertySelection(next)
      return next
    })
  }

  function deleteProperty(p: PropertyListing) {
    if (!window.confirm(`Delete "${p.name || 'this place'}"?`)) return
    store.removeProperty(p.id)
    setSelectedIds((prev) => {
      if (!prev.has(p.id)) return prev
      const next = new Set(prev)
      next.delete(p.id)
      savePropertySelection(next)
      return next
    })
  }

  return (
    <>
      <SituationPanel situation={data.situation} onChange={store.saveSituation} />

      {store.status === 'error' && (
        <p className="field-hint field-error">Housing sync: {store.error}</p>
      )}

      <CeilingCard ceiling={ceiling} />

      <LoanSchedule
        situation={data.situation}
        subjects={subjects}
        subjectId={subjectId}
        onSelectSubject={setSubjectId}
      />

      <RentVsBuy
        situation={data.situation}
        subjects={subjects}
        subjectId={subjectId}
        onSelectSubject={setSubjectId}
        onChange={store.saveSituation}
      />

      <AreaOutlook
        situation={data.situation}
        properties={data.properties}
        onChange={store.saveSituation}
      />

      {data.properties.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-title display">No places yet</div>
          <p className="empty-text">
            Add a flat or house you are actually looking at — it gets measured against your
            ceiling and costed per month, charges and all.
          </p>
          <button className="btn btn-primary" onClick={addProperty}>
            Add your first place
          </button>
        </div>
      ) : (
        <>
          <PropertyFilterBar
            filters={active}
            onChange={setFilters}
            areas={areaGroups}
            selectedCount={selectedIds.size}
            favoriteCount={data.properties.filter((p) => p.favorite).length}
            fitsCount={fitsCount}
            overCount={data.properties.length - fitsCount}
            shownCount={visible.length}
            totalCount={data.properties.length}
          />
          {visible.length === 0 ? (
            <div className="card empty-state">
              <div className="empty-title display">No places match</div>
              <p className="empty-text">Adjust or clear the filters to see your places.</p>
              {/* Both ways out: the grid's add tile is filtered away with the
                  cards, and on a desktop the fab is not there to replace it. */}
              <div className="empty-actions">
                <button className="btn" onClick={() => setFilters({ ...NO_PROPERTY_FILTERS })}>
                  Clear filters
                </button>
                <button className="btn btn-primary" onClick={addProperty}>
                  Add place
                </button>
              </div>
            </div>
          ) : (
            <>
              <Legend
                breakdowns={visible.map((p) => costs.get(p.id)!.breakdown)}
                categories={HOUSING_CATEGORIES}
              />
              <div className="card-grid">
                {visible.map((p) => (
                  <PropertyCard
                    key={p.id}
                    property={p}
                    cost={costs.get(p.id)!}
                    cheapest={p.id === cheapestId}
                    selected={selectedIds.has(p.id)}
                    onToggleSelect={() => toggleSelected(p.id)}
                    onToggleFavorite={() => store.toggleFavorite(p.id)}
                    onEdit={() => setDraft({ property: p, isNew: false })}
                    onDelete={() => deleteProperty(p)}
                  />
                ))}
                {/* The desktop add lives here: the header has no housing buttons
                    and the fab only exists below 640px. */}
                <button className="card add-card" onClick={addProperty}>
                  <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                    <path d="M8 3v10" />
                    <path d="M3 8h10" />
                  </svg>
                  Add place
                </button>
              </div>
              <HousingTable
                properties={visible}
                costs={costs}
                ceiling={ceiling.maxPrice}
                situation={data.situation}
              />
            </>
          )}
        </>
      )}

      <button className="fab" onClick={addProperty} aria-label="Add place">
        <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <path d="M8 3v10" />
          <path d="M3 8h10" />
        </svg>
      </button>

      {draft && (
        <PropertyForm
          initial={draft.property}
          isNew={draft.isNew}
          onSave={saveProperty}
          onCancel={() => setDraft(null)}
        />
      )}
    </>
  )
}

/* ---------------------------------------------------------------- situation */

function SituationPanel({
  situation,
  onChange,
}: {
  situation: HousingSituation
  onChange: (s: HousingSituation) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const set = (patch: Partial<HousingSituation>) => onChange({ ...situation, ...patch })

  // The collapsed line shows what the maths actually uses: household totals.
  const summary = `${fmtNum(householdIncome(situation))} €/mo net · ${fmtNum(householdSavings(situation))} € saved · ${fmtNum(situation.ratePct)} % / ${fmtNum(situation.termYears)} yrs${situation.buyingTogether ? ' · two borrowers' : ''}`

  return (
    <div className={`card assumptions housing-panel${expanded ? ' expanded' : ''}`}>
      <div className="assumptions-heading">
        <div className="assumptions-title">Your situation</div>
        <div className="assumptions-caption">what the ceiling is computed from</div>
      </div>
      <div className="assumptions-summary">
        <span className="assumptions-summary-text">{summary}</span>
        <button className="assumptions-toggle" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Done' : 'Edit'}
        </button>
      </div>
      <div className="assumptions-fields">
        <NumberField
          compact
          label="Net income"
          value={situation.netIncomePerMonth}
          onChange={(n) => set({ netIncomePerMonth: Math.max(0, n) })}
          unit="€/mo"
        />
        <NumberField
          compact
          label="Other loans"
          value={situation.otherLoanPaymentsPerMonth}
          onChange={(n) => set({ otherLoanPaymentsPerMonth: Math.max(0, n) })}
          unit="€/mo"
          hint="what you pay per month — not the balance owed"
        />
        <NumberField
          compact
          label="Savings"
          value={situation.savings}
          onChange={(n) => set({ savings: Math.max(0, n) })}
          unit="€"
        />
        <NumberField
          compact
          label="Housing share"
          value={situation.housingSharePct}
          onChange={(n) => set({ housingSharePct: Math.min(100, Math.max(0, n)) })}
          unit="% of net"
        />
        <NumberField
          compact
          label="Interest"
          value={situation.ratePct}
          onChange={(n) => set({ ratePct: Math.max(0, n) })}
          unit="%/yr"
        />
        <NumberField
          compact
          label="Loan term"
          value={situation.termYears}
          onChange={(n) => set({ termYears: Math.max(1, n) })}
          unit="years"
        />
        <NumberField
          compact
          label="Maintenance guess"
          value={situation.maintenanceEstimatePerMonth}
          onChange={(n) => set({ maintenanceEstimatePerMonth: Math.max(0, n) })}
          unit="€/mo"
        />
      </div>

      <div className="assumptions-heading">
        <div className="assumptions-title">Buying together</div>
        <div className="assumptions-caption">a second borrower on the same loan</div>
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          checked={situation.buyingTogether}
          onChange={(e) => set({ buyingTogether: e.target.checked })}
        />
        <span>
          Add a second borrower
          <span className="check-hint">
            Their income raises the monthly budget and their savings the cash — the
            bank sizes one household. If you are both ASP savers, the ASP cap rises
            too: set the higher figure in the ASP section.
          </span>
        </span>
      </label>
      {situation.buyingTogether && (
        <div className="assumptions-fields">
          <NumberField
            compact
            label="Their net income"
            value={situation.partnerNetIncomePerMonth}
            onChange={(n) => set({ partnerNetIncomePerMonth: Math.max(0, n) })}
            unit="€/mo"
          />
          <NumberField
            compact
            label="Their other loans"
            value={situation.partnerOtherLoanPaymentsPerMonth}
            onChange={(n) => set({ partnerOtherLoanPaymentsPerMonth: Math.max(0, n) })}
            unit="€/mo"
            hint="payments per month, not the balance"
          />
          <NumberField
            compact
            label="Their savings"
            value={situation.partnerSavings}
            onChange={(n) => set({ partnerSavings: Math.max(0, n) })}
            unit="€"
          />
        </div>
      )}

      {/*
        ASP is a financing choice, not a fact about the buyer: the loan is ASP
        up to the municipal cap, and whatever the cap cannot cover becomes a
        regular mortgage on top. The subsidy above 3.8 % is documented as not
        modeled in housing.ts.
      */}
      <div className="assumptions-heading">
        <div className="assumptions-title">ASP loan</div>
        <div className="assumptions-caption">first-home scheme — cheaper, but capped</div>
      </div>
      <label className="check-row asp-toggle">
        <input
          type="checkbox"
          checked={situation.useAspLoan}
          onChange={(e) => set({ useAspLoan: e.target.checked })}
        />
        <span>
          Finance with an ASP loan
          <span className="check-hint">
            ASP up to the cap, the rest as a regular loan on top. Caps from 6/2026:
            Helsinki, Espoo, Vantaa, Kauniainen, Tampere, Turku and Oulu 230 000 €,
            elsewhere 160 000 € — and two ASP savers together get 345 000 € /
            240 000 €. Check the current ones.
          </span>
        </span>
      </label>
      {situation.useAspLoan && (
        <div className="assumptions-fields">
          <NumberField
            compact
            label="ASP interest"
            value={situation.aspRatePct}
            onChange={(n) => set({ aspRatePct: Math.max(0, n) })}
            unit="%/yr"
          />
          <NumberField
            compact
            label="ASP loan cap"
            value={situation.aspMaxLoan}
            onChange={(n) => set({ aspMaxLoan: Math.max(0, n) })}
            unit="€"
            hint={
              situation.buyingTogether
                ? 'two ASP savers together: 345 000 € in the big cities, 240 000 € elsewhere'
                : undefined
            }
          />
        </div>
      )}

      {/*
        The rules banks and the taxman apply, not facts this app knows: the
        stress rate is supervisory practice, the LTV cap and transfer tax are
        law that changes. Defaults are the common case - check the current
        rules before trusting a decision to them.
      */}
      <div className="assumptions-heading">
        <div className="assumptions-title">The rules</div>
        <div className="assumptions-caption">bank and tax practice — check the current ones</div>
      </div>
      <div className="assumptions-fields">
        <NumberField
          compact
          label="Stress rate"
          value={situation.stressRatePct}
          onChange={(n) => set({ stressRatePct: Math.max(0, n) })}
          unit="%/yr"
        />
        <NumberField
          compact
          label="Min. cash share"
          value={situation.minDownPaymentPct}
          onChange={(n) => set({ minDownPaymentPct: Math.min(100, Math.max(0, n)) })}
          unit="%"
          hint={
            situation.useAspLoan
              ? 'the decided 4/2026 reform: 5 % — banks apply 10 % until it lands, so type 10 for a purchase before then'
              : 'the loan cap allows 5 % since 6/2026 — your bank may still want more'
          }
        />
        <NumberField
          compact
          label="Transfer tax"
          value={situation.transferTaxPct}
          onChange={(n) => set({ transferTaxPct: Math.max(0, n) })}
          unit="%"
        />
        <NumberField
          compact
          label="Buying costs"
          value={situation.buyingCosts}
          onChange={(n) => set({ buyingCosts: Math.max(0, n) })}
          unit="€"
        />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ ceiling */

function CeilingCard({ ceiling }: { ceiling: ReturnType<typeof affordability> }) {
  // A zero budget is nearly always a typo, not a fact about the household -
  // the classic being a loan's total balance typed into the €/mo field. Say
  // that outright instead of letting the generic note imply low income.
  const note =
    ceiling.paymentBudget <= 0
      ? 'Your monthly budget is zero — other loans and the maintenance estimate use up ' +
        'the whole housing share, so only savings count. Check that "Other loans" holds ' +
        'the monthly payments, not the balance owed.'
      : LIMIT_NOTE[ceiling.limitedBy]
  return (
    <div className="card ceiling-card">
      <div className="ceiling-label">You could afford up to</div>
      <div className="hero-row">
        <div>
          <span className="hero-value display">{fmtEur(ceiling.maxPrice)}</span>
        </div>
      </div>
      <p className="ceiling-note">{note}</p>
      {ceiling.maxPrice > 0 && (
        <div className="stat-row">
          {ceiling.aspLoan > 0 && ceiling.regularLoan > 0 ? (
            <>
              <div className="stat">
                <span className="stat-label">ASP loan</span>
                <span className="stat-value">{fmtEur(ceiling.aspLoan)}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Regular on top</span>
                <span className="stat-value">{fmtEur(ceiling.regularLoan)}</span>
              </div>
            </>
          ) : (
            <div className="stat">
              <span className="stat-label">{ceiling.aspLoan > 0 ? 'Loan (all ASP)' : 'Loan'}</span>
              <span className="stat-value">{fmtEur(ceiling.loan)}</span>
            </div>
          )}
          <div className="stat">
            <span className="stat-label">Down payment</span>
            <span className="stat-value">{fmtEur(ceiling.downPayment)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Transfer tax</span>
            <span className="stat-value">{fmtEur(ceiling.transferTax)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Budget / mo</span>
            <span className="stat-value">{fmtEur(ceiling.paymentBudget)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Payment / mo</span>
            <span className="stat-value">{fmtEurExact(ceiling.paymentAtRate)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Under stress / mo</span>
            <span className="stat-value">{fmtEurExact(ceiling.paymentAtStress)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- the cards */

/** "Flat · 2 rooms", "Terraced house" - what the place has said it is. */
function homeChip(p: PropertyListing): string {
  const label = HOME_TYPES.find((t) => t.key === p.homeType)?.label ?? ''
  return p.rooms > 0 ? `${label} · ${p.rooms} ${p.rooms === 1 ? 'room' : 'rooms'}` : label
}

function PropertyCard({
  property: p,
  cost,
  cheapest,
  selected,
  onToggleSelect,
  onToggleFavorite,
  onEdit,
  onDelete,
}: {
  property: PropertyListing
  cost: PropertyCost
  cheapest: boolean
  selected: boolean
  onToggleSelect: () => void
  onToggleFavorite: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className={`card car-card${selected ? ' selected' : ''}`}>
      <div className="car-card-head">
        <label className="select-box" title="Select for comparison">
          <input type="checkbox" checked={selected} onChange={onToggleSelect} />
        </label>
        <div className="car-name display">{p.name || 'Unnamed place'}</div>
        <button
          className={`fav-btn${p.favorite ? ' active' : ''}`}
          onClick={onToggleFavorite}
          aria-pressed={p.favorite}
          aria-label={p.favorite ? 'Remove from favorites' : 'Add to favorites'}
          title={p.favorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 16 16"
            fill={p.favorite ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          >
            <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.2L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
          </svg>
        </button>
        {p.homeType && <span className="chip">{homeChip(p)}</span>}
        <span className={`chip${cost.fits ? '' : ' chip-over'}`}>
          {cost.fits ? 'within reach' : 'over the ceiling'}
        </span>
      </div>

      <div className="hero-row">
        <div>
          <span className="hero-value display">{fmtEur(cost.totalPerMonth)}</span>
          <span className="hero-unit">/mo</span>
        </div>
        {cheapest && (
          <span className="badge-good">
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2 6.5l2.5 2.5L10 3.5" />
            </svg>
            Lowest cost
          </span>
        )}
      </div>

      <div className="stat-row">
        <div className="stat">
          <span className="stat-label">Price</span>
          <span className="stat-value">{fmtEur(p.price)}</span>
        </div>
        {cost.pricePerM2 !== null && (
          <div className="stat">
            <span className="stat-label">Per m²</span>
            <span className="stat-value">{fmtEur(cost.pricePerM2)}</span>
          </div>
        )}
        {cost.aspLoan > 0 && cost.regularLoan > 0 ? (
          <>
            <div className="stat">
              <span className="stat-label">ASP loan</span>
              <span className="stat-value">{fmtEur(cost.aspLoan)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Regular on top</span>
              <span className="stat-value">{fmtEur(cost.regularLoan)}</span>
            </div>
          </>
        ) : (
          <div className="stat">
            <span className="stat-label">{cost.aspLoan > 0 ? 'Loan (all ASP)' : 'Loan'}</span>
            <span className="stat-value">{fmtEur(cost.loan)}</span>
          </div>
        )}
        <div className="stat">
          <span className="stat-label">Cost / mo</span>
          <span className="stat-value">{fmtEur(cost.costPerMonth)}</span>
        </div>
      </div>

      <BreakdownBar
        breakdown={cost.breakdown}
        total={cost.totalPerMonth}
        categories={HOUSING_CATEGORIES}
      />

      {p.notes && <div className="car-notes">{p.notes}</div>}

      <div className="car-actions">
        <button className="link-btn" onClick={onEdit}>
          Edit
        </button>
        <button className="link-btn danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- the table */

/** The series a place is read against: what it says it is, or all flats until it says. */
const seriesOf = (p: PropertyListing): SeriesKind | null =>
  p.homeType ? seriesKindFor(p.homeType, p.rooms) : 'flats'

/**
 * Which series the area's own trend was read from, and - when it says nothing
 * - why: a kind the data does not cover, none published, a series that stopped
 * years ago, or one too thin for a ten-year figure.
 */
function trendNote(r: NominalRates): string {
  if (!r.area) return 'no postal code'
  if (r.kind === null) return 'detached · not in the data'
  const k = kindShort(r.kind)
  if (r.latestYear === null) return `${k} · none published`
  if (r.stale) return `${k} · stops at ${r.latestYear}`
  if (r.trendPct === null || r.trendYears === null) return `${k} · too few years`
  return `${k} · ${r.trendYears} yrs to ${r.latestYear}`
}

function HousingTable({
  properties,
  costs,
  ceiling,
  situation,
}: {
  properties: PropertyListing[]
  costs: Map<string, PropertyCost>
  ceiling: number
  situation: HousingSituation
}) {
  const data = HELSINKI_PRICES
  const latestYear = data.years[data.years.length - 1]
  const targetYear = resolveProjectionYear(situation.projectionYear, latestYear)
  // The asking prices are today's, so the horizons are counted from today -
  // the same reckoning "Your places, priced forward" uses.
  const yearsFromNow = Math.max(0, targetYear - new Date().getFullYear())

  const list = properties.map((p) => ({
    p,
    c: costs.get(p.id)!,
    r: nominalRates(data, p.postalCode, seriesOf(p)),
  }))
  // The reader's own guess, the figure rent-or-buy runs on. One number for
  // every place, so it is said once per row - in the label, where the two
  // area figures in the cells can be read against it - not five times over.
  const guess = situation.homeValueGrowthPct
  const since = data.index.years[0]
  const highlight = list.length > 1

  function minClass(values: number[], i: number): string {
    if (!highlight) return ''
    return values[i] === Math.min(...values) ? ' min' : ''
  }

  const visibleCategories = HOUSING_CATEGORIES.filter((cat) =>
    list.some(({ c }) => c.breakdown[cat.key] > 0),
  )
  const anyAsp = list.some(({ c }) => c.aspLoan > 0)

  return (
    <div className="card cmp-card">
      <div className="cmp-head">
        <div className="cmp-title display">Side by side</div>
        <div className="cmp-caption">
          per month, first year
          {/* "lowest cost", not "lowest in each row": the growth rows below
              are deliberately unmarked, and the lowest growth is no prize. */}
          {highlight ? ' · lowest cost in each row highlighted' : ''}
        </div>
      </div>
      <div className="cmp-scroll">
        <table className="cmp">
          <thead>
            <tr>
              <th className="rowhead">Cost</th>
              {list.map(({ p }) => (
                <th key={p.id}>{p.name || 'Unnamed place'}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th className="rowhead">Asking price</th>
              {list.map(({ p }, i) => (
                <td
                  key={p.id}
                  className={`num${minClass(
                    list.map((x) => x.p.price),
                    i,
                  )}`}
                >
                  {fmtEur(p.price)}
                </td>
              ))}
            </tr>
            <tr>
              <th className="rowhead">Against the ceiling</th>
              {list.map(({ p, c }) => (
                <td key={p.id} className={`num${c.fits ? '' : ' over-ceiling'}`}>
                  {c.fits
                    ? `${fmtEur(ceiling - p.price)} under`
                    : `${fmtEur(p.price - ceiling)} over`}
                </td>
              ))}
            </tr>
            <tr>
              <th className="rowhead">Per m²</th>
              {list.map(({ p, c }, i) =>
                c.pricePerM2 === null ? (
                  <td key={p.id} className="num muted">
                    —
                  </td>
                ) : (
                  <td
                    key={p.id}
                    className={`num${minClass(
                      list.map((x) => x.c.pricePerM2 ?? Number.POSITIVE_INFINITY),
                      i,
                    )}`}
                  >
                    {fmtEur(c.pricePerM2)}
                  </td>
                ),
              )}
            </tr>
            <tr>
              <th className="rowhead">Loan needed</th>
              {list.map(({ p, c }, i) => (
                <td
                  key={p.id}
                  className={`num${minClass(
                    list.map((x) => x.c.loan),
                    i,
                  )}`}
                >
                  {fmtEur(c.loan)}
                </td>
              ))}
            </tr>
            {anyAsp && (
              <tr>
                <th className="rowhead">of which ASP</th>
                {list.map(({ p, c }) => (
                  <td key={p.id} className={`num${c.aspLoan > 0 ? '' : ' muted'}`}>
                    {c.aspLoan > 0 ? fmtEur(c.aspLoan) : '—'}
                  </td>
                ))}
              </tr>
            )}
            {anyAsp && (
              <tr>
                <th className="rowhead">Regular loan on top</th>
                {list.map(({ p, c }) => (
                  <td key={p.id} className={`num${c.regularLoan > 0 ? '' : ' muted'}`}>
                    {c.regularLoan > 0 ? fmtEur(c.regularLoan) : c.loan > 0 ? 'fits in ASP' : '—'}
                  </td>
                ))}
              </tr>
            )}
            {visibleCategories.map((cat) => {
              const values = list.map(({ c }) => c.breakdown[cat.key])
              return (
                <tr key={cat.key}>
                  <th className="rowhead">
                    <span className="swatch" style={{ background: `var(--series-${cat.series})` }} />
                    {cat.label}
                  </th>
                  {list.map(({ p }, i) => (
                    <td key={p.id} className={`num${minClass(values, i)}`}>
                      {fmtEurExact(values[i])}
                    </td>
                  ))}
                </tr>
              )
            })}
            <tr className="total-row">
              <th className="rowhead">Total / mo</th>
              {list.map(({ p, c }, i) => (
                <td
                  key={p.id}
                  className={`num${minClass(
                    list.map((x) => x.c.totalPerMonth),
                    i,
                  )}`}
                >
                  {fmtEur(c.totalPerMonth)}
                </td>
              ))}
            </tr>
            <tr>
              <th className="rowhead">Cost / mo (excl. principal)</th>
              {list.map(({ p, c }, i) => (
                <td
                  key={p.id}
                  className={`num${minClass(
                    list.map((x) => x.c.costPerMonth),
                    i,
                  )}`}
                >
                  {fmtEur(c.costPerMonth)}
                </td>
              ))}
            </tr>
            {/*
              Where the value might go, as an index rather than a price. Two
              rates per place, then what each compounds to at the three
              horizons the rest of the housing side uses. Nothing here is
              highlighted: these are not costs, and marking the lowest growth
              as the winner would be exactly the wrong reading.

              Shown even when not one place has an area yet. Hiding the block
              until a postal code arrives made a feature that is merely
              unfilled look absent - the cells say "no postal code" and the
              note below says where to type one, which is the difference
              between an empty answer and no question.
            */}
            {list.length > 0 && (
              <>
                <tr className="cmp-group">
                  <th colSpan={list.length + 1}>
                    Projected value, nominal index
                    <span className="cmp-group-note">your guess {fmtPct(guess)}/yr</span>
                  </th>
                </tr>
                <tr>
                  <th className="rowhead">Zone’s long run</th>
                  {list.map(({ p, r }) => (
                    <td key={p.id} className={`num${r.longRunPct === null ? ' muted' : ''}`}>
                      {r.longRunPct === null ? '—' : `${fmtPct(r.longRunPct)}/yr`}
                      <br />
                      <span className="cell-note">
                        {r.area ? `zone ${r.area.zone} · since ${since}` : 'no postal code'}
                      </span>
                    </td>
                  ))}
                </tr>
                <tr>
                  <th className="rowhead">Area’s own trend</th>
                  {list.map(({ p, r }) => (
                    <td key={p.id} className={`num${r.trendPct === null ? ' muted' : ''}`}>
                      {r.trendPct === null ? '—' : `${fmtPct(r.trendPct)}/yr`}
                      <br />
                      <span className="cell-note">{trendNote(r)}</span>
                    </td>
                  ))}
                </tr>
                {HORIZON_OFFSETS.map((offset, i) => (
                  <tr key={offset}>
                    <th className="rowhead">
                      {i === 0 ? 'At purchase' : `+${offset} years`}{' '}
                      <span className="cmp-horizon">{targetYear + offset}</span>
                      <br />
                      <span className="cell-note">
                        your guess {fmtPct(cumulativePct(guess, yearsFromNow + offset))}
                      </span>
                    </th>
                    {list.map(({ p, r }) => (
                      <td key={p.id} className={`num${r.longRunPct === null ? ' muted' : ''}`}>
                        {r.longRunPct === null
                          ? '—'
                          : fmtPct(cumulativePct(r.longRunPct, yearsFromNow + offset))}
                        <br />
                        <span className="cell-note">
                          {r.trendPct === null
                            ? '—'
                            : fmtPct(cumulativePct(r.trendPct, yearsFromNow + offset))}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>
      {list.length > 0 && (
        <p className="chart-note">
          The projection is an index, not a price: today is 100, so “+36 %” means a value 36 %
          higher in nominal euros — before inflation, and said about the area rather than about
          this particular flat, whose asking price above is untouched by it. The top figure
          compounds Statistics Finland’s nominal price index for the place’s whole price zone at
          its average yearly change since {since}; under it, the area’s own last ten years of
          realised €/m² for the kind of home the place says it is — a flat by its rooms, a
          terraced house as its own series, all flats until it says (Edit → Type). The row label
          carries what your own guess ({fmtPct(guess)}/yr, the figure rent-or-buy runs on)
          compounds to over the same years — one number for every place, so it is said once,
          where both area figures can be read against it. The two disagreeing is the point, and
          none of the three is a forecast. A detached house is not in these
          statistics at all — they cover housing companies — so only the zone index applies to
          it. Change the purchase year in “Helsinki by area”.
          {list.some(({ r }) => r.area === null) && (
            <>
              {' '}
              A place reads “—” until it carries a Helsinki postal code (Edit → Postal code) —
              the price data covers Helsinki and nowhere else.
            </>
          )}
        </p>
      )}
    </div>
  )
}
