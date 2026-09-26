import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { fetchYahooPrices } from "../_shared/yahoo-finance.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, x-client-info, apikey",
};

interface SyncBody {
  date_from?: string;
  date_to?: string;
  tickers?: string[];
}

interface SyncResult {
  ticker: string;
  rows: number;
  latest_price_date: string | null;
  source_symbol: string;
}

interface SyncFailure {
  ticker: string;
  error: string;
}

function validDate(value: Date) {
  return !Number.isNaN(value.getTime());
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

  // Only this authenticated server route receives the service key. Client RPCs
  // cannot submit arbitrary provider prices or sync-run outcomes.
  const syncWriter = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body: SyncBody = req.headers.get("content-type")?.includes("application/json")
    ? await req.json()
    : {};

  const today = new Date();
  const dateTo = body.date_to ? new Date(body.date_to) : today;
  const dateFrom = body.date_from
    ? new Date(body.date_from)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  if (!validDate(dateFrom) || !validDate(dateTo) || dateFrom > dateTo) {
    return Response.json(
      { error: "A valid date range is required." },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const requestedTickers = body.tickers?.length
    ? [...new Set(body.tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))]
    : null;
  const { data: targetRows, error: targetError } = await supabase.rpc("app_get_price_sync_targets", {
    input_tickers: requestedTickers,
  });
  if (targetError) throw targetError;
  const tickers = (targetRows ?? []) as {
    ticker: string;
    source_symbol: string | null;
    last_price_date: string | null;
  }[];

  const synced: SyncResult[] = [];
  const failed: SyncFailure[] = [];

  for (const [index, { ticker, source_symbol, last_price_date }] of tickers.entries()) {
    try {
      const lastDate = last_price_date ?? null;

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
        } else {
          synced.push({ ticker, rows: 0, latest_price_date: lastDate, source_symbol: source_symbol ?? ticker });
          continue;
        }
      }

      if (fetchFrom > fetchTo) {
        synced.push({ ticker, rows: 0, latest_price_date: lastDate, source_symbol: source_symbol ?? ticker });
        continue;
      }

      const { prices, symbol } = await fetchYahooPrices(ticker, source_symbol, fetchFrom, fetchTo);

      if (prices.length === 0) {
        synced.push({ ticker, rows: 0, latest_price_date: lastDate, source_symbol: symbol });
        continue;
      }

      const { error: upsertError } = await syncWriter.rpc("app_sync_upsert_price_rows", {
        input_owner_user_id: user.id,
        input_ticker: ticker,
        input_source_symbol: symbol,
        input_prices: prices,
      });

      if (upsertError) throw new Error(upsertError.message);

      synced.push({
        ticker,
        rows: prices.length,
        latest_price_date: prices.at(-1)?.date ?? lastDate,
        source_symbol: symbol,
      });
    } catch (e) {
      failed.push({ ticker, error: (e as Error).message });
    } finally {
      if (index < tickers.length - 1) await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  const { error: runError } = await syncWriter.rpc("app_sync_record_price_run", {
    input_owner_user_id: user.id,
    input_total_count: tickers.length,
    input_synced_count: synced.length,
    input_failed: failed,
  });

  const status = synced.length === 0 && failed.length > 0
    ? "failed"
    : failed.length > 0 || runError
    ? "partial"
    : "success";

  return new Response(
    JSON.stringify({
      status,
      total_count: tickers.length,
      synced_count: synced.length,
      failed_count: failed.length,
      synced,
      failed,
      run_error: runError?.message ?? null,
    }),
    { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
  );
});
