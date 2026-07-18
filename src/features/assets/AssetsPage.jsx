import { assetViewOptions } from '../../constants/portfolio'
import { PencilIcon } from '../../components/icons'
import MetricSummary from '../../components/MetricSummary'
import PortfolioEntityHeader from '../../components/PortfolioEntityHeader'
import { AccountIdentity, InstrumentIdentity } from '../../components/PortfolioEntityIdentity'
import {
  formatKrw,
  formatNumber,
  formatPercent,
  formatUnitPrice,
  formattedValueWithConversion,
} from '../../lib/format'
import { hasComparablePriceMetrics, matchesTagFilter } from '../../lib/portfolioMath'

function CardSectionLabel({ count, label }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] pb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className="h-4 w-1 rounded-full bg-[var(--accent)]" />
        <span>{label}</span>
      </span>
      <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[var(--ink)]">
        {count}
      </span>
    </div>
  )
}

function TagActionToolbar({
  buttonLabel,
  className,
  onAction,
  onTagFilterChange,
  selectedTagId,
  selectClassName,
  tags,
}) {
  return (
    <div className={className}>
      <label className="min-w-0 flex-1 sm:flex-none">
        <span className="sr-only">태그 필터</span>
        <select
          className={`h-10 min-w-0 rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.03)] px-3 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--accent)] ${selectClassName}`}
          onChange={(event) => onTagFilterChange(event.target.value)}
          value={selectedTagId}
        >
          <option value="all">전체 태그</option>
          {tags.map((tag) => (
            <option key={tag.id} value={String(tag.id)}>
              {tag.name}
            </option>
          ))}
          <option value="untagged">태그 없음</option>
        </select>
      </label>
      {buttonLabel && onAction && (
        <button
          className="h-10 shrink-0 rounded-xl bg-[var(--accent)] px-3 text-sm font-semibold text-white transition hover:brightness-95 sm:px-4"
          onClick={onAction}
          type="button"
        >
          {buttonLabel}
        </button>
      )}
    </div>
  )
}

