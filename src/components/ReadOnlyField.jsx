export default function ReadOnlyField({ label, value, describedBy, className = '' }) {
  return <label className={`form-field ${className}`}>
    <span className="form-label">{label}</span>
    <span className="form-readonly">
      <input aria-describedby={describedBy} className="form-control" readOnly value={value == null || value === '' ? '—' : String(value)} />
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2" stroke="currentColor" strokeWidth="1.7" /><path d="M8 10V7a4 4 0 1 1 8 0v3" stroke="currentColor" strokeWidth="1.7" /></svg>
    </span>
  </label>
}
