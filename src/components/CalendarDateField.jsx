import { useEffect, useId, useRef, useState } from 'react'
import { DayPicker } from '@daypicker/react'
import { ko } from '@daypicker/react/locale'

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day, 12)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null
}

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export default function CalendarDateField({ className = '', disabled = false, label, labelClassName = 'form-label', max, onChange, value = '' }) {
  const id = useId()
  const calendarId = useId()
  const buttonRef = useRef(null)
  const [text, setText] = useState(value)
  const [open, setOpen] = useState(false)
  const maxDate = parseDate(max)
  const selected = parseDate(value)
  const validText = !text || (parseDate(text) && (!max || text <= max))

  useEffect(() => setText(value), [value])

  function changeText(next) {
    setText(next)
    if (!next || (parseDate(next) && (!max || next <= max))) onChange(next)
  }

  function selectDate(date) {
    if (!date) return
    const next = formatDate(date)
    setText(next)
    onChange(next)
    setOpen(false)
    buttonRef.current?.focus()
  }

  return <div className={`form-field ${className}`} data-escape-results-open={open ? 'true' : undefined} onKeyDown={(event) => {
    if (open && event.key === 'Escape') { event.stopPropagation(); setOpen(false); buttonRef.current?.focus() }
  }}>
    <label className={labelClassName} htmlFor={id}>{label}</label>
    <div className="calendar-field-control">
      <input
        aria-invalid={!validText || undefined}
        className="form-control type-number"
        disabled={disabled}
        id={id}
        inputMode="numeric"
        onBlur={() => { if (!validText) setText(value) }}
        onChange={(event) => changeText(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true) } }}
        placeholder="YYYY-MM-DD"
        value={text}
      />
      <button
        aria-controls={calendarId}
        aria-expanded={open}
        aria-label={`${label} 달력 ${open ? '닫기' : '열기'}`}
        className="calendar-field-toggle"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        ref={buttonRef}
        type="button"
      >
        <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 24 24" width="20"><rect height="16" rx="2" stroke="currentColor" strokeWidth="1.7" width="18" x="3" y="5" /><path d="M7 3v4m10-4v4M3 10h18" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" /></svg>
      </button>
    </div>
    {open && <div className="calendar-field-panel" id={calendarId}>
      <DayPicker autoFocus defaultMonth={selected ?? maxDate ?? new Date()} disabled={maxDate ? { after: maxDate } : undefined} endMonth={maxDate ?? undefined} locale={ko} mode="single" onSelect={selectDate} selected={selected ?? undefined} showOutsideDays />
    </div>}
  </div>
}
