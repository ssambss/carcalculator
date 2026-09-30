/**
 * A native date picker dressed as the number fields. Its own file because the
 * mileage log and the saving plan both ask for a day.
 */
export function DateField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string
  value: string
  onChange: (iso: string) => void
  hint?: string
}) {
  return (
    <label className="field field-compact field-date">
      <span className="field-label">{label}</span>
      <span className="field-input-wrap">
        <input type="date" value={value} onChange={(e) => onChange(e.target.value)} />
      </span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}
