## What to build

자료 페이지에서 누락된 가격을 수동으로 보완하는 기능을 구현한다. `sync-prices` Edge Function이 실패하거나 비공식 엔드포인트가 차단될 때의 폴백 경로다.

도메인 언어는 `portfolio-app/CONTEXT.md` 참조.

## 진입 경로

누락 가격 보완은 아래 두 곳에서 진입한다:

1. 자료 페이지 종목/환율 detail drawer의 **데이터 품질 요약** 섹션 — 누락/실패 일자 chip 또는 `누락 가격 보완` CTA
2. 종목 카드 danger 배지(failed) 클릭 → detail drawer 오픈 → 동일 CTA

별도 전용 페이지나 탭은 없다. 수동 보완은 **detail drawer 안 접이식 폼**으로 처리한다.

## 수동 보완 폼 필드

| 필드 | 타입 | 비고 |
|---|---|---|
| `price_date` | date | 누락 일자 (chip 클릭 시 자동 채워짐) |
| `close_price` | number | 종가 |
| `source` | 읽기 전용 | `'manual'` 고정 |

저장 시: `from('holding_prices_daily').upsert({ ticker, price_date, close_price, source: 'manual' }, { onConflict: 'user_id,ticker,price_date' })`

## 수동 보완 후 동작

- 저장 성공 → 가격 타임라인 차트 갱신 + 데이터 품질 요약 갱신.
- 동기화 배지가 `warning`(manual)으로 변경된다.

## 가격 탐색 정책

- 전체 가격 원장을 탐색하는 별도 drawer는 제공하지 않는다.
- 자료 페이지에서는 타임라인 차트 + 데이터 품질 요약으로 데이터 상태를 진단하고, 누락 일자만 수동 보완 진입점으로 노출한다.

## Acceptance criteria

- [ ] 종목 detail drawer에 데이터 품질 요약 섹션이 있다 (데이터 시작일, 마지막 동기화일, 누락/실패 일자)
- [ ] 누락 일자 chip 클릭 시 수동 보완 폼의 `price_date`가 자동으로 채워진다
- [ ] 수동 보완 폼이 `price_date`, `close_price` 필드를 갖는다
- [ ] 저장 시 `source = 'manual'`으로 `holding_prices_daily`에 upsert된다
- [ ] 저장 후 가격 타임라인 차트와 데이터 품질 요약이 갱신된다
- [ ] 동기화 배지가 수동 입력 후 `warning`(manual)으로 표시된다
- [ ] 전체 가격 원장을 탐색하는 별도 drawer는 존재하지 않는다

## Blocked by

- #1 (스키마)
- #2 (Auth)
- #4 (자료 페이지 Instrument + FX Rate + Tag CRUD — detail drawer 위에 구축)
