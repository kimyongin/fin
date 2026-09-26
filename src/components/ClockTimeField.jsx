import { useEffect, useId, useState } from 'react'

const validTime = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)

export default function ClockTimeField({ disabled = false, label, onChange, value = '' }) {
  const id = useId()
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])

  return <div className="form-field">
    <label className="form-label" htmlFor={id}>{label}</label>
    <input
      aria-invalid={Boolean(text) && !validTime(text) || undefined}
      className="form-control type-number"
      disabled={disabled}
      id={id}
      inputMode="numeric"
      onBlur={() => { if (text && !validTime(text)) setText(value) }}
      onChange={(event) => {
        const typed = event.target.value
        const next = /^\d{4}$/.test(typed) ? `${typed.slice(0, 2)}:${typed.slice(2)}` : typed
        setText(next)
        if (!next || validTime(next)) onChange(next)
      }}
      placeholder="HH:mm"
      value={text}
    />
  </div>
}
