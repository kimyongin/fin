import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function normalizeTickerInput(value: unknown) {
  return String(value ?? '').trim().toUpperCase()
}

function mapYahooInstrumentType(value: unknown) {
  const normalized = String(value ?? '').toUpperCase()
  if (normalized === 'ETF') return 'etf'
  if (normalized === 'MUTUALFUND') return 'fund'
  if (normalized === 'CURRENCY') return 'fx'
  if (normalized === 'EQUITY') return 'stock'
  return 'other'
}

function yahooTickerCandidates(ticker: string) {
  const normalized = normalizeTickerInput(ticker)
  const candidates = [normalized]

  if (/^\d{6}$/.test(normalized)) {
    candidates.push(`${normalized}.KS`, `${normalized}.KQ`)
  }

  return [...new Set(candidates)]
}

async function fetchYahooChart(symbol: string) {
  const response = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`,
    {
      headers: {
        'user-agent': 'Mozilla/5.0',
        accept: 'application/json,text/plain,*/*',
      },
    },
  )

  if (!response.ok) return null
  const data = await response.json()
  const meta = data?.chart?.result?.[0]?.meta
  if (!meta) return null

  return { data, meta }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const authHeader = req.headers.get('Authorization') ?? ''

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser()

    if (userError || !user) {
      return Response.json(
        { error: 'Authentication required.' },
        { status: 401, headers: corsHeaders },
      )
    }
    const { ticker: rawTicker } = await req.json()
    const ticker = normalizeTickerInput(rawTicker)

    if (!ticker) {
      return Response.json(
        { error: 'Ticker is required.' },
        { status: 400, headers: corsHeaders },
      )
    }

    let resolvedSymbol = ''
    let chartData: any = null
    let meta: any = null

    for (const candidate of yahooTickerCandidates(ticker)) {
      const result = await fetchYahooChart(candidate)
      if (result?.meta) {
        resolvedSymbol = candidate
        chartData = result.data
        meta = result.meta
        break
      }
    }

    if (!meta) {
      throw new Error('No ticker data found.')
    }

    const timestamps = Array.isArray(chartData?.chart?.result?.[0]?.timestamp)
      ? chartData.chart.result[0].timestamp
      : null
    const timestamp = timestamps?.length ? timestamps[timestamps.length - 1] : null
    const priceDate = Number.isFinite(timestamp)
      ? new Date(timestamp * 1000).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10)
    const displayName = meta.longName || meta.shortName || resolvedSymbol || ticker

    const result = {
      ticker,
      lookup_symbol: resolvedSymbol,
      display_name: displayName,
      currency: meta.currency ?? 'KRW',
      instrument_type: mapYahooInstrumentType(meta.instrumentType ?? matchedQuote?.quoteType),
      price: Number.isFinite(meta.regularMarketPrice) ? meta.regularMarketPrice : null,
      price_date: priceDate,
      source: 'registered',
    }

    const { error: instrumentError } = await userClient.from('instruments').upsert(
      {
        user_id: user.id,
        ticker,
        display_name: result.display_name,
        currency: result.currency,
        instrument_type: result.instrument_type,
        price_source: 'yfinance',
      },
      { onConflict: 'user_id,ticker' },
    )
    if (instrumentError) throw instrumentError

    if (Number.isFinite(result.price) && result.price > 0) {
      const { error: priceError } = await userClient.from('holding_prices_daily').upsert(
        {
          user_id: user.id,
          ticker,
          price_date: result.price_date,
          close_price: result.price,
          source: 'lookup',
        },
        { onConflict: 'user_id,ticker,price_date' },
      )
      if (priceError) throw priceError
    }

    return Response.json(result, { headers: corsHeaders })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Lookup failed.' },
      { status: 500, headers: corsHeaders },
    )
  }
})
