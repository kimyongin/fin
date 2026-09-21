const YAHOO_HOSTS = [
  'https://query1.finance.yahoo.com/v8/finance/chart',
  'https://query2.finance.yahoo.com/v8/finance/chart',
]

export type YahooPrice = { date: string; close: number }

export type YahooPriceResult = {
  prices: YahooPrice[]
  symbol: string
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function yahooTickerCandidates(ticker: string, sourceSymbol?: string | null) {
  const normalizedTicker = String(ticker ?? '').trim().toUpperCase()
  const normalizedSource = String(sourceSymbol ?? '').trim().toUpperCase()
  const candidates = normalizedSource ? [normalizedSource] : []
  const prefixedKrxShortCode = /^A[0-9A-Z]{6}$/.test(normalizedTicker)
  const krxShortCode = prefixedKrxShortCode
    ? normalizedTicker.slice(1)
    : normalizedTicker

  if (/^\d{6}$/.test(normalizedTicker) || prefixedKrxShortCode) {
    candidates.push(`${krxShortCode}.KS`, `${krxShortCode}.KQ`)
  } else if (/^\d{4}$/.test(normalizedTicker)) {
    candidates.push(`${normalizedTicker}.T`)
  }

  candidates.push(normalizedTicker)
  return [...new Set(candidates.filter(Boolean))]
}

async function fetchYahooChart(symbol: string, query: string) {
  let lastError: Error | null = null

  for (let attempt = 0; attempt < 3; attempt += 1) {
    for (const host of YAHOO_HOSTS) {
      const response = await fetch(`${host}/${encodeURIComponent(symbol)}?${query}`, {
        headers: {
          accept: 'application/json,text/plain,*/*',
          'user-agent': 'Mozilla/5.0',
        },
      })

      if (response.ok) {
        const data = await response.json()
        const result = data?.chart?.result?.[0]
        if (result?.meta) return result
        lastError = new Error(`Yahoo returned no data for ${symbol}`)
        break
      }

      if (response.status === 404) {
        lastError = new Error(`Yahoo symbol not found: ${symbol}`)
        break
      }

      lastError = new Error(`Yahoo response ${response.status} for ${symbol}`)
      if (response.status !== 429 && response.status < 500) break
    }

    if (attempt < 2 && lastError && !lastError.message.includes('not found')) {
      await wait(750 * (attempt + 1))
    } else {
      break
    }
  }

  throw lastError ?? new Error(`Yahoo request failed for ${symbol}`)
}

export async function fetchYahooPrices(
  ticker: string,
  sourceSymbol: string | null,
  dateFrom: Date,
  dateTo: Date,
): Promise<YahooPriceResult> {
  const period1 = Math.floor(dateFrom.getTime() / 1000)
  const inclusiveEnd = new Date(dateTo.getTime() + 86400000)
  const period2 = Math.floor(inclusiveEnd.getTime() / 1000)
  const failures: string[] = []

  for (const symbol of yahooTickerCandidates(ticker, sourceSymbol)) {
    try {
      const result = await fetchYahooChart(symbol, `interval=1d&period1=${period1}&period2=${period2}`)
      const timestamps: number[] = result.timestamp ?? []
      const closes: number[] = result.indicators?.quote?.[0]?.close ?? []
      const prices = timestamps
        .map((timestamp, index) => ({
          date: new Date(timestamp * 1000).toISOString().slice(0, 10),
          close: closes[index],
        }))
        .filter((row) => Number.isFinite(row.close))

      return { prices, symbol }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }

  throw new Error(failures.join('; ') || `Yahoo request failed for ${ticker}`)
}
