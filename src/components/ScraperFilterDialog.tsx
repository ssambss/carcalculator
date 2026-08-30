import { useEffect, useState } from 'react'
import {
  type ScraperFilter,
  describeFilter,
  filterTitle,
  isRunnable,
  newScraperFilter,
  parseFilterJson,
  parseNettiautoUrl,
  toWire,
} from '../scraperFilters'
import {
  NETTIAUTO_FIELDS,
  rangeInputs,
  rangeValue,
  withRange,
} from '../listingFields'
import type { ScraperFilterStore } from '../useScraperFilters'
import { ChipInput } from './ChipInput'

interface Props {
  store: ScraperFilterStore
  /** whether GitHub sync is connected — without it the watcher never sees these */
  connected: boolean
  onClose: () => void
}

const STATUS_LABEL: Record<ScraperFilterStore['status'], string> = {
  off: 'Not synced',
  syncing: 'Syncing…',
  synced: 'Synced to the watcher',
  error: 'Sync error',
}

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <path d="M5 5l10 10" />
    <path d="M15 5L5 15" />
  </svg>
)

export function ScraperFilterDialog({ store, connected, onClose }: Props) {
  const [draft, setDraft] = useState<{ filter: ScraperFilter; isNew: boolean } | null>(null)
  const [json, setJson] = useState<string | null>(null)
  const [jsonError, setJsonError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Escape backs out of the editor first, then out of the dialog.
      if (e.key !== 'Escape') return
      if (draft) setDraft(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [draft, onClose])

  const filters = store.set.filters

  function addPasted() {
    try {
      const pasted = parseFilterJson(json ?? '')
      store.saveMany(pasted)
      setJson(null)
      setJsonError('')
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : 'Could not read that JSON.')
    }
  }

  async function copyAll() {
    // Through toWire, so the copied text is valid scraper/filters.json for an
    // older checkout too.
    const text = JSON.stringify(filters.map(toWire), null, 2)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copy the filter JSON:', text)
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-head">
          <div className="modal-title display">
            {draft ? (draft.isNew ? 'New filter' : 'Edit filter') : 'Scraper filters'}
          </div>
          <button className="modal-close" onClick={draft ? () => setDraft(null) : onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        {draft ? (
          <FilterEditor
            filter={draft.filter}
            isNew={draft.isNew}
            onSave={(filter) => {
              store.save(filter)
              setDraft(null)
            }}
            onDelete={() => {
              if (!window.confirm(`Delete the filter "${filterTitle(draft.filter)}"?`)) return
              store.remove(draft.filter.id)
              setDraft(null)
            }}
            onCancel={() => setDraft(null)}
          />
        ) : (
          <>
            <p className="dialog-text">
              The watcher checks nettiauto every 30 minutes and posts new matches to
              Discord — one filter is one saved search. React to a post there and the car
              lands in this calculator.
            </p>

            {connected ? (
              <div className="preview-row">
                <span className="preview-main display">{STATUS_LABEL[store.status]}</span>
                {store.status === 'error' && <span className="preview-side">· {store.error}</span>}
                {store.status !== 'syncing' && (
                  <button className="inline-link" onClick={store.syncNow}>
                    Sync now
                  </button>
                )}
              </div>
            ) : (
              <p className="dialog-text field-error">
                These filters live in this browser until GitHub sync is connected — the
                watcher reads them from your gist. Connect it with the cloud button in the
                header.
              </p>
            )}

            {json !== null && (
              <div className="field">
                <span className="field-label">Filter JSON</span>
                <textarea
                  className="json-box"
                  value={json}
                  spellCheck={false}
                  autoFocus
                  placeholder={'[{ "name": "Polestar 2", "make": "polestar", "model": "2" }]'}
                  onChange={(e) => setJson(e.target.value)}
                />
                {jsonError && <span className="field-hint field-error">{jsonError}</span>}
                <span className="field-hint">
                  One filter, a list of them, or the contents of{' '}
                  <code>scraper/filters.json</code>. An <code>id</code> in the text is kept, so
                  a filter carries on with the posting history the watcher already has for it.
                </span>
                <div className="filter-tools">
                  <button className="inline-link" onClick={() => setJson(null)}>
                    Cancel
                  </button>
                  <button className="btn btn-primary" onClick={addPasted} disabled={!json.trim()}>
                    Add from JSON
                  </button>
                </div>
              </div>
            )}

            {filters.length === 0 ? (
              <div className="empty-state">
                <div className="empty-title display">No filters yet</div>
                <p className="empty-text">
                  Add one and the watcher starts reporting the cars that match it.
                </p>
              </div>
            ) : (
              <div className="filter-list">
                {filters.map((filter) => (
                  <div className={`filter-row${filter.enabled ? '' : ' off'}`} key={filter.id}>
                    <label className="filter-row-switch">
                      <input
                        type="checkbox"
                        checked={filter.enabled}
                        onChange={() => store.toggle(filter.id)}
                        aria-label={`${filter.enabled ? 'Pause' : 'Resume'} ${filterTitle(filter)}`}
                      />
                    </label>
                    <button
                      className="filter-row-body"
                      onClick={() => setDraft({ filter, isNew: false })}
                    >
                      <span className="filter-row-name">
                        {filterTitle(filter)}
                        {!filter.enabled && <span className="filter-row-tag">paused</span>}
                        {!isRunnable(filter) && (
                          <span className="filter-row-tag warn">needs a make and model</span>
                        )}
                      </span>
                      <span className="filter-row-summary">{describeFilter(filter)}</span>
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="filter-tools">
              {json === null && (
                <button
                  className="inline-link"
                  onClick={() => {
                    setJson('')
                    setJsonError('')
                  }}
                >
                  Paste JSON
                </button>
              )}
              {filters.length > 0 && (
                <button className="inline-link" onClick={copyAll}>
                  {copied ? 'Copied!' : 'Copy all as JSON'}
                </button>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn" onClick={onClose}>
                Done
              </button>
              <button
                className="btn btn-primary"
                onClick={() => setDraft({ filter: newScraperFilter(), isNew: true })}
              >
                New filter
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

interface EditorProps {
  filter: ScraperFilter
  isNew: boolean
  onSave: (filter: ScraperFilter) => void
  onDelete: () => void
  onCancel: () => void
}

function FilterEditor({ filter, isNew, onSave, onDelete, onCancel }: EditorProps) {
  const [draft, setDraft] = useState<ScraperFilter>(filter)
  const set = (patch: Partial<ScraperFilter>) => setDraft((d) => ({ ...d, ...patch }))

  /** Accept a pasted nettiauto address in either box and split it up. */
  function setPathPart(part: 'make' | 'model', raw: string) {
    const parsed = raw.includes('/') ? parseNettiautoUrl(raw) : null
    if (parsed) set(parsed)
    else set({ [part]: raw.trim().toLowerCase().replace(/\s+/g, '-') } as Partial<ScraperFilter>)
  }

  const runnable = isRunnable(draft)

  return (
    <>
      <div className="form-section">
        <div className="section-title">Which listing page</div>
        <div className="form-grid">
          <label className="field span-2">
            <span className="field-label">Name</span>
            <span className="field-input-wrap">
              <input
                type="text"
                value={draft.name}
                placeholder="e.g. Polestar 2 LR DM"
                onChange={(e) => set({ name: e.target.value })}
                autoFocus={isNew}
              />
            </span>
            <span className="field-hint">Shown on every Discord post this filter makes.</span>
          </label>
          <label className="field">
            <span className="field-label">Make</span>
            <span className="field-input-wrap">
              <input
                type="text"
                value={draft.make}
                placeholder="polestar"
                onChange={(e) => setPathPart('make', e.target.value)}
              />
            </span>
          </label>
          <label className="field">
            <span className="field-label">Model</span>
            <span className="field-input-wrap">
              <input
                type="text"
                value={draft.model}
                placeholder="2"
                onChange={(e) => setPathPart('model', e.target.value)}
              />
            </span>
          </label>
          <div className="field span-2">
            <span className="field-hint">
              {runnable ? (
                <>
                  Reads{' '}
                  <a
                    href={`https://www.nettiauto.com/${draft.make}/${draft.model}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    nettiauto.com/{draft.make}/{draft.model} ↗
                  </a>{' '}
                  — or paste any nettiauto link into either box.
                </>
              ) : (
                'Paste any nettiauto link into either box and it fills both.'
              )}
            </span>
          </div>
        </div>
      </div>

      <div className="form-section">
        <div className="section-title">Limits</div>
        {/*
          Generated from the source's field declarations rather than written
          out. A source that carries square metres and a room count instead of
          years and kilometres gets the right form with no change here - which
          is the whole point of the range bag.
        */}
        <div className="form-grid">
          {rangeInputs(NETTIAUTO_FIELDS).map(({ field, side, label }) => (
            <LimitField
              key={`${field.key}.${side}`}
              label={label}
              value={rangeValue(draft.ranges, field.key, side)}
              unit={field.unit}
              hint={side === 'min' ? field.hint : undefined}
              onChange={(v) => set({ ranges: withRange(draft.ranges, field.key, side, v) })}
            />
          ))}
        </div>
      </div>

      <div className="form-section">
        <div className="section-title">What the advert has to say</div>
        <ChipInput
          label="Variant name must include"
          value={draft.variantMust}
          onChange={(variantMust) => set({ variantMust })}
          suggestions={['long range', 'dual motor', 'neliveto', 'automaatti']}
          hint="Matched against the model name and the spec chips only — short, reliable text."
        />
        <ChipInput
          label="Variant name must not include"
          value={draft.variantMustNot}
          onChange={(variantMustNot) => set({ variantMustNot })}
          suggestions={['single motor', 'standard range', 'etuveto', 'manuaali']}
        />
        <ChipInput
          label="Anywhere in the advert"
          value={draft.textMust}
          onChange={(textMust) => set({ textMust })}
          suggestions={['vetokoukku', 'lasikatto', 'peruutuskamera']}
          hint="Includes the seller's own description, so equipment can be found here."
        />
        <ChipInput
          label="Never anywhere in the advert"
          value={draft.textMustNot}
          onChange={(textMustNot) => set({ textMustNot })}
          suggestions={['kolarikorjattu', 'vaurioitunut', 'moottorivika']}
        />
      </div>

      <div className="form-section">
        <div className="section-title">Option packages</div>
        <ChipInput
          label="Required packages"
          value={draft.packages}
          onChange={(packages) => set({ packages })}
          suggestions={['pilot', 'plus', 'performance']}
          hint="For packages named only in the seller's free text, and counted only where that text reads as a package rather than a passing mention. A trim name that rides along in the model name — BMW's M Sport, say — belongs under variant name above instead."
        />
        {draft.packages.length > 0 && (
          <>
            <div className="segmented">
              <button
                className={draft.packageEvidence === 'strong' ? 'active' : ''}
                onClick={() => set({ packageEvidence: 'strong' })}
              >
                Strong evidence
              </button>
              <button
                className={draft.packageEvidence === 'weak' ? 'active' : ''}
                onClick={() => set({ packageEvidence: 'weak' })}
              >
                Any mention
              </button>
            </div>
            <span className="field-hint">
              Strong wants the package name next to a <em>paketti</em>/<em>pack</em>/
              <em>varuste</em> word, or paired with another required package — the way
              sellers actually write them. Any mention accepts the bare word, and finds more
              cars with less certainty.
            </span>
            <label className="check-row">
              <input
                type="checkbox"
                checked={draft.acceptLesserPackages}
                onChange={(e) => set({ acceptLesserPackages: e.target.checked })}
              />
              <span>
                Accept the smaller version of a package
                <span className="check-hint">
                  Pilot Lite counts as Pilot. Off by default: it is a separate, cheaper
                  option.
                </span>
              </span>
            </label>
          </>
        )}
      </div>

      <details className="form-section advanced">
        <summary className="section-title">Advanced</summary>

        <label className="check-row">
          <input
            type="checkbox"
            checked={draft.postExisting}
            onChange={(e) => set({ postExisting: e.target.checked })}
          />
          <span>
            Post the cars already on sale when this filter starts
            <span className="check-hint">
              On, you see the current market once (at most 20 posts per run, the rest
              follow). Off, the filter stays quiet until something new appears.
            </span>
          </span>
        </label>

        <label className="check-row">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => set({ enabled: e.target.checked })}
          />
          <span>
            Active
            <span className="check-hint">
              Pausing keeps the filter and its history, but the watcher skips it.
            </span>
          </span>
        </label>

        <div className="field">
          <span className="field-label">Inference rules</span>
          <span className="field-hint">
            “Seeing A proves B”, for facts about the car the seller left implicit: on a
            Polestar 2, <em>Neliveto</em> proves <em>Dual Motor</em>, which proves{' '}
            <em>Long Range</em>. Read from the variant name and spec chips only.
          </span>
          {draft.implications.map((rule, index) => (
            // Positional key: the rows are edited in place, and a phrase-based
            // key would remount the input on every keystroke.
            <div className="rule-row" key={index}>
              <input
                type="text"
                value={rule.if}
                placeholder="neliveto"
                onChange={(e) =>
                  set({
                    implications: draft.implications.map((r, i) =>
                      i === index ? { ...r, if: e.target.value } : r,
                    ),
                  })
                }
              />
              <span className="rule-arrow">proves</span>
              <input
                type="text"
                value={rule.then}
                placeholder="dual motor"
                onChange={(e) =>
                  set({
                    implications: draft.implications.map((r, i) =>
                      i === index ? { ...r, then: e.target.value } : r,
                    ),
                  })
                }
              />
              <button
                className="link-btn danger"
                onClick={() =>
                  set({ implications: draft.implications.filter((_, i) => i !== index) })
                }
              >
                Remove
              </button>
            </div>
          ))}
          <button
            className="inline-link"
            onClick={() => set({ implications: [...draft.implications, { if: '', then: '' }] })}
          >
            Add a rule
          </button>
        </div>
      </details>

      <div className="modal-footer">
        {!isNew && (
          <button className="link-btn danger" onClick={onDelete}>
            Delete
          </button>
        )}
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          disabled={!runnable}
          title={runnable ? undefined : 'A make and model are needed to know what to read'}
          onClick={() =>
            onSave({
              ...draft,
              name: draft.name.trim(),
              implications: draft.implications
                .map((rule) => ({
                  if: rule.if.trim().toLowerCase(),
                  then: rule.then.trim().toLowerCase(),
                }))
                .filter((rule) => rule.if && rule.then && rule.if !== rule.then),
            })
          }
        >
          Save filter
        </button>
      </div>
    </>
  )
}

interface LimitProps {
  label: string
  value: number | null
  onChange: (value: number | null) => void
  unit?: string
  hint?: string
}

/**
 * A number that may simply not be set.
 *
 * Empty means "no limit" rather than zero, which is why NumberField (0 on an
 * empty box) cannot be reused here. Keeps its own text buffer so a half-typed
 * number survives a re-render.
 */
function LimitField({ label, value, onChange, unit, hint }: LimitProps) {
  const [text, setText] = useState(value === null ? '' : String(value))
  const [focused, setFocused] = useState(false)
  const [seen, setSeen] = useState(value)

  if (!focused && value !== seen) {
    setSeen(value)
    setText(value === null ? '' : String(value))
  }

  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input-wrap">
        <input
          type="text"
          inputMode="numeric"
          value={text}
          placeholder="any"
          onChange={(e) => {
            setText(e.target.value)
            const digits = e.target.value.replace(/[\s_]/g, '')
            if (!digits.trim()) onChange(null)
            else {
              const n = Number.parseInt(digits, 10)
              if (Number.isFinite(n)) onChange(n)
            }
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            setSeen(value)
            setText(value === null ? '' : String(value))
          }}
        />
        {unit && <span className="field-unit">{unit}</span>}
      </span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}
