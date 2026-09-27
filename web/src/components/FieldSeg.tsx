// Labelled segmented control: one aria-pressed button per option (`.seg` in base.css).
interface Props<T extends string> {
  label: string
  options: readonly T[]
  value: T | null
  onChange: (v: T) => void
  /** Display text per option; defaults to the value in sentence case. */
  format?: (v: T) => string
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function FieldSeg<T extends string>({ label, options, value, onChange, format = sentence }: Props<T>) {
  return (
    <div className="field" role="group" aria-label={label}>
      <span className="label" aria-hidden>{label}</span>
      <div className="seg">
        {options.map(o => (
          <button key={o} type="button" aria-pressed={value === o} onClick={() => onChange(o)}>
            {format(o)}
          </button>
        ))}
      </div>
    </div>
  )
}
