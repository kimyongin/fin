export default function SharingSwitch({ checked, disabled = false, label, onClick }) {
  return <button
    aria-checked={checked}
    aria-label={label}
    className="flex h-11 w-12 shrink-0 items-center justify-center rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-50"
    disabled={disabled}
    onClick={onClick}
    role="switch"
    type="button"
  >
    <span aria-hidden="true" className={`relative h-7 w-12 rounded-full border transition ${checked ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-[var(--line)] bg-[var(--surface-3)]'}`}>
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${checked ? 'left-6' : 'left-1'}`} />
    </span>
  </button>
}
