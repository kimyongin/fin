import { useEffect, useMemo, useState } from "react";
import { PencilIcon } from "../../components/icons";
import MetricSummary from "../../components/MetricSummary";
import AssetViewToolbar from "./AssetViewToolbar";
import PortfolioEntityHeader from "../../components/PortfolioEntityHeader";
import {
  AccountIdentity,
  InstrumentIdentity,
} from "../../components/PortfolioEntityIdentity";
import {
  formatKrw,
  formatNumber,
  formatPercent,
  formatUnitPrice,
  formattedValueWithConversion,
} from "../../lib/format";
import {
  hasComparablePriceMetrics,
  matchesTagFilter,
} from "../../lib/portfolioMath";
import SpreadsheetEditor from "./SpreadsheetEditor";
import HoldingReasonModal from "./HoldingReasonModal";
import { fetchPrivateHoldingNotes, savePrivateHoldingNote } from "./privateHoldingNotesData";
import TradeEntryModal from "./TradeEntryModal";
import HoldingIntegrityModal from "./HoldingIntegrityModal";

function metricProps(item) {
  if (item.instrument_type === "valuation") {
    return {
      avgCostLabel: "매입금액",
      avgCostText: formatUnitPrice(item.cost_basis_native, item.currency),
      currentPriceLabel: "평가금액",
      currentPriceText: formatUnitPrice(
        item.market_value_native,
        item.currency,
      ),
    };
  }
  if (item.instrument_type === "cash") return { showPriceMetrics: false };
  return {
    avgCostText: Number.isFinite(item.avgCost)
      ? formatUnitPrice(item.avgCost, item.currency)
      : "-",
    currentPriceText:
      item.latestPrice != null
        ? formatUnitPrice(item.latestPrice, item.currency)
        : "-",
  };
}

function holdingValueMeta(holding) {
  if (holding.instrument_type !== "market") return "";
  return (
    <>
      <span>수량</span>{" "}
      <span className="font-semibold text-[var(--ink)]">
        {formatNumber(holding.quantity)}
      </span>
    </>
  );
}

function ValuationQualityNote({ item }) {
  const issues = item.valuation_issues ?? [];
  if (item.valuation_status === "complete") return null;
  const labels = issues.map(
    (issue) =>
      ({
        missing_price: "시세 없음",
        missing_fx: `${item.fx_ticker ?? item.currency ?? ""} 환율 없음`,
        missing_valuation: "평가금액 없음",
        stale_price: `시세 ${item.price_date ?? "날짜 미상"}`,
        stale_fx: `환율 ${item.fx_price_date ?? "날짜 미상"}`,
      })[issue] ?? issue,
  );
  if (!labels.length && item.unknownCount)
    labels.push(`평가 불가 계좌 ${item.unknownCount}개`);
  return (
    <p className="mt-1 text-xs leading-5 text-amber-300">
      {labels.join(" · ")}
    </p>
  );
}

function ValuationQualityBanner({ quality, totalValue }) {
  if (!quality?.unknownPositionCount && !quality?.stalePositionCount)
    return null;
  return (
    <div className="rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-100">
      <strong>확인 가능한 평가액 {formatKrw(totalValue)}</strong>
      <span className="ml-2">
        {quality.unknownPositionCount
          ? `평가 불가 ${quality.unknownPositionCount}개 제외`
          : ""}
        {quality.unknownPositionCount && quality.stalePositionCount
          ? " · "
          : ""}
        {quality.stalePositionCount
          ? `오래된 시세·환율 ${quality.stalePositionCount}개 포함`
          : ""}
      </span>
    </div>
  );
}

function CardSectionLabel({ count, label }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] pb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
      <span className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="h-4 w-1 rounded-full bg-[var(--accent)]"
        />
        <span>{label}</span>
      </span>
      <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[var(--ink)]">
        {count}
      </span>
    </div>
  );
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
          className={`min-h-11 min-w-0 rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.03)] px-3 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--accent)] ${selectClassName}`}
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
          className="min-h-11 shrink-0 rounded-xl bg-[var(--accent)] px-3 text-sm font-semibold text-white transition hover:brightness-95 sm:px-4"
          onClick={onAction}
          type="button"
        >
          {buttonLabel}
        </button>
      )}
    </div>
  );
}

