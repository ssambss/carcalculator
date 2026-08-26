import { useState } from 'react'

interface Props {
  label: string
  value: string[]
  onChange: (next: string[]) => void
  hint?: string
  /** one-tap additions for the phrases people reach for most */
  suggestions?: string[]
}

/**
 * A list of short phrases, entered one at a time.
 *
 * Enter or comma commits a phrase, backspace in an empty box takes the last
 * one back, and everything is lowercased because the matching is
 * case-insensitive — showing the phrase as it will actually be compared beats
 * letting someone believe capitalisation matters.
 */
export function ChipInput({ label, value, onChange, hint, suggestions }: Props) {
  const [draft, setDraft] = useState('')

  function add(raw: string) {
    const phrase = raw.trim().toLowerCase().replace(/\s+/g, ' ')
    if (!phrase) return
    if (!value.includes(phrase)) onChange([...value, phrase])
    setDraft('')
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add(draft)
      return
    }
    if (e.key === 'Backspace' && draft === '' && value.length) {
      e.preventDefault()
      onChange(value.slice(0, -1))
    }
  }

  const unused = (suggestions ?? []).filter((s) => !value.includes(s))

  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="chip-input">
        {value.map((phrase) => (
          <span className="chip-token" key={phrase}>
            {phrase}
            <button
              type="button"
              className="chip-x"
              aria-label={`Remove ${phrase}`}
              onClick={() => onChange(value.filter((p) => p !== phrase))}
            >
              <svg width="11" height="11" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                <path d="M2 2l6 6M8 2l-6 6" />
              </svg>
            </button>
          </span>
        ))}
        <input
          type="text"
          className="chip-entry"
          value={draft}
          placeholder={value.length ? '' : 'type a phrase, press enter'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => add(draft)}
        />
      </div>
      {unused.length > 0 && (
        <div className="chip-suggestions">
          {unused.map((s) => (
            <button type="button" key={s} className="chip-suggest" onClick={() => add(s)}>
              + {s}
            </button>
          ))}
        </div>
      )}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  )
}
