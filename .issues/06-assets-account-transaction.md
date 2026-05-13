## What to build

자산 페이지의 `계좌` 탭과 `거래` 탭을 구현한다. 계좌 CRUD, 거래 CRUD를 포함하며, 거래 입력 시 holdings는 트리거가 자동 갱신한다.

도메인 언어는 `portfolio-app/CONTEXT.md`, holdings 재계산 트리거는 `#1` 참조.

## 계좌 탭

- 카드: 계좌명, 활성 상태 배지, 증권사, 보유 종목 수, 합계 KRW.
- 카드 내부에 수정 버튼 없음.

### 계좌 detail drawer 폼 필드

| 필드 | 타입 | 비고 |
|---|---|---|
| `name` | text | UNIQUE(user_id, name) |
| `broker` | text | 증권사 |
| `note` | textarea | |
| `is_active` | checkbox | 활성 여부 |

- 계좌에 `currency` 필드 없음 (통화는 Instrument 레벨에서 관리).

### Supabase 호출

| 작업 | 호출 |
|---|---|
| 계좌 목록 | `from('accounts').select().order('id')` |
| 계좌 생성/수정 | `from('accounts').upsert({...})` |
| 계좌 삭제 | `from('accounts').delete().eq('id', id)` — `holdings`, `transactions` CASCADE |

## 거래 탭

- **기본 로드**: 최근 30건, 최신순.
- **그룹 헤더**: 월별 또는 날짜별 (`2026-05 · 2건`).
- **더 보기**: `이전 거래 더 보기` 버튼으로 명시적 추가 로드. 자동 무한 스크롤 금지.
- 탭 상단 태그 필터 pill (자산 종목 탭과 같은 태그 마스터 공유).

### 거래 필터

`태그`, `기간`, `계좌`, `종목`, `BUY/SELL`, `실현손익 여부` 지원. 모바일에서는 접힌 panel로 제공. 카드 그룹 위에 `최근 거래 N건 · 최신순` 정보 라인 + 적용 필터 요약 라인.

### 거래 카드 표시

- row1: `거래일 · BUY/SELL` + 거래금액 (KRW 종목 `₩…`, USD 종목 USD 그대로)
- row2: `종목명 · 계좌` + 태그 outline 칩 + `수량 × 단가` + 수수료 또는 (SELL) `실현손익 ±₩…` 배지(success/danger)

### 거래 detail drawer

**헤더**: `거래일 · BUY/SELL` 타이틀 + 종목명·계좌 sub.

**stat-row 3칸:**
- BUY: `거래금액 / 수량 / 거래 타입`
- SELL: `거래금액 / 수량 / 실현손익(±, 색)`
- USD 종목: 마지막 칸을 `환율`로 대체

**거래 폼 필드:**

| 필드 | 타입 | 비고 |
|---|---|---|
| `trade_date` | date | |
| `trade_type` | dropdown | `BUY` / `SELL` |
| `account_id` | select | 계좌 목록 |
| `ticker` | select | instruments 마스터 — 옵션 라벨: `display_name (ticker · currency)` |
| `quantity` | number | |
| `price` | number | |
| `fee` | number | |
| `amount` | number (auto) | `quantity × price + fee`. 덮어쓰기 가능, 읽기 전용 표시 |
| `realized_pnl_krw` | 읽기 전용 | SELL만. 트리거가 채움 |
| 환율 (USD 종목) | 읽기 전용 | `USDKRW=X` 가격 표시 |
| `note` | textarea | |

- 통화는 종목 선택 시 `instruments.currency`에서 자동으로 채워진다.
- 수정/삭제는 drawer 우하단 sticky footer에서만 처리.
- 삭제는 drawer 안 `delete-confirm` 모드.
- 매도 수량 초과 시 트리거 예외 → SDK 에러 메시지를 drawer 안에 표시.

### holdings 갱신

- `from('transactions').insert(...)` 한 번이면 트리거가 `holdings`를 자동 갱신.
- 클라이언트가 `holdings`를 직접 수정하지 않는다 (Initial Load 예외는 #7에서 처리).

### 거래 drawer ID

- 거래별 고유 drawer id: `trade-{trade_date}-{ticker-slug}-{buy|sell}` 형식.
- 같은 종목의 여러 거래가 동시에 selected 되지 않는다.

## Acceptance criteria

- [ ] 계좌 탭 카드에 계좌명, 활성 배지, 증권사, 종목 수, 합계 KRW가 표시된다
- [ ] 계좌 폼에 `currency` 필드가 없다
- [ ] 계좌 삭제 시 holdings, transactions가 CASCADE 삭제된다
- [ ] 거래 탭이 최근 30건을 기본으로 로드하고 월별 그룹 헤더를 표시한다
- [ ] `이전 거래 더 보기` 버튼으로 명시적 추가 로드가 된다 (자동 무한 스크롤 없음)
- [ ] 태그/기간/계좌/종목/BUY-SELL/실현손익 여부 필터가 동작한다
- [ ] 거래 카드 row1에 `거래일 · BUY/SELL` + 거래금액, row2에 `종목명·계좌` + 태그 칩 + 수량×단가 + 수수료 또는 실현손익 배지가 표시된다
- [ ] 거래 폼에서 종목 선택 시 통화가 `instruments.currency`에서 자동으로 채워진다
- [ ] 거래 폼 종목 select 옵션 라벨이 `display_name (ticker · currency)` 형식이다
- [ ] `amount` 필드가 `quantity × price + fee`로 자동 계산된다
- [ ] SELL 거래의 `realized_pnl_krw`가 읽기 전용으로 표시된다
- [ ] 거래 추가/수정/삭제 후 holdings 값이 자동 갱신된다 (트리거 동작)
- [ ] 매도 수량 초과 시 SDK 에러가 drawer 안에 표시된다

## Blocked by

- #1 (스키마 — accounts, transactions, holdings 테이블)
- #2 (Auth)