function Overview({ cards, totalValue }) {
  if (!cards.length) {
    return (
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-[var(--shadow-soft)] sm:p-6">
        <p className="text-sm leading-6 text-[var(--muted-ink)]">
          아직 보유 항목이 없습니다. 계좌와 종목을 만든 뒤 보유 수량을 입력하면
          태그 비중과 계좌별 현황이 여기에 보입니다.
        </p>
      </section>
    );
  }

  return (
    <section className="grid gap-3">
      <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-soft)]">
        <div className="flex items-baseline justify-between gap-4 border-b border-[var(--line)] px-4 py-2.5">
          <h2 className="text-sm font-semibold">태그별 비중</h2>
          <span className="shrink-0 text-xs font-semibold text-[var(--accent)]">
            {formatKrw(totalValue)}
          </span>
        </div>
        <div className="grid min-w-0 gap-0 px-4">
          {cards.map((card) => {
            const percent =
              totalValue > 0 ? (card.value / totalValue) * 100 : NaN;
            return (
              <div
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b border-[var(--line)] py-2 last:border-b-0"
                key={card.id}
              >
                <div className="min-w-0">
                  <span className="truncate text-sm font-medium text-[var(--ink)]">
                    {card.name}
                  </span>
                </div>
                <div className="flex shrink-0 items-baseline gap-2 text-right">
                  <span className="text-sm font-semibold">
                    {formatKrw(card.value)}
                  </span>
                  <span className="text-xs text-[var(--muted-ink)]">
                    {formatPercent(percent)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {cards.map((card) => (
          <article
            className="overflow-hidden rounded-[24px] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-soft)]"
            key={card.id}
          >
            <div className="border-b border-[var(--line)] bg-[rgba(255,255,255,0.045)] px-5 py-5 shadow-[inset_0_-1px_0_rgba(255,255,255,0.04)]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold">{card.name}</h2>
                  <p className="mt-1 text-sm text-[var(--muted-ink)]">
                    {card.holdings.length}개 통합 종목
                  </p>
                </div>
                <strong className="shrink-0 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-sm font-semibold text-[var(--accent)]">
                  {formatPercent(
                    totalValue > 0 ? (card.value / totalValue) * 100 : NaN,
                  )}
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
                <CardSectionLabel
                  count={card.holdings.length}
                  label="종목 목록"
                />
                <div className="mt-2 divide-y divide-[var(--line)]">
                  {card.holdings.map((holding) => (
                    <div
                      className="py-3 first:pt-0 last:pb-0"
                      key={holding.ticker}
                    >
                      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-sm leading-5">
                        <span className="font-semibold text-[var(--ink)]">
                          {holding.display_name ?? holding.ticker}
                        </span>
                        <span className="font-medium text-[var(--muted-ink)]">
                          {holding.ticker}
                        </span>
                      </div>
                      <MetricSummary
                        {...metricProps(holding)}
                        returnPercent={holding.priceChangePercent}
                        showPriceMetrics={
                          holding.instrument_type !== "cash" &&
                          hasComparablePriceMetrics(holding)
                        }
                        valueText={formattedValueWithConversion(
                          holding.market_value_native,
                          holding.currency,
                          holding.market_value_krw,
                        )}
                        valueMeta={holdingValueMeta(holding)}
                      />
                      <ValuationQualityNote item={holding} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
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
          const allHoldings = holdingsByAccountId.get(account.id) ?? [];
          const holdings = allHoldings.filter((holding) =>
            matchesTagFilter(holding.ticker, selectedTagId, tagMapByTicker),
          );

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
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                      onClick={() => onEditAccount(account)}
                      type="button"
                    >
                      <PencilIcon />
                    </button>
                  )}
                </div>

                <MetricSummary
                  avgCostLabel="매입금액"
                  avgCostText={formatKrw(account.cost_basis_krw)}
                  currentPriceLabel="평가금액"
                  currentPriceText={formatKrw(account.market_value_krw)}
                  returnPercent={account.returnPercent}
                  showValueSummary={false}
                  valueText={formatKrw(account.market_value_krw)}
                  valueMeta={`${account.count}개 보유`}
                />
              </PortfolioEntityHeader>

              {!!holdings.length && (
                <div className="px-5 py-4">
                  <CardSectionLabel count={holdings.length} label="보유 목록" />
                  <div className="mt-2 divide-y divide-[var(--line)]">
                    {holdings.map((holding) => (
                      <div
                        className="py-3 first:pt-0 last:pb-0"
                        key={holding.id}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-sm leading-5">
                              <span className="font-semibold text-[var(--ink)]">
                                {holding.instruments?.display_name ??
                                  holding.ticker}
                              </span>
                              <span className="font-medium text-[var(--muted-ink)]">
                                {holding.ticker}
                              </span>
                            </div>
                            <MetricSummary
                              {...metricProps(holding)}
                              returnPercent={holding.priceChangePercent}
                              showPriceMetrics={
                                holding.instrument_type !== "cash" &&
                                hasComparablePriceMetrics(holding)
                              }
                              valueText={formattedValueWithConversion(
                                holding.market_value_native,
                                holding.currency,
                                holding.market_value_krw,
                              )}
                              valueMeta={holdingValueMeta(holding)}
                            />
                            <ValuationQualityNote item={holding} />
                          </div>
                          {canEdit && (
                            <button
                              aria-label="보유 편집"
                              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] text-[var(--muted-ink)] transition hover:bg-[var(--panel)] hover:text-[var(--ink)]"
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
          );
        })}
      </div>
    </section>
  );
}

function InstrumentsPage({
  accountById,
  canEdit,
  holdingsByTicker,
  instruments,
  onCreateHolding,
  onEditHolding,
  onEditInstrument,
  onEditReason,
  onRecordTrade,
  onReconcileHolding,
  reasonByInstrumentId,
  privateNotes,
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
          const linkedHoldings = holdingsByTicker.get(instrument.ticker) ?? [];
          const reason = reasonByInstrumentId.get(Number(instrument.id));
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
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                      onClick={() => onEditInstrument(instrument)}
                      type="button"
                    >
                      <PencilIcon />
                    </button>
                  )}
                </div>

                <MetricSummary
                  {...metricProps(instrument)}
                  returnPercent={instrument.priceChangePercent}
                  showPriceMetrics={
                    instrument.instrument_type !== "cash" &&
                    hasComparablePriceMetrics(instrument)
                  }
                  valueText={formattedValueWithConversion(
                    instrument.market_value_native,
                    instrument.currency,
                    instrument.market_value_krw,
                  )}
                  valueMeta={`${instrument.accountCount}개 계좌`}
                />
                <ValuationQualityNote item={instrument} />
                {reason && (
                  <p className="mt-3 line-clamp-2 text-sm leading-6 text-[var(--muted-ink)]">
                    <span className="font-semibold text-[var(--ink)]">
                      보유 이유
                    </span>{" "}
                    · {reason.note}
                  </p>
                )}
              </PortfolioEntityHeader>

              {!!linkedHoldings.length && (
                <div className="px-5 py-4">
                  <CardSectionLabel
                    count={linkedHoldings.length}
                    label="계좌별 보유"
                  />
                  <div className="mt-2 divide-y divide-[var(--line)]">
                    {linkedHoldings.map((holding) => {
                      const account = accountById.get(holding.account_id);
                      const accountName =
                        account?.name ?? `계좌 ${holding.account_id}`;
                      const accountReason = privateNotes.find((item) =>
                        Number(item.instrument_id) === Number(instrument.id)
                        && Number(item.account_id) === Number(holding.account_id));

                      return (
                        <div
                          className="py-3 first:pt-0 last:pb-0"
                          key={holding.id}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-sm leading-5">
                                <span className="font-semibold text-[var(--ink)]">
                                  {accountName}
                                </span>
                              </div>
                              <MetricSummary
                                {...metricProps(holding)}
                                returnPercent={holding.priceChangePercent}
                                showPriceMetrics={
                                  holding.instrument_type !== "cash" &&
                                  hasComparablePriceMetrics(holding)
                                }
                                valueText={formattedValueWithConversion(
                                  holding.market_value_native,
                                  holding.currency,
                                  holding.market_value_krw,
                                )}
                                valueMeta={holdingValueMeta(holding)}
                              />
                              {accountReason && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-[var(--muted-ink)]">보유 이유 · {accountReason.note}</p>}
                            </div>
                            {canEdit && (
                              <div className="flex shrink-0 gap-1">
                                <button
                                  aria-label="잔고 맞추기"
                                  className="rounded-xl border border-[var(--line)] px-2 py-1.5 text-xs text-[var(--muted-ink)]"
                                  onClick={() =>
                                    onReconcileHolding(instrument, holding)
                                  }
                                  type="button"
                                >
                                  맞추기
                                </button>
                                <button
                                  aria-label="보유 편집"
                                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] text-[var(--muted-ink)] transition hover:bg-[var(--panel)] hover:text-[var(--ink)]"
                                  onClick={() => onEditHolding(holding)}
                                  type="button"
                                >
                                  <PencilIcon />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {canEdit && (
                <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--line)] bg-[rgba(255,255,255,0.025)] px-5 py-3">
                  {instrument.instrument_type === "market" &&
                    linkedHoldings.length > 0 && (
                      <button
                        className="rounded-2xl border border-[var(--line)] px-3 py-2 text-sm font-medium text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                        onClick={() =>
                          onRecordTrade(instrument, linkedHoldings)
                        }
                        type="button"
                      >
                        매매 기록
                      </button>
                    )}
                  <button
                    className="rounded-2xl border border-[var(--line)] px-3 py-2 text-sm font-medium text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                    onClick={() => onEditReason(instrument, linkedHoldings)}
                    type="button"
                  >
                    {reason ? "보유 메모 편집" : "보유 메모 추가"}
                  </button>
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
          );
        })}
      </div>
    </section>
  );
}

export default function AssetsPage({
  accountTagFilter,
  accountById,
  accounts,
  assetView,
  canEdit,
  csvCopied,
  holdingsByAccountId,
  holdingsByTicker,
  instrumentTagFilter,
  instruments,
  onAccountTagFilterChange,
  onAssetViewChange,
  onCopyCsv,
  onCreateAccount,
  onCreateHolding,
  onCreateHoldingForAccount,
  onCreateInstrument,
  onCreateTag,
  onEditAccount,
  onEditHolding,
  onEditInstrument,
  onEditTag,
  onInstrumentTagFilterChange,
  onSpreadsheetSave,
  onSyncPrices,
  syncingPrices,
  syncMessage,
  spreadsheetSaving,
  sheetAccounts,
  sheetInstruments,
  holdings,
  instrumentTags,
  tagCards,
  tagMapByTicker,
  tags,
  totalValue,
  valuationQuality,
  supabase,
  onTradeSaved,
}) {
  const [privateNotes, setPrivateNotes] = useState([]);
  const [reasonEditor, setReasonEditor] = useState(null);
  const [reasonError, setReasonError] = useState("");
  const [reasonSaving, setReasonSaving] = useState(false);
  const [tradeEditor, setTradeEditor] = useState(null);
  const [integrityEditor, setIntegrityEditor] = useState(null);
  useEffect(() => {
    let active = true;
    if (!canEdit || !supabase) return undefined;
    fetchPrivateHoldingNotes(supabase)
      .then((items) => {
        if (active) setPrivateNotes(items);
      })
      .catch((error) => {
        if (active) setReasonError(error.message);
      });
    return () => {
      active = false;
    };
  }, [canEdit, supabase]);
  const reasonByInstrumentId = useMemo(
    () =>
      new Map(
        privateNotes
          .filter((item) => item.account_id == null)
          .map((item) => [Number(item.instrument_id), item]),
      ),
    [privateNotes],
  );
  async function handleReasonSave(payload) {
    setReasonSaving(true);
    setReasonError("");
    try {
      await savePrivateHoldingNote(supabase, {
        ...payload,
        instrumentId: reasonEditor.instrument.id,
      });
      setPrivateNotes(await fetchPrivateHoldingNotes(supabase));
      setReasonEditor(null);
    } catch (error) {
      setReasonError(error.message);
    } finally {
      setReasonSaving(false);
    }
  }
  return (
    <section className="grid gap-4">
      <div className="grid gap-4">
        <AssetViewToolbar canEdit={canEdit} copied={csvCopied} onCopyCsv={onCopyCsv} onCreateTag={onCreateTag} onEditTag={onEditTag} onSyncPrices={onSyncPrices} onViewChange={onAssetViewChange} syncMessage={syncMessage} syncingPrices={syncingPrices} tags={tags} value={assetView} />
        {(assetView === "accounts" || assetView === "instruments") && <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          {assetView === "accounts" ? (
            <TagActionToolbar
              buttonLabel={canEdit ? "계좌 추가" : ""}
              className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center"
              onAction={canEdit ? onCreateAccount : undefined}
              onTagFilterChange={onAccountTagFilterChange}
              selectedTagId={accountTagFilter}
              selectClassName="w-full sm:w-44 lg:w-52"
              tags={tags}
            />
          ) : assetView === "instruments" ? (
            <TagActionToolbar
              buttonLabel={canEdit ? "보유 추가" : ""}
              className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center"
              onAction={canEdit ? () => onCreateHolding() : undefined}
              onTagFilterChange={onInstrumentTagFilterChange}
              selectedTagId={instrumentTagFilter}
              selectClassName="w-full sm:w-44 lg:w-52"
              tags={tags}
            />
          ) : null}
        </div>}
      </div>

      <div aria-labelledby={`asset-view-${assetView}`} className="grid gap-4" id="asset-view-panel" role="tabpanel" tabIndex={0}>
      <ValuationQualityBanner
        quality={valuationQuality}
        totalValue={totalValue}
      />

      {assetView === "tags" && (
        <Overview cards={tagCards} totalValue={totalValue} />
      )}
      {assetView === "accounts" && (
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
      {assetView === "instruments" && (
        <InstrumentsPage
          accountById={accountById}
          canEdit={canEdit}
          holdingsByTicker={holdingsByTicker}
          instruments={instruments}
          onCreateHolding={onCreateHolding}
          onEditHolding={onEditHolding}
          onEditInstrument={onEditInstrument}
          onEditReason={(instrument, linkedHoldings) =>
            setReasonEditor({
              instrument,
              accounts: linkedHoldings
                .map((holding) => accountById.get(holding.account_id))
                .filter(Boolean),
            })
          }
          onRecordTrade={(instrument, linkedHoldings) =>
            setTradeEditor({
              instrument,
              accounts: linkedHoldings
                .map((holding) => accountById.get(holding.account_id))
                .filter(Boolean),
            })
          }
          onReconcileHolding={(instrument, holding) =>
            setIntegrityEditor({ instrument, holding })
          }
          reasonByInstrumentId={reasonByInstrumentId}
          privateNotes={privateNotes}
        />
      )}
      {assetView === "sheet" && (
        <SpreadsheetEditor
          accounts={sheetAccounts}
          canSave={canEdit}
          holdings={holdings}
          instrumentTags={instrumentTags}
          instruments={sheetInstruments}
          onSave={onSpreadsheetSave}
          saving={spreadsheetSaving}
          tags={tags}
        />
      )}
      </div>
      {reasonError && (
        <p className="rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {reasonError}
        </p>
      )}
      {reasonEditor && (
        <HoldingReasonModal
          accounts={reasonEditor.accounts}
          instrument={reasonEditor.instrument}
          onClose={() => setReasonEditor(null)}
          onSave={handleReasonSave}
          saving={reasonSaving}
          notes={privateNotes}
        />
      )}
      {tradeEditor && (
        <TradeEntryModal
          accounts={tradeEditor.accounts}
          instrument={tradeEditor.instrument}
          onClose={() => setTradeEditor(null)}
          onSaved={onTradeSaved}
          supabase={supabase}
        />
      )}
      {integrityEditor && (
        <HoldingIntegrityModal
          holding={integrityEditor.holding}
          instrument={integrityEditor.instrument}
          onClose={() => setIntegrityEditor(null)}
          onSaved={onTradeSaved}
          supabase={supabase}
        />
      )}
    </section>
  );
}
