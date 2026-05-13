## What to build

보유 종목과 FX Rate의 누락 가격을 Yahoo Finance 비공식 JSON 엔드포인트에서 fetch해 `holding_prices_daily`에 upsert하는 Supabase Edge Function을 구현한다. 실행 결과는 `sync_runs`에 저장한다.

도메인 언어는 `portfolio-app/CONTEXT.md`, Yahoo Finance 비공식 엔드포인트 결정은 `docs/adr/0005-yahoo-finance-unofficial.md` 참조.

## 호출 인터페이스

```text
POST /functions/v1/sync-prices
Authorization: Bearer <user JWT>

Body (모두 선택):
{
  "date_from": "2026-05-01",
  "date_to":   "2026-05-07",
  "tickers":   ["VOO", "USDKRW=X"]
}
```

응답:

```json
{
  "synced": [
    { "ticker": "VOO", "rows": 5 },
    { "ticker": "USDKRW=X", "rows": 5 }
  ],
  "failed": [
    { "ticker": "133690", "error": "Yahoo response 404" }
  ]
}
```

## 동작

1. JWT 검증 (Supabase Auth). 미인증 → 401.
2. 대상 ticker 결정:
   - body에 `tickers` 명시 → 해당 목록만
   - 명시 없으면 → `instruments` 중 (현재 보유 종목 ∪ `instrument_type = 'fx'`)
3. 각 ticker에 대해:
   - `holding_prices_daily`에서 마지막 저장일 조회 → 다음 날부터 fetch 필요 날짜 산정
   - `source_symbol`이 있으면 외부 호출에 사용, 없으면 `ticker` 그대로 사용
   - Yahoo Finance 비공식 JSON fetch:
     ```
     https://query1.finance.yahoo.com/v8/finance/chart/<symbol>?interval=1d&range=...
     ```
   - 응답 파싱 → `holding_prices_daily` upsert (`on_conflict = user_id,ticker,price_date`)
4. 성공/실패 집계를 `sync_runs`에 insert.
5. 부분 실패는 `failed`에 담아 200으로 반환. 전체 장애는 500.

## Edge Function 위치

```text
supabase/functions/sync-prices/index.ts
```

- Deno runtime.
- `service_role key` 사용 안 함 — JWT로 받은 사용자 컨텍스트로 RLS 통과.

## 폴백

Yahoo 비공식 엔드포인트가 변경/차단될 수 있다. 실패한 ticker는 `sync_runs.failed`에 기록하고, 사용자는 자료 페이지 종목 detail drawer에서 `holding_prices_daily`를 직접 입력한다(`source = 'manual'`).

## Acceptance criteria

- [ ] `POST /functions/v1/sync-prices`가 user JWT를 검증하고 미인증 시 401을 반환한다
- [ ] body에 `tickers` 없으면 보유 종목 ∪ fx 타입 전체를 대상으로 처리한다
- [ ] 마지막 저장일 다음 날부터 누락된 날짜만 upsert한다 (이미 있는 날짜는 재요청하지 않는다)
- [ ] `source_symbol`이 있으면 Yahoo 호출에 `source_symbol`을 사용하고, 없으면 `ticker`를 사용한다
- [ ] 성공/실패 집계가 `sync_runs`에 insert된다
- [ ] 일부 ticker 실패 시 200 + `failed` 배열로 반환한다
- [ ] `service_role key`를 사용하지 않는다

## Blocked by

- #1 (스키마 — `holding_prices_daily`, `sync_runs`, `instruments` 테이블)
