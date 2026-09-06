import { useMemo, useState } from 'react'
import {
  HOUSING_CATEGORIES,
  affordability,
  householdIncome,
  householdSavings,
  propertyCost,
  type HousingSituation,
  type PropertyCost,
  type PropertyListing,
} from '../housing'
import { newProperty } from '../housingStorage'
import type { HousingStore } from '../useHousing'
import { fmtEur, fmtEurExact, fmtNum } from '../format'
import { BreakdownBar, Legend } from './BreakdownBar'
import { NumberField } from './NumberField'
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

  const cheapestId =
    sorted.length > 1 && (costs.get(sorted[0].id)?.totalPerMonth ?? 0) > 0 ? sorted[0].id : null

  const addProperty = () => setDraft({ property: newProperty(), isNew: true })

  function saveProperty(p: PropertyListing) {
    store.saveProperty(p)
    setDraft(null)
  }

  function deleteProperty(p: PropertyListing) {
    if (!window.confirm(`Delete "${p.name || 'this place'}"?`)) return
    store.removeProperty(p.id)
  }

  return (
    <>
      <SituationPanel situation={data.situation} onChange={store.saveSituation} />

      {store.status === 'error' && (
        <p className="field-hint field-error">Housing sync: {store.error}</p>
      )}

      <CeilingCard ceiling={ceiling} />

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
          <Legend
            breakdowns={sorted.map((p) => costs.get(p.id)!.breakdown)}
            categories={HOUSING_CATEGORIES}
          />
          <div className="card-grid">
            {sorted.map((p) => (
              <PropertyCard
                key={p.id}
                property={p}
                cost={costs.get(p.id)!}
                cheapest={p.id === cheapestId}
                onToggleFavorite={() => store.toggleFavorite(p.id)}
                onEdit={() => setDraft({ property: p, isNew: false })}
                onDelete={() => deleteProperty(p)}
              />
            ))}
          </div>
          <HousingTable properties={sorted} costs={costs} ceiling={ceiling.maxPrice} />
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
            bank sizes one household. The ASP cap stays per home, not per buyer.
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
            ASP up to the cap, the rest as a regular loan on top. Caps are per
            municipality (Helsinki 230 000 €, Espoo/Vantaa 185 000 €, Tampere/Turku
            160 000 €, elsewhere 140 000 €) — check the current ones.
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
  return (
    <div className="card ceiling-card">
      <div className="ceiling-label">You could afford up to</div>
      <div className="hero-row">
        <div>
          <span className="hero-value display">{fmtEur(ceiling.maxPrice)}</span>
        </div>
      </div>
      <p className="ceiling-note">{LIMIT_NOTE[ceiling.limitedBy]}</p>
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

function PropertyCard({
  property: p,
  cost,
  cheapest,
  onToggleFavorite,
  onEdit,
  onDelete,
}: {
  property: PropertyListing
  cost: PropertyCost
  cheapest: boolean
  onToggleFavorite: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="card car-card">
      <div className="car-card-head">
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

function HousingTable({
  properties,
  costs,
  ceiling,
}: {
  properties: PropertyListing[]
  costs: Map<string, PropertyCost>
  ceiling: number
}) {
  const list = properties.map((p) => ({ p, c: costs.get(p.id)! }))
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
          per month, first year{highlight ? ' · lowest in each row highlighted' : ''}
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
          </tbody>
        </table>
      </div>
    </div>
  )
}
