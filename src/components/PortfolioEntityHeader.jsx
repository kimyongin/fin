export default function PortfolioEntityHeader({ children }) {
  return (
    <div className="relative border-b border-[var(--line)] bg-[rgba(255,255,255,0.045)] px-5 pb-5 pt-6 shadow-[inset_0_-1px_0_rgba(255,255,255,0.04)]">
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-[var(--accent)]" />
      {children}
    </div>
  )
}
