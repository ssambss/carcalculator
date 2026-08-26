import { useState } from 'react'

interface Props {
  label: string
  value: number
  onChange: (n: number) => void
  unit?: string
  hint?: string
  compact?: boolean
}

/**
 * Numeric input that keeps its own text buffer so partial input ("", "1,")
 * doesn't get clobbered by re-renders, and accepts both comma and dot
 * decimals (Finnish keyboards default to comma).
 */
export function NumberField({ label, value, onChange, unit, hint, compact }: Props) {
  const [text, setText] = useState(String(value))
  const [focused, setFocused] = useState(false)
  const [prevValue, setPrevValue] = useState(value)

  // Follow outside changes to the value while the field isn't being edited
  if (!focused && value !== prevValue) {
    setPrevValue(value)
    setText(String(value))
  }

  function handleChange(s: string) {
    setText(s)
    const n = parseFloat(s.replace(/\s/g, '').replace(',', '.'))
    if (Number.isFinite(n)) onChange(n)
    else if (s.trim() === '') onChange(0)
  }

  function handleBlur() {
    setFocused(false)
    setPrevValue(value)
    setText(String(value))
  }

  return (
    <label className={compact ? 'field field-compact' : 'field'}>
      <span className="field-label">{label}</span>
      <span className="field-input-wrap">
        <input
          type="text"
          inputMode="decimal"
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
        />
        {unit && <span className="field-unit">{unit}</span>}
      </span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}
