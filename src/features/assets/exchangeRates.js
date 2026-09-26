import { fxTickerForCurrency, isPriceStale } from '../../lib/portfolioMath'

export function exchangeRatesForPositions(positions, latestPriceByTicker, asOf = new Date()) {
  return [...new Set(positions.map((row) => row.currency).filter((currency) => fxTickerForCurrency(currency)))].sort().map((currency) => {
    const quote = latestPriceByTicker.get(fxTickerForCurrency(currency))
    const rate = Number.isFinite(quote?.close_price) && quote.close_price > 0 ? quote.close_price : null
    return { currency, rate, date: quote?.price_date ?? null, stale: rate !== null && isPriceStale(quote?.price_date, asOf) }
  })
}
