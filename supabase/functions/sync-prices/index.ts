import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, x-client-info, apikey",
};

const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

interface SyncBody {
  date_from?: string;
  date_to?: string;
  tickers?: string[];
}

interface SyncResult {
  ticker: string;
  rows: number;
}

interface SyncFailure {
  ticker: string;
  error: string;
}

async function fetchYahoo(
  symbol: string,
  dateFrom: Date,
  dateTo: Date
): Promise<{ date: string; close: number }[]> {
  const period1 = Math.floor(dateFrom.getTime() / 1000);
  const period2 = Math.floor(dateTo.getTime() / 1000);
  const url = `${YAHOO_BASE}/${encodeURIComponent(symbol)}?interval=1d&period1=${period1}&period2=${period2}`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`Yahoo response ${res.status}`);

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error("Yahoo response empty");

  const timestamps: number[] = result.timestamp ?? [];
  const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];

  return timestamps
    .map((ts, i) => {
      const d = new Date(ts * 1000);
      const dateStr = d.toISOString().slice(0, 10);
      return { date: dateStr, close: closes[i] };
    })
    .filter((r) => r.close != null && !isNaN(r.close));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });
  }

  const body: SyncBody = req.headers.get("content-type")?.includes("application/json")
    ? await req.json()
    : {};

  const today = new Date();
  const dateTo = body.date_to ? new Date(body.date_to) : today;
  const dateFrom = body.date_from
    ? new Date(body.date_from)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  let tickers: { ticker: string; source_symbol: string | null }[] = [];

  if (body.tickers && body.tickers.length > 0) {
    const { data } = await supabase
      .from("instruments")
      .select("ticker, source_symbol")
      .in("ticker", body.tickers);
    tickers = data ?? body.tickers.map((t) => ({ ticker: t, source_symbol: null }));
  } else {
    const { data: holdingTickers } = await supabase
      .from("holdings")
      .select("ticker");
    const { data: fxTickers } = await supabase
      .from("instruments")
      .select("ticker, source_symbol")
      .eq("instrument_type", "fx");

    const holdingSet = new Set((holdingTickers ?? []).map((h: { ticker: string }) => h.ticker));
    const { data: holdingInstruments } = holdingSet.size > 0
      ? await supabase
          .from("instruments")
          .select("ticker, source_symbol")
          .in("ticker", [...holdingSet])
      : { data: [] };

    const merged = new Map<string, string | null>();
    for (const r of [...(holdingInstruments ?? []), ...(fxTickers ?? [])]) {
      merged.set(r.ticker, r.source_symbol);
    }
    tickers = [...merged.entries()].map(([ticker, source_symbol]) => ({ ticker, source_symbol }));
  }

  const synced: SyncResult[] = [];
  const failed: SyncFailure[] = [];

  for (const { ticker, source_symbol } of tickers) {
    try {
      const [{ data: firstRow }, { data: lastRow }] = await Promise.all([
        supabase.from("holding_prices_daily").select("price_date").eq("ticker", ticker).order("price_date", { ascending: true }).limit(1).maybeSingle(),
        supabase.from("holding_prices_daily").select("price_date").eq("ticker", ticker).order("price_date", { ascending: false }).limit(1).maybeSingle()
      ]);

      const firstDate = firstRow?.price_date ?? null;
      const lastDate = lastRow?.price_date ?? null;

      let fetchFrom: Date;
      let fetchTo: Date;

      if (!lastDate) {
        fetchFrom = dateFrom;
        fetchTo = dateTo;
      } else {
        const nextDay = new Date(new Date(lastDate).getTime() + 86400000);
        if (nextDay <= dateTo) {
          fetchFrom = nextDay;
          fetchTo = dateTo;
        } else if (firstDate) {
          const earliest = new Date(firstDate);
          fetchTo = new Date(earliest.getTime() - 86400000);
          fetchFrom = new Date(earliest.getTime() - 90 * 86400000);
        } else {
          synced.push({ ticker, rows: 0 });
          continue;
        }
      }

      if (fetchFrom > fetchTo) {
        synced.push({ ticker, rows: 0 });
        continue;
      }

      const symbol = source_symbol ?? ticker;
      const prices = await fetchYahoo(symbol, fetchFrom, fetchTo);

      if (prices.length === 0) {
        synced.push({ ticker, rows: 0 });
        continue;
      }

      const rows = prices.map((p) => ({
        user_id: user.id,
        ticker,
        price_date: p.date,
        close_price: p.close,
        source: "yfinance",
      }));

      const { error: upsertError } = await supabase
        .from("holding_prices_daily")
        .upsert(rows, { onConflict: "user_id,ticker,price_date" });

      if (upsertError) throw new Error(upsertError.message);

      // Mark non-trading weekdays in the fetched range as holidays
      const tradingDaySet = new Set(prices.map(p => p.date));
      const holidayRows: { user_id: string; ticker: string; price_date: string; close_price: null; source: string }[] = [];
      for (let d = new Date(fetchFrom); d <= fetchTo; d.setDate(d.getDate() + 1)) {
        const dow = d.getDay();
        if (dow === 0 || dow === 6) continue;
        const dateStr = d.toISOString().slice(0, 10);
        if (!tradingDaySet.has(dateStr)) {
          holidayRows.push({ user_id: user.id, ticker, price_date: dateStr, close_price: null, source: "holiday" });
        }
      }
      if (holidayRows.length > 0) {
        await supabase
          .from("holding_prices_daily")
          .upsert(holidayRows, { onConflict: "user_id,ticker,price_date", ignoreDuplicates: true });
      }

      synced.push({ ticker, rows: prices.length });
    } catch (e) {
      failed.push({ ticker, error: (e as Error).message });
    }
  }

  await supabase.from("sync_runs").insert({
    user_id: user.id,
    total_count: tickers.length,
    synced_count: synced.length,
    failed_count: failed.length,
    failed: failed,
    started_by: "web",
  });

  return new Response(
    JSON.stringify({ synced, failed }),
    { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
  );
});
