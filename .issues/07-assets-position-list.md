## What to build

자산 페이지의 `종목` 탭을 구현한다. `portfolio_view`에서 Position 목록을 표시하고, 각 Position의 detail drawer를 제공한다. Initial Load(거래 원장 없이 holdings 직접 입력) 기능 포함.

도메인 언어는 `portfolio-app/CONTEXT.md` (Holding vs Position 구분 포함) 참조.

## 자산 페이지 hero

- **큰 숫자**: 총 평가금액(KRW) = `SUM(portfolio_view.market_value_krw)`.
- **인라인 보조**: `+₩… (±%)` — 이번 달 변동. `portfolio_snapshots`의 월초/최근 스냅샷 차이.
- **보조 메타**: `N개 계좌 · M개 종목 · 마지막 가격 YYYY-MM-DD`.
- hero에 전역 액션 버튼 없음.

### 가격 누락 notice

- 환율(`USDKRW=X`) 또는 보유 종목의 최근 영업일 가격이 누락되면 hero 아래 amber notice + "자료에서 보완" CTA.

## 종목 탭

- 보유 종목 리스트: `portfolio_view`에서 `user_id = auth.uid()` 행 전체.

### 보유 종목 카드

- 1줄 요약: `종목명 · 티커` / `평가금액(KRW)` / 태그 outline 칩 · `수량 · 평균단가` · 손익% 배지(`success`/`danger`/`neutral`).
- 카드 내부에 수정/삭제 버튼 없음.
- **빈 상태**: 거래 추가 CTA. 가격 누락 시 자료 페이지 안내.

### 보유 종목 detail drawer

**헤더**: 종목명, 티커, 계좌명, prev/next/위치 칩, (모바일) 닫기.

**stat-row 3칸**: 평가금액(KRW), 미실현 손익(±, 색), 비중(%).

- 비중 = `market_value_krw / SUM(market_value_krw)` — 클라이언트가 계산.

**보유 직접 편집 (Initial Load):**

| 필드 | 타입 | 비고 |
|---|---|---|
| `quantity` | number | 수량 |
| `avg_price` | number | 평균단가 |
| `note` | textarea | |

- `holdings`에 직접 upsert: `from('holdings').upsert({ account_id, ticker, quantity, avg_price, note })`
- **경고 문구 포함**: "거래를 입력하면 트리거가 이 값을 덮어씁니다."
- 이후 `transactions`를 입력하면 트리거가 transactions 기준으로 재계산.

**거래 기록 feed:**

- 같은 종목의 최근 5건만 읽기 전용 요약.
- 하단 `이전 거래 더 보기` 버튼으로 drawer 안에서 과거 거래를 명시적으로 확장.
- 거래 수정/삭제는 `거래` 탭의 거래별 detail drawer에서만 처리한다.

**형제 탐색 정렬**: 계좌 그룹 → 비중 내림차순.

## Supabase 호출

| 작업 | 호출 |
|---|---|
| Position 목록 | `from('portfolio_view').select('*')` |
| 거래 기록 feed | `from('transactions').select().eq('ticker', ticker).eq('account_id', account_id).order('trade_date', desc).limit(5)` |
| 거래 더 보기 | 동일 쿼리 + cursor |
| Initial Load (holdings 직접) | `from('holdings').upsert({ account_id, ticker, quantity, avg_price, note })` |
| 포트폴리오 스냅샷 (hero 변동) | `from('portfolio_snapshots').select().order('snapshot_date')` |

## Acceptance criteria

- [ ] 자산 hero에 총 평가금액(KRW)이 `SUM(portfolio_view.market_value_krw)`로 표시된다
- [ ] 자산 hero에 이번 달 변동(`portfolio_snapshots` 기준)이 표시된다
- [ ] 환율 또는 보유 종목 가격 누락 시 hero 아래 amber notice가 표시된다
- [ ] 보유 종목 카드에 종목명·티커, 평가금액, 태그 칩, 수량·평균단가, 손익% 배지가 표시된다
- [ ] stat-row에 평가금액, 미실현 손익, 비중(%)이 표시된다
- [ ] 비중이 `market_value_krw / SUM(market_value_krw)`으로 클라이언트에서 계산된다
- [ ] 보유 직접 편집(Initial Load) 폼에 `quantity`, `avg_price`, `note`가 있고 트리거 덮어쓰기 경고 문구가 표시된다
- [ ] 거래 기록 feed가 최근 5건만 표시되고 `이전 거래 더 보기`로 확장된다
- [ ] drawer 헤더에 prev/next + `1/N` 위치가 있고 비중 내림차순으로 형제 탐색된다
- [ ] 빈 상태에서 거래 추가 CTA가 표시된다

## Blocked by

- #1 (스키마 — holdings, portfolio_view, portfolio_snapshots)
- #2 (Auth)
- #6 (계좌 + 거래 CRUD — 거래 feed 연동)
