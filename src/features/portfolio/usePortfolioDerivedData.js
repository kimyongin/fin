import { useMemo } from "react";
import {
  effectiveKrwValue,
  nativeToKrw,
  resolvePositionValuation,
} from "../../lib/portfolioMath";

export function usePortfolioDerivedData({
  latestPriceByTicker,
  state,
}) {
  const computedPositions = useMemo(() => {
    const instrumentByTicker = new Map(
      state.instruments.map((instrument) => [instrument.ticker, instrument]),
    );

    return state.holdings.map((holding) => {
      const instrument =
        holding.instruments ?? instrumentByTicker.get(holding.ticker) ?? null;
      const instrumentType = instrument?.instrument_type ?? "market";
      const latestPriceRow = latestPriceByTicker.get(holding.ticker);
      const latestPrice = latestPriceRow?.close_price;
      const quantity = Number(holding.quantity ?? 0);
      const avgPrice =
        holding.avg_price == null ? null : Number(holding.avg_price);
      const directPurchaseAmount =
        holding.purchase_amount == null
          ? null
          : Number(holding.purchase_amount);
      const directValuationAmount =
        holding.valuation_amount == null
          ? null
          : Number(holding.valuation_amount);
      const isValuation = instrumentType === "valuation";
      const isCash = instrumentType === "cash";
      const valuation = resolvePositionValuation({
        instrumentType,
        currency: instrument?.currency ?? "KRW",
        quantity,
        valuationAmount: directValuationAmount,
        latestPrice: latestPriceRow,
        latestPriceByTicker,
      });
      const marketValueNative = valuation.marketValueNative;
      const costBasisNative = isValuation
        ? Number.isFinite(directPurchaseAmount)
          ? directPurchaseAmount
          : 0
        : isCash
          ? 0
          : quantity * (Number.isFinite(avgPrice) ? avgPrice : 0);
      const marketValueKrw = valuation.marketValueKrw;
      const costBasisKrw = nativeToKrw(
        costBasisNative,
        instrument?.currency ?? "KRW",
        latestPriceByTicker,
      );
      const priceChangePercent =
        Number.isFinite(latestPrice) &&
        Number.isFinite(avgPrice) &&
        avgPrice > 0
          ? ((latestPrice - avgPrice) / avgPrice) * 100
          : null;

      return {
        ...holding,
        display_name: instrument?.display_name ?? holding.ticker,
        currency: instrument?.currency ?? "KRW",
        instrument_type: instrumentType,
        quantity,
        avgCost:
          !isValuation && !isCash && Number.isFinite(avgPrice)
            ? avgPrice
            : null,
        cost_basis_native: costBasisNative,
        cost_basis_krw: costBasisKrw,
        latestPrice:
          !isValuation && !isCash && Number.isFinite(latestPrice)
            ? latestPrice
            : null,
        market_value_native: marketValueNative,
        market_value_krw: marketValueKrw,
        valuation_status: valuation.status,
        valuation_issues: valuation.issues,
        price_date: valuation.priceDate,
        fx_ticker: valuation.fxTicker,
        fx_price_date: valuation.fxPriceDate,
        priceChangePercent:
          isValuation || isCash
            ? costBasisNative > 0
              ? ((marketValueNative - costBasisNative) / costBasisNative) * 100
              : null
            : priceChangePercent,
      };
    });
  }, [state.holdings, state.instruments, latestPriceByTicker]);

  const totalValue = useMemo(
    () =>
      computedPositions.reduce((sum, row) => {
        const value = effectiveKrwValue(row, latestPriceByTicker);
        return sum + (Number.isFinite(value) ? value : 0);
      }, 0),
    [computedPositions, latestPriceByTicker],
  );

  const computedValuationQuality = useMemo(
    () => ({
      totalPositionCount: computedPositions.length,
      knownPositionCount: computedPositions.filter((row) =>
        Number.isFinite(row.market_value_krw),
      ).length,
      unknownPositionCount: computedPositions.filter(
        (row) => row.valuation_status === "missing",
      ).length,
      stalePositionCount: computedPositions.filter(
        (row) => row.valuation_status === "stale",
      ).length,
      isComplete: computedPositions.every(
        (row) => row.valuation_status !== "missing",
      ),
    }),
    [computedPositions],
  );

  const valuationQuality = useMemo(() => {
    const serverQuality = state.valuation_quality;
    if (!serverQuality) return computedValuationQuality;
    return {
      totalPositionCount: Number(serverQuality.total_position_count ?? 0),
      knownPositionCount: Number(serverQuality.known_position_count ?? 0),
      unknownPositionCount: Number(serverQuality.unknown_position_count ?? 0),
      stalePositionCount: Number(serverQuality.stale_position_count ?? 0),
      knownValueKrw: Number(serverQuality.known_value_krw ?? 0),
      isComplete: Boolean(serverQuality.is_complete),
      hasStaleValues: Boolean(serverQuality.has_stale_values),
      staleAfterDays: Number(serverQuality.stale_after_days ?? 7),
      denominator: serverQuality.denominator ?? "known_values_only",
    };
  }, [computedValuationQuality, state.valuation_quality]);

  const tagMapByTicker = useMemo(() => {
    const map = new Map();
    for (const row of state.instrumentTags) {
      if (!map.has(row.ticker) && row.tags) {
        map.set(row.ticker, row.tags);
      }
    }
    return map;
  }, [state.instrumentTags]);

  const holdingsByAccountId = useMemo(() => {
    const map = new Map();
    for (const row of computedPositions) {
      const items = map.get(row.account_id) ?? [];
      items.push(row);
      map.set(row.account_id, items);
    }
    return map;
  }, [computedPositions]);

  const holdingsByTicker = useMemo(() => {
    const map = new Map();
    for (const row of computedPositions) {
      const items = map.get(row.ticker) ?? [];
      items.push(row);
      map.set(row.ticker, items);
    }
    return map;
  }, [computedPositions]);

  const accountById = useMemo(() => {
    return new Map(state.accounts.map((account) => [account.id, account]));
  }, [state.accounts]);

  const instrumentRows = useMemo(() => {
    const aggregated = new Map();
    for (const pos of computedPositions) {
      const current = aggregated.get(pos.ticker) ?? {
        ticker: pos.ticker,
        display_name: pos.display_name,
        currency: pos.currency,
        quantity: 0,
        cost_basis_native: 0,
        market_value_native: 0,
        market_value_krw: 0,
        unknownCount: 0,
        staleCount: 0,
        accounts: new Set(),
      };
      current.quantity += pos.quantity ?? 0;
      current.cost_basis_native += pos.cost_basis_native ?? 0;
      if (Number.isFinite(pos.market_value_native))
        current.market_value_native += pos.market_value_native;
      if (Number.isFinite(pos.market_value_krw))
        current.market_value_krw += pos.market_value_krw;
      if (pos.valuation_status === "missing") current.unknownCount += 1;
      if (pos.valuation_status === "stale") current.staleCount += 1;
      if (pos.account_id) current.accounts.add(pos.account_id);
      aggregated.set(pos.ticker, current);
    }

    return state.instruments
      .filter((item) => item.instrument_type !== "fx")
      .map((instrument) => {
        const position = aggregated.get(instrument.ticker);
        const latestPrice = latestPriceByTicker.get(instrument.ticker);
        const tag = tagMapByTicker.get(instrument.ticker);
        const quantity = position?.quantity ?? 0;
        const avgCost =
          instrument.instrument_type === "market" && quantity > 0
            ? (position?.cost_basis_native ?? 0) / quantity
            : null;
        const priceChangePercent =
          Number.isFinite(latestPrice?.close_price) &&
          Number.isFinite(avgCost) &&
          avgCost > 0
            ? ((latestPrice.close_price - avgCost) / avgCost) * 100
            : null;
        return {
          ...instrument,
          tagId: tag?.id ? String(tag.id) : "",
          tagName: tag?.name ?? "Untagged",
          quantity,
          avgCost,
          cost_basis_native: position?.cost_basis_native ?? 0,
          priceChangePercent,
          market_value_native: position?.unknownCount
            ? null
            : (position?.market_value_native ?? 0),
          market_value_krw: position?.market_value_krw ?? 0,
          valuation_status: position?.unknownCount
            ? "missing"
            : position?.staleCount
              ? "stale"
              : "complete",
          unknownCount: position?.unknownCount ?? 0,
          staleCount: position?.staleCount ?? 0,
          accountCount: position?.accounts.size ?? 0,
          latestPrice:
            instrument.instrument_type === "market"
              ? (latestPrice?.close_price ?? null)
              : null,
          latestPriceDate: latestPrice?.price_date ?? "",
        };
      })
      .sort(
        (a, b) =>
          b.market_value_krw - a.market_value_krw ||
          a.display_name.localeCompare(b.display_name),
      );
  }, [
    state.instruments,
    computedPositions,
    latestPriceByTicker,
    tagMapByTicker,
  ]);

  const tagCards = useMemo(() => {
    const rows = instrumentRows.filter((row) => row.accountCount > 0);
    const byTag = new Map();
    for (const row of rows) {
      const tag = tagMapByTicker.get(row.ticker) ?? {
        id: "untagged",
        name: "Untagged",
      };
      const current = byTag.get(tag.id) ?? {
        ...tag,
        value: 0,
        costBasisKrw: 0,
        holdings: [],
        unknownCount: 0,
      };
      current.value += row.market_value_krw ?? 0;
      const convertedCost = nativeToKrw(
        row.cost_basis_native ?? 0,
        row.currency,
        latestPriceByTicker,
      );
      if (Number.isFinite(convertedCost)) current.costBasisKrw += convertedCost;
      current.unknownCount += row.unknownCount ?? 0;
      current.holdings.push(row);
      byTag.set(tag.id, current);
    }

    return [...byTag.values()]
      .map((tag) => ({
        ...tag,
        returnPercent:
          tag.unknownCount === 0 && tag.costBasisKrw > 0
            ? ((tag.value - tag.costBasisKrw) / tag.costBasisKrw) * 100
            : null,
        holdings: tag.holdings.sort(
          (a, b) => b.market_value_krw - a.market_value_krw,
        ),
      }))
      .sort((a, b) => b.value - a.value);
  }, [instrumentRows, tagMapByTicker, latestPriceByTicker]);

  return {
    accountById,
    computedPositions,
    holdingsByAccountId,
    holdingsByTicker,
    instrumentRows,
    latestPriceByTicker,
    tagCards,
    tagMapByTicker,
    totalValue,
    valuationQuality,
  };
}
