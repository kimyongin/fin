import { formatSignedPercent, returnToneClass } from '../lib/format'

function MetricInline({ accentText = null, accentToneClass = '', label, value }) {
  return (
    <span className="inline-flex shrink-0 items-baseline gap-1 whitespace-nowrap text-sm leading-5">
      <span className="text-[var(--muted-ink)]">{label}</span>{' '}
      <span className="font-semibold text-[var(--ink)]">{value}</span>
      {accentText && (
        <span className="ml-2 inline-flex items-baseline gap-1">
          <span className="text-[var(--muted-ink)]">수익률</span>
          <span className={`font-semibold ${accentToneClass}`}>{accentText}</span>
        </span>
      )}
    </span>
  )
}

export default function MetricSummary({
  avgCostText = '-',
  currentPriceText = '-',
  returnPercent,
  showPriceMetrics = true,
  valueText,
}) {
  return (
    <div className="mt-2 grid gap-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm leading-5 text-[var(--muted-ink)]">평가금액</span>
        <span className="text-sm font-semibold leading-5 text-[var(--ink)]">{valueText}</span>
      </div>
      {showPriceMetrics && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm leading-5 text-[var(--muted-ink)]">
          <MetricInline label="평균가" value={avgCostText} />
          <MetricInline
            accentText={formatSignedPercent(returnPercent)}
            accentToneClass={returnToneClass(returnPercent)}
            label="현재가"
            value={currentPriceText}
          />
        </div>
      )}
    </div>
  )
}