function Overview({ cards, pieGradient, totalValue }) {
  if (!cards.length) {
    return (
      <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[var(--shadow-soft)]">
        <h2 className="text-lg font-semibold">자산</h2>
        <p className="mt-3 text-sm leading-6 text-[var(--muted-ink)]">
          아직 보유 항목이 없습니다. 계좌와 종목을 만든 뒤 보유 수량을 입력하면 태그 비중과
          계좌별 현황이 여기에 보입니다.
        </p>
      </section>
    )
  }

  return (
    <section className="grid gap-3">
      <div className="overflow-hidden rounded-[24px] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-soft)]">
        <div className="grid gap-6 px-5 py-5 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] lg:items-start">
          <div className="grid justify-items-center gap-4 lg:justify-items-start">
            <div className="flex aspect-square w-[clamp(220px,62vw,340px)] max-w-full items-center justify-center rounded-full bg-[var(--surface-2)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] lg:w-full">
              <div className="relative aspect-square w-[82%] rounded-full" style={{ backgroundImage: pieGradient }}>
                <div className="absolute inset-[16%] grid place-items-center rounded-full bg-[var(--panel)] text-center shadow-[0_10px_30px_rgba(0,0,0,0.28)]">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-ink)]">
                      Total
                    </div>
                    <div className="mt-1 text-sm font-semibold">{formatKrw(totalValue)}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid min-w-0 gap-0">
            {cards.map((card) => {
              const percent = totalValue > 0 ? (card.value / totalValue) * 100 : NaN
              return (
                <div className="border-b border-[var(--line)] py-3 last:border-b-0" key={card.id}>
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="h-3.5 w-3.5 shrink-0 rounded-full"
                      style={{ backgroundColor: card.color }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-sm font-semibold text-[var(--ink)]">{card.name}</span>
                        <span className="shrink-0 text-sm font-semibold text-[var(--accent)]">
                          {formatPercent(percent)}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.05)]">
                        <div
                          className="h-full rounded-full"
                          style={{
                            backgroundColor: card.color,
                            width: `${Math.max(0, Math.min(Number.isFinite(percent) ? percent : 0, 100))}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {cards.map((card) => (
          <article
            className="overflow-hidden rounded-[24px] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-soft)]"
            key={card.id}
          >
            <div className="relative border-b border-[var(--line)] bg-[rgba(255,255,255,0.045)] px-5 pb-5 pt-6 shadow-[inset_0_-1px_0_rgba(255,255,255,0.04)]">
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-1"
                style={{ backgroundColor: card.color }}
              />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="h-3.5 w-3.5 rounded-full"
                      style={{ backgroundColor: card.color }}
                    />
                    <h2 className="text-base font-semibold">{card.name}</h2>
                  </div>
                  <p className="mt-1 text-sm text-[var(--muted-ink)]">{card.holdings.length}개 통합 종목</p>
                </div>
                <strong className="shrink-0 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-sm font-semibold text-[var(--accent)]">
                  {formatPercent(totalValue > 0 ? (card.value / totalValue) * 100 : NaN)}
                </strong>
              </div>

              <MetricSummary
                avgCostText="-"
                currentPriceText="-"
                returnPercent={card.returnPercent}
                valueText={formatKrw(card.value)}
                valueMeta={`${card.holdings.length}개 종목`}
              />
            </div>

            {!!card.holdings.length && (
              <div className="px-5 py-4">
                <CardSectionLabel count={card.holdings.length} label="종목 목록" />
                <div className="mt-2 divide-y divide-[var(--line)]">
                  {card.holdings.map((holding) => (
                    <div className="py-3 first:pt-0 last:pb-0" key={holding.ticker}>
                      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-sm leading-5">
                        <span className="font-semibold text-[var(--ink)]">{holding.display_name ?? holding.ticker}</span>
                        <span className="font-medium text-[var(--muted-ink)]">{holding.ticker}</span>
                      </div>
                      <MetricSummary
                        avgCostText={Number.isFinite(holding.avgCost) ? formatUnitPrice(holding.avgCost, holding.currency) : '-'}
                        currentPriceText={holding.latestPrice != null ? formatUnitPrice(holding.latestPrice, holding.currency) : '-'}
                        returnPercent={holding.priceChangePercent}
                        showPriceMetrics={hasComparablePriceMetrics(holding)}
                        valueText={formattedValueWithConversion(
                          holding.market_value_native,
                          holding.currency,
                          holding.market_value_krw,
                        )}
                        valueMeta={holding.quantity != null ? <><span>수량</span>{' '}<span className="font-semibold text-[var(--ink)]">{formatNumber(holding.quantity)}</span></> : ''}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}

function AccountsPage({
  accounts,
  canEdit,
  holdingsByAccountId,
  onCreateHolding,
  onEditAccount,
  onEditHolding,
  selectedTagId,
  tagMapByTicker,
}) {
  return (
    <section className="grid gap-3">
      {!accounts.length && (
        <div className="rounded-[24px] border border-[var(--line)] bg-[var(--panel)] p-5 text-sm leading-6 text-[var(--muted-ink)] shadow-[var(--shadow-soft)]">
          선택한 태그에 해당하는 계좌가 없습니다.
        </div>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {accounts.map((account) => {
          const allHoldings = holdingsByAccountId.get(account.id) ?? []
          const holdings = allHoldings.filter((holding) =>
            matchesTagFilter(holding.ticker, selectedTagId, tagMapByTicker),
          )

          return (
            <article
              className="overflow-hidden rounded-[24px] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-soft)]"
              key={account.id}
            >
              <PortfolioEntityHeader>
                <div className="flex items-start justify-between gap-3">
                  <AccountIdentity account={account} />
                  {canEdit && (
                    <button
                      aria-label="계좌 편집"
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                      onClick={() => onEditAccount(account)}
                      type="button"
                    >
                      <PencilIcon />
                    </button>
                  )}
                </div>

                <MetricSummary
                  avgCostText="-"
                  currentPriceText="-"
                  returnPercent={account.returnPercent}
                  valueText={formatKrw(account.market_value_krw)}
                  valueMeta={`${account.count}개 보유`}
                />
              </PortfolioEntityHeader>

              {!!holdings.length && (
                <div className="px-5 py-4">
                  <CardSectionLabel count={holdings.length} label="보유 목록" />
                  <div className="mt-2 divide-y divide-[var(--line)]">
                    {holdings.map((holding) => (
                      <div className="py-3 first:pt-0 last:pb-0" key={holding.id}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-sm leading-5">
                              <span className="font-semibold text-[var(--ink)]">
                                {holding.instruments?.display_name ?? holding.ticker}
                              </span>
                              <span className="font-medium text-[var(--muted-ink)]">{holding.ticker}</span>
                            </div>
                            <MetricSummary
                              avgCostText={Number.isFinite(holding.avgCost) ? formatUnitPrice(holding.avgCost, holding.currency) : '-'}
                              currentPriceText={holding.latestPrice != null ? formatUnitPrice(holding.latestPrice, holding.currency) : '-'}
                              returnPercent={holding.priceChangePercent}
                              showPriceMetrics={hasComparablePriceMetrics(holding)}
                              valueText={formattedValueWithConversion(
                                holding.market_value_native,
                                holding.currency,
                                holding.market_value_krw,
                              )}
                              valueMeta={holding.quantity != null ? <><span>수량</span>{' '}<span className="font-semibold text-[var(--ink)]">{formatNumber(holding.quantity)}</span></> : ''}
                            />
                          </div>
                          {canEdit && (
                            <button
                              aria-label="보유 편집"
                              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] text-[var(--muted-ink)] transition hover:bg-[var(--panel)] hover:text-[var(--ink)]"
                              onClick={() => onEditHolding(holding)}
                              type="button"
                            >
                              <PencilIcon />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {canEdit && (
                <div className="flex justify-end border-t border-[var(--line)] bg-[rgba(255,255,255,0.025)] px-5 py-3">
                  <button
                    className="rounded-2xl border border-[var(--line)] px-3 py-2 text-sm font-medium text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                    onClick={() => onCreateHolding(account.id)}
                    type="button"
                  >
                    이 계좌에 보유 추가
                  </button>
                </div>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}

function InstrumentsPage({
  accountById,
  canEdit,
  holdingsByTicker,
  instruments,
  onCreateHolding,
  onEditHolding,
  onEditInstrument,
}) {
  return (
    <section className="grid gap-3">
      {!instruments.length && (
        <div className="rounded-[24px] border border-[var(--line)] bg-[var(--panel)] p-5 text-sm leading-6 text-[var(--muted-ink)] shadow-[var(--shadow-soft)]">
          선택한 태그에 해당하는 종목이 없습니다.
        </div>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {instruments.map((instrument) => {
          const linkedHoldings = holdingsByTicker.get(instrument.ticker) ?? []
          return (
            <article
              className="overflow-hidden rounded-[24px] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-soft)]"
              key={instrument.ticker}
            >
              <PortfolioEntityHeader>
                <div className="flex items-start justify-between gap-3">
                  <InstrumentIdentity
                    detail={`${instrument.ticker} · ${instrument.tagName} · ${instrument.currency} · ${instrument.accountCount}개 계좌 · 수량 ${formatNumber(instrument.quantity)}`}
                    instrument={instrument}
                  />
                  {canEdit && (
                    <button
                      aria-label="종목 편집"
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                      onClick={() => onEditInstrument(instrument)}
                      type="button"
                    >
                      <PencilIcon />
                    </button>
                  )}
                </div>

                <MetricSummary
                  avgCostText={Number.isFinite(instrument.avgCost) ? formatUnitPrice(instrument.avgCost, instrument.currency) : '-'}
                  currentPriceText={instrument.latestPrice != null ? formatUnitPrice(instrument.latestPrice, instrument.currency) : '-'}
                  returnPercent={instrument.priceChangePercent}
                  showPriceMetrics={hasComparablePriceMetrics(instrument)}
                  valueText={formattedValueWithConversion(
                    instrument.market_value_native,
                    instrument.currency,
                    instrument.market_value_krw,
                  )}
                  valueMeta={`${instrument.accountCount}개 계좌`}
                />
              </PortfolioEntityHeader>

              {!!linkedHoldings.length && (
                <div className="px-5 py-4">
                  <CardSectionLabel count={linkedHoldings.length} label="계좌별 보유" />
                  <div className="mt-2 divide-y divide-[var(--line)]">
                    {linkedHoldings.map((holding) => {
                      const account = accountById.get(holding.account_id)
                      const accountName = account?.name ?? `계좌 ${holding.account_id}`

                      return (
                        <div className="py-3 first:pt-0 last:pb-0" key={holding.id}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-sm leading-5">
                                <span className="font-semibold text-[var(--ink)]">{accountName}</span>
                              </div>
                              <MetricSummary
                                avgCostText={Number.isFinite(holding.avgCost) ? formatUnitPrice(holding.avgCost, holding.currency) : '-'}
                                currentPriceText={holding.latestPrice != null ? formatUnitPrice(holding.latestPrice, holding.currency) : '-'}
                                returnPercent={holding.priceChangePercent}
                                showPriceMetrics={hasComparablePriceMetrics(holding)}
                                valueText={formattedValueWithConversion(
                                  holding.market_value_native,
                                  holding.currency,
                                  holding.market_value_krw,
                                )}
                                valueMeta={holding.quantity != null ? <><span>수량</span>{' '}<span className="font-semibold text-[var(--ink)]">{formatNumber(holding.quantity)}</span></> : ''}
                              />
                            </div>
                            {canEdit && (
                              <button
                                aria-label="보유 편집"
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] text-[var(--muted-ink)] transition hover:bg-[var(--panel)] hover:text-[var(--ink)]"
                                onClick={() => onEditHolding(holding)}
                                type="button"
                              >
                                <PencilIcon />
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {canEdit && (
                <div className="flex justify-end border-t border-[var(--line)] bg-[rgba(255,255,255,0.025)] px-5 py-3">
                  <button
                    className="rounded-2xl border border-[var(--line)] px-3 py-2 text-sm font-medium text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                    onClick={() => onCreateHolding(instrument.ticker)}
                    type="button"
                  >
                    이 종목에 보유 추가
                  </button>
                </div>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}

export default function AssetsPage({
  accountTagFilter,
  accountById,
  accounts,
  assetView,
  canEdit,
  holdingsByAccountId,
  holdingsByTicker,
  instrumentTagFilter,
  instruments,
  onAccountTagFilterChange,
  onAssetViewChange,
  onCreateAccount,
  onCreateHolding,
  onCreateHoldingForAccount,
  onCreateInstrument,
  onEditAccount,
  onEditHolding,
  onEditInstrument,
  onInstrumentTagFilterChange,
  pieGradient,
  tagCards,
  tagMapByTicker,
  tags,
  totalValue,
}) {
  return (
    <section className="grid gap-4">
      <div className="grid gap-3">
        <div
          aria-label="자산 보기 전환"
          className="inline-grid w-full grid-cols-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-1 sm:w-auto"
          role="tablist"
        >
          {assetViewOptions.map((option) => (
            <button
              aria-selected={assetView === option.id}
              className={`min-w-0 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                assetView === option.id
                  ? 'bg-[var(--accent)] text-white shadow-[0_6px_16px_rgba(219,106,33,0.35)]'
                  : 'text-[var(--muted-ink)] opacity-80 hover:text-[var(--ink)] hover:opacity-100'
              }`}
              key={option.id}
              onClick={() => onAssetViewChange(option.id)}
              role="tab"
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 border-t border-[var(--line)] pt-3 sm:flex-row sm:items-center sm:justify-end">
          {assetView === 'tags' ? (
            <TagActionToolbar
              buttonLabel=""
              className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center"
              onAction={undefined}
              onTagFilterChange={() => {}}
              selectedTagId="all"
              selectClassName="hidden"
              tags={tags}
            />
          ) : assetView === 'accounts' ? (
            <TagActionToolbar
              buttonLabel={canEdit ? '계좌 추가' : ''}
              className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center"
              onAction={canEdit ? onCreateAccount : undefined}
              onTagFilterChange={onAccountTagFilterChange}
              selectedTagId={accountTagFilter}
              selectClassName="w-full sm:w-44 lg:w-52"
              tags={tags}
            />
          ) : (
            <TagActionToolbar
              buttonLabel={canEdit ? '보유 추가' : ''}
              className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center"
              onAction={canEdit ? () => onCreateHolding() : undefined}
              onTagFilterChange={onInstrumentTagFilterChange}
              selectedTagId={instrumentTagFilter}
              selectClassName="w-full sm:w-44 lg:w-52"
              tags={tags}
            />
          )}
        </div>
      </div>

      {assetView === 'tags' && <Overview cards={tagCards} pieGradient={pieGradient} totalValue={totalValue} />}
      {assetView === 'accounts' && (
        <AccountsPage
          accounts={accounts}
          canEdit={canEdit}
          holdingsByAccountId={holdingsByAccountId}
          onCreateHolding={onCreateHoldingForAccount}
          onEditAccount={onEditAccount}
          onEditHolding={onEditHolding}
          selectedTagId={accountTagFilter}
          tagMapByTicker={tagMapByTicker}
        />
      )}
      {assetView === 'instruments' && (
        <InstrumentsPage
          accountById={accountById}
          canEdit={canEdit}
          holdingsByTicker={holdingsByTicker}
          instruments={instruments}
          onCreateHolding={onCreateHolding}
          onEditHolding={onEditHolding}
          onEditInstrument={onEditInstrument}
        />
      )}
    </section>
  )
}
