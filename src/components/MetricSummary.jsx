import { formatSignedPercent, returnToneClass } from '../lib/format'

function MetricInline({ accentText = null, accentToneClass = '', label, value }) {
  return (
    <span className="type-secondary inline-flex shrink-0 items-baseline gap-1 whitespace-nowrap">
      <span className="text-[var(--muted-ink)]">{label}</span>{' '}
      <span className="type-value type-number text-[var(--ink)]">{value}</span>
      {accentText && (
        <span className="ml-2 inline-flex items-baseline gap-1">
          <span className="text-[var(--muted-ink)]">수익률</span>
          <span className={`type-secondary type-number ${accentToneClass}`}>{accentText}</span>
        </span>
      )}
    </span>
  )
}

export default function MetricSummary({
  avgCostLabel = '평균가',
  avgCostText = '-',
  currentPriceLabel = '현재가',
  currentPriceText = '-',
  returnPercent,
  showPriceMetrics = true,
  showValueSummary = true,
  valueMeta = '',
  valueText,
}) {
  return (
    <div className="mt-2 grid gap-2">
      {showValueSummary && (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="type-label text-[var(--muted-ink)]">평가금액</span>
          <span className="type-value type-number text-[var(--ink)]">{valueText}</span>
          {valueMeta && <span className="type-secondary text-[var(--muted-ink)]">{valueMeta}</span>}
        </div>
      )}
      {showPriceMetrics && (
        <div className="type-secondary flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[var(--muted-ink)]">
          <MetricInline label={avgCostLabel} value={avgCostText} />
          <MetricInline
            accentText={formatSignedPercent(returnPercent)}
            accentToneClass={returnToneClass(returnPercent)}
            label={currentPriceLabel}
            value={currentPriceText}
          />
        </div>
      )}
    </div>
  )
}
