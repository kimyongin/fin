# Portfolio App PRD

> **역할:** Vercel 기반 Next.js 프로젝트 셋업·배포와 Supabase 백엔드(스키마, RLS, 트리거, `sync-prices` Edge Function, Storage)를 하나의 단위로 소유한다.
>
> 페이지·드로어·차트·상호작용 등 **UI 명세**는 [PRD_PORTFOLIO_UI.md](./PRD_PORTFOLIO_UI.md)가 소유한다. 본 PRD는 그 UI가 의존하는 데이터·인증·플랫폼을 정의한다.

풀 BaaS 아키텍처에서 백엔드는 Supabase 설정(마이그레이션 + 1개 Edge Function)에 불과하고, 실제 코드는 Next.js 앱이 들고 있다. 두 영역은 같은 레포에서 함께 변하므로 단일 PRD로 관리한다. Skills(Market Analysis, Rebalancing)는 같은 Supabase 프로젝트에 직접 접근하지만 별도 스킬이며, 본 PRD의 책임 범위 밖이다.

---

# 1. 책임

1. Supabase Postgres DB 스키마, RLS 정책, holdings 재계산 트리거, `portfolio_view` 소유
2. Supabase Storage `reports` 버킷 + RLS 소유 (리포트/리밸런싱 본문 저장)
3. `sync-prices` Edge Function 소유 (Yahoo Finance JSON 엔드포인트 호출)
4. Supabase Auth 설정 (이메일 로그인 링크 + Skills용 동일 포트폴리오 소유자 이메일/비밀번호 로그인)
5. Next.js 프로젝트 셋업·디렉토리 구조·환경 변수·Vercel 배포 (페이지·컴포넌트·드로어 명세는 [PRD_PORTFOLIO_UI.md](./PRD_PORTFOLIO_UI.md))
6. 합산/비중 등 표시용 후처리 (DB view가 평가금액·손익은 이미 계산해서 반환)
7. `supabase gen types`로 TypeScript 타입을 자동 생성하고 커밋

비책임:

- 페이지/라우트별 UI, drawer form 동작, 차트, 시각 토큰, UI 데이터 매핑 — [PRD_PORTFOLIO_UI.md](./PRD_PORTFOLIO_UI.md)가 소유
- Skills(Market Analysis, Rebalancing) 구현
- 외부 가격 데이터 수집 로직(yfinance) — Skills에서 처리
- 시장 분석 리포트/리밸런싱 제안 생성 로직 — Skills에서 처리

---

# 2. 기술 스택

```text
Next.js (App Router)
React
TypeScript
Tailwind CSS
Recharts
Zod
date-fns
@supabase/supabase-js
@supabase/ssr             # Next.js 세션 관리

Supabase Postgres + RLS
Supabase Auth (Email OTP / Magic Link, shown as "로그인 링크" in UI)
Supabase Edge Functions (Deno)  # sync-prices 1개
```

배포:

```text
Web:      Vercel Free
Backend:  Supabase Free (DB 500MB, Edge Functions 500K invocations/month, Auth 50K MAU)
```

---

# 3. 디렉토리 구조

```text
fin/
├── app/                       # Next.js App Router
│   ├── assets/                # 자산: 계좌 + 보유종목 + 거래 통합 (기본 진입 라우트)
│   ├── analysis/              # 분석: 리포트 + 리밸런싱 통합
│   ├── data/                  # 자료: 종목 마스터 + 가격 데이터
│   ├── login/
│   └── auth/callback/
│
├── components/
│   ├── charts/
│   ├── forms/
│   ├── layout/
│   └── cards/
│
├── lib/
│   ├── supabase/
│   │   ├── client.ts          # createBrowserClient
│   │   ├── server.ts          # createServerClient
│   │   └── types.ts           # `supabase gen types typescript --linked`로 자동 생성
│   ├── portfolio/
│   │   ├── presentation.ts    # 평가금액/비중 계산
│   │   └── currency.ts        # KRW 환산
│   └── validators/            # Zod 스키마
│
├── supabase/
│   ├── migrations/
│   │   ├── 001_schema.sql           # 테이블 DDL (user_id 포함)
│   │   ├── 002_rls.sql              # RLS 정책 (auth.uid() = user_id) + Storage 정책
│   │   ├── 003_holdings_trigger.sql # 재계산 트리거
│   │   ├── 004_portfolio_view.sql   # 평가금액 계산 view
│   │   └── 005_storage_bucket.sql   # `reports` 버킷 생성 (private)
│   ├── functions/
│   │   └── sync-prices/             # Edge Function
│   └── seed.sql                     # 기본 instruments(USDKRW=X 등)
│
└── package.json
```

---

# 4. 환경 변수

| 위치 | 키 |
|---|---|
| Vercel (Web) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Edge Function | Supabase 런타임이 자동 주입 |

- Web App과 Skills 모두 `anon key` + Supabase Auth 세션으로 접근한다.
- `service_role key`는 사용하지 않는다.
- `anon key`는 공개되어도 안전(RLS가 보호).

---

# 5. 인증

- Supabase Auth(이메일 로그인 링크)로 로그인.
- 구현 방식은 Supabase Email OTP(Magic Link)이며, 사용자 화면에는 "매직링크" 대신 "로그인 링크"로 표기한다.
- 로그인 페이지(`/login`)에서 이메일 입력 → 로그인 링크 발송.
- 콜백 라우트(`/auth/callback`)에서 세션 쿠키 설정 후 `/assets`로 리다이렉트.
- 모바일에서는 이메일 앱을 거쳐 링크가 열릴 수 있으므로, 로그인 화면에 현재 브라우저의 세션을 다시 확인하는 `로그인 완료 확인` 액션을 제공한다. 실제 구현은 `supabase.auth.getSession()`으로 현재 브라우저의 세션 존재 여부를 확인한다.
- 미인증 상태로 보호 라우트 접근 시 `/login`으로 리다이렉트 (Next.js middleware).
- 초기 릴리스는 단일 사용자 가정. Supabase Auth 설정에서 허용 이메일을 본인 1개로 제한하거나 invite-only로 운영.

---

# 6. DB 스키마

## 6.1 테이블 역할

| 테이블 | 역할 |
|---|---|
| `accounts` | 투자 계좌 목록. 계좌는 포트폴리오 컨테이너이며 통화는 갖지 않는다. |
| `instruments` | 티커 코드와 표시명, 통화, 가격 수집 소스를 관리하는 종목 마스터. `USDKRW=X` 같은 환율 코드도 포함. |
| `tags` | 사용자가 자료 페이지에서 관리하는 태그 마스터. |
| `instrument_tags` | 종목과 태그의 다대다 연결. 자산 태그 필터의 기준. |
| `holdings` | 계좌별 현재 보유 종목 상태. **`transactions` 트리거가 자동 갱신.** |
| `transactions` | 매수/매도 거래 원장. holdings 재계산의 근거. |
| `holding_prices_daily` | 보유 종목과 환율 코드의 일별 종가. |
| `daily_reports` | Market Analysis Skill의 리포트 요약과 Storage `storage_path`. |
| `rebalance_suggestions` | Rebalancing Skill의 제안, 액션, 사용자 결정 상태. |

## 6.2 DDL

```sql
CREATE TABLE accounts (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) DEFAULT auth.uid(),
    name TEXT NOT NULL,
    broker TEXT,
    note TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, name)
);

CREATE TABLE instruments (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) DEFAULT auth.uid(),
    ticker TEXT NOT NULL,
    display_name TEXT NOT NULL,
    instrument_type TEXT NOT NULL CHECK (instrument_type IN ('stock', 'etf', 'fund', 'fx', 'cash', 'other')),
    currency TEXT NOT NULL,
    price_source TEXT DEFAULT 'yfinance',
    source_symbol TEXT,
    note TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, ticker)
);

CREATE TABLE tags (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) DEFAULT auth.uid(),
    name TEXT NOT NULL,
    color TEXT DEFAULT 'neutral',
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, name)
);

CREATE TABLE instrument_tags (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) DEFAULT auth.uid(),
    ticker TEXT NOT NULL,
    tag_id BIGINT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, ticker, tag_id),
    FOREIGN KEY (user_id, ticker) REFERENCES instruments(user_id, ticker)
);

CREATE TABLE holdings (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) DEFAULT auth.uid(),
    account_id BIGINT REFERENCES accounts(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL,
    quantity REAL NOT NULL,
    avg_price REAL NOT NULL,
    note TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(account_id, ticker),
    FOREIGN KEY (user_id, ticker) REFERENCES instruments(user_id, ticker)
);

CREATE TABLE transactions (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) DEFAULT auth.uid(),
    account_id BIGINT REFERENCES accounts(id) ON DELETE CASCADE,
    trade_date DATE NOT NULL,
    ticker TEXT NOT NULL,
    trade_type TEXT NOT NULL CHECK (trade_type IN ('BUY', 'SELL')),
    quantity REAL NOT NULL,
    price REAL NOT NULL,
    amount REAL NOT NULL,
    fee REAL DEFAULT 0,
    realized_pnl_krw REAL,
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (user_id, ticker) REFERENCES instruments(user_id, ticker)
);
-- 거래 통화는 instruments.currency로 도출하므로 transactions.currency를 별도 저장하지 않음.

CREATE TABLE holding_prices_daily (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) DEFAULT auth.uid(),
    ticker TEXT NOT NULL,
    price_date DATE NOT NULL,
    close_price REAL NOT NULL,
    source TEXT DEFAULT 'manual',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, ticker, price_date),
    FOREIGN KEY (user_id, ticker) REFERENCES instruments(user_id, ticker)
);
-- 가격의 통화는 instruments.currency로 도출(`USDKRW=X`는 fx 타입, KRW로 표시).

CREATE TABLE daily_reports (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) DEFAULT auth.uid(),
    report_date DATE NOT NULL,
    headline TEXT,
    market_impact_summary TEXT,
    trade_suggestions JSONB,
    risk_warnings JSONB,
    cycle_phase TEXT CHECK (cycle_phase IN ('recovery', 'caution', 'neutral')),
    indicators JSONB,
    news_count INT,
    storage_path TEXT,    -- Supabase Storage 경로: {user_id}/daily/{report_date}.md
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, report_date)
);

CREATE TABLE rebalance_suggestions (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) DEFAULT auth.uid(),
    suggestion_date DATE NOT NULL,
    investment_amount REAL,
    reasoning TEXT,
    actions JSONB,
    based_on_reports JSONB,
    storage_path TEXT,    -- Supabase Storage 경로: {user_id}/rebalancing/{suggestion_date}.md
    user_decision JSONB,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'partial')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE portfolio_snapshots (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) DEFAULT auth.uid(),
    snapshot_date DATE NOT NULL,
    total_value_krw REAL NOT NULL,
    unrealized_pnl_krw REAL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, snapshot_date)
);

CREATE TABLE sync_runs (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) DEFAULT auth.uid(),
    run_at TIMESTAMPTZ DEFAULT NOW(),
    total_count INT NOT NULL DEFAULT 0,
    synced_count INT NOT NULL DEFAULT 0,
    failed_count INT NOT NULL DEFAULT 0,
    failed JSONB DEFAULT '[]'::jsonb,
    started_by TEXT NOT NULL CHECK (started_by IN ('web', 'market-analysis-skill', 'manual')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

정규화 변경:
- `transactions.currency`, `holding_prices_daily.currency` 제거. 모두 `instruments.currency`로 join.
- 사용자 분류는 보유 테이블 컬럼이 아니라 `tags` + `instrument_tags`의 관리형 태그로 처리한다.
- `rebalance_suggestions.status`에 CHECK 제약 추가.
- `daily_reports.cycle_phase`는 `recovery`/`caution`/`neutral` 표준값으로 저장하고 UI는 회복/주의/중립으로 표시.
- `transactions.realized_pnl_krw`는 SELL 거래의 실현손익 표시용 컬럼이다. BUY 거래는 `NULL`.
- `portfolio_snapshots`는 자산 hero의 기간 변동(예: 이번 달 +₩.../±%) 계산에 사용한다.
- `sync_runs`는 자료 hero의 `synced/total`, 마지막 실행 시각, 실패 ticker 표시 기준이다.
- `accounts(user_id, name)` UNIQUE, `daily_reports(user_id, report_date)` UNIQUE로 다중 사용자 호환.

`user_id` 정책:
- 모든 테이블에 `user_id UUID NOT NULL REFERENCES auth.users(id) DEFAULT auth.uid()`.
- Web App과 Skills 모두 로그인 세션을 거치므로 INSERT 시 자동으로 현재 사용자 id가 채워진다.
- 단일 사용자 단계에선 포트폴리오 소유자 1명의 id만 모든 행에 들어간다. 다중 사용자 대비를 위해 종목과 가격도 `user_id + ticker` 기준으로 격리한다.

## 6.3 RLS 정책

모든 테이블에 RLS를 활성화하고 `auth.uid() = user_id` 단일 정책을 적용한다. 단일 사용자 단계에서도 정책을 단순 통과형(`USING (true)`)으로 두지 않고 실제 권한 모델로 가동해 다중 사용자 확장 비용을 0에 가깝게 만든다.

```sql
ALTER TABLE accounts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE instruments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE instrument_tags      ENABLE ROW LEVEL SECURITY;
ALTER TABLE holdings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE holding_prices_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_reports        ENABLE ROW LEVEL SECURITY;
ALTER TABLE rebalance_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_snapshots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_runs            ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_all" ON accounts
    FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
-- 나머지 테이블에 동일 정책 반복 적용 (테이블명만 교체)

-- Storage 버킷 RLS: reports 버킷의 객체는 본인 폴더({user_id}/...) 만 접근 가능
CREATE POLICY "owner_storage" ON storage.objects
    FOR ALL TO authenticated
    USING (
        bucket_id = 'reports'
        AND (storage.foldername(name))[1] = auth.uid()::text
    )
    WITH CHECK (
        bucket_id = 'reports'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );
```

- Web App과 Skills 모두 Supabase Auth 세션으로 접근하며 `service_role key`는 사용하지 않는다.
- INSERT 시 `user_id`는 컬럼 DEFAULT(`auth.uid()`)로 자동 채워지므로 클라이언트가 명시할 필요 없다.
- 다중 사용자 확장 시 정책 변경이 필요 없다(이미 사용자별 격리 완료).

## 6.4 종목 마스터 정책

- `ticker`는 외부 가격 소스와 클라이언트 쿼리에서 사용하는 식별 코드.
- `ticker`는 사용자별로 유일하다(`UNIQUE(user_id, ticker)`). 같은 ticker라도 다른 사용자 데이터와 섞이지 않는다.
- `display_name`은 화면 표시용 이름.
- 보유 종목/거래/가격 테이블에는 `ticker`를 저장하고, 화면 표시 시 `instruments.display_name`을 join.
- `USDKRW=X`는 Yahoo Finance/yfinance에서 사용하는 USD/KRW 환율 티커. 상수가 아니라 `instrument_type = 'fx'`인 시스템 종목으로 등록.
- 가격 수집 시 `source_symbol`이 있으면 외부 호출에 사용, 내부 저장은 `ticker`. 값이 없으면 `ticker`를 그대로 사용.

예시:

| ticker | display_name | instrument_type | currency | price_source |
|---|---|---|---|---|
| `133690` | TIGER 미국나스닥100 | etf | KRW | yfinance |
| `VOO` | Vanguard S&P 500 ETF | etf | USD | yfinance |
| `USDKRW=X` | USD/KRW 환율 | fx | KRW | yfinance |

## 6.5 Holdings 갱신 정책

- `holdings`는 **`transactions` 트리거가 자동 갱신**하는 파생 테이블.
- 클라이언트는 holdings를 직접 insert/update 하지 않는다. 거래만 입력하면 트리거가 처리.
- **예외(초기 적재):** 거래 원장 없이 현재 보유 상태를 처음 등록하는 경우는 `holdings`에 직접 insert해도 된다. 이후 거래를 입력하면 트리거가 transactions 기준으로 재계산하므로 초기값을 덮어쓴다는 점에 유의.

## 6.6 날짜/시간 정책

- 모든 `DATE` 타입 컬럼(`report_date`, `suggestion_date`, `trade_date`, `price_date`)은 **한국 시간(KST, UTC+9) 기준** 날짜.
- `TIMESTAMPTZ` 컬럼은 UTC로 저장하며, 표시 시 클라이언트가 KST로 변환.
- Market Analysis Skill의 07:00 트리거는 KST 기준이며, `report_date`는 트리거 당일의 KST 날짜.

---

# 7. Holdings 재계산 트리거

`transactions` 테이블의 INSERT/UPDATE/DELETE 시 해당 `(account_id, ticker)` 조합의 holding을 전체 거래 원장에서 재계산한다.

## 7.1 알고리즘

```text
대상: 변경된 (account_id, ticker)

1. 해당 조합의 모든 거래를 trade_date, created_at 순으로 조회
2. total_qty=0, total_cost=0, avg_price=0, realized_pnl_krw=NULL
3. 각 거래에 대해:
   - BUY: total_qty += qty
          total_cost += qty * price
          avg_price = total_cost / total_qty (total_qty > 0)
   - SELL: total_qty -= qty
           avg_price 변경 없음
           realized_pnl_krw = 매도수량 * (매도가 - 당시 avg_price) * 환율(KRW 종목은 1)
4. holdings에 UPSERT (UNIQUE(account_id, ticker))
```

- 수수료(`fee`)는 평균단가와 실현손익 계산에 포함하지 않는다.
- 매도 후 재매수 시, 잔여 수량과 잔여 평균단가에서 누적을 이어간다.
- 매도 수량이 누적 잔량을 초과하면 트리거가 `RAISE EXCEPTION` → 트랜잭션 롤백.
- 재계산 후 수량이 0이 되면 `holdings.quantity = 0`, `avg_price`는 마지막 값 유지. 행은 삭제하지 않는다.

## 7.2 PL/pgSQL 골격

실현손익은 `transactions` INSERT/UPDATE 전에 별도 `BEFORE` 트리거가 `NEW.realized_pnl_krw`를 계산한다. 아래 holdings 재계산 트리거는 거래가 확정된 뒤 현재 보유 상태를 다시 만든다.

```sql
-- 구현 시 포함: transactions_realized_pnl_trigger
-- BEFORE INSERT OR UPDATE ON transactions
-- SELL이면 당시 평균단가와 환율을 기준으로 NEW.realized_pnl_krw를 채우고,
-- BUY이면 NEW.realized_pnl_krw = NULL 로 둔다.

CREATE OR REPLACE FUNCTION recalc_holding(p_account_id BIGINT, p_ticker TEXT)
RETURNS VOID AS $$
DECLARE
    r RECORD;
    total_qty REAL := 0;
    total_cost REAL := 0;
    avg_price REAL := 0;
BEGIN
    FOR r IN
        SELECT trade_type, quantity, price
        FROM transactions
        WHERE account_id = p_account_id AND ticker = p_ticker
        ORDER BY trade_date, created_at
    LOOP
        IF r.trade_type = 'BUY' THEN
            total_qty := total_qty + r.quantity;
            total_cost := total_cost + r.quantity * r.price;
            IF total_qty > 0 THEN
                avg_price := total_cost / total_qty;
            END IF;
        ELSIF r.trade_type = 'SELL' THEN
            IF r.quantity > total_qty THEN
                RAISE EXCEPTION 'Sell quantity exceeds holdings for %, %', p_account_id, p_ticker;
            END IF;
            total_qty := total_qty - r.quantity;
            total_cost := avg_price * total_qty;  -- 평단 유지
        END IF;
    END LOOP;

    INSERT INTO holdings (account_id, ticker, quantity, avg_price, updated_at)
    VALUES (p_account_id, p_ticker, total_qty, avg_price, NOW())
    ON CONFLICT (account_id, ticker)
    DO UPDATE SET quantity = EXCLUDED.quantity,
                  avg_price = EXCLUDED.avg_price,
                  updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION transactions_recalc_trigger()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM recalc_holding(OLD.account_id, OLD.ticker);
        RETURN OLD;
    ELSE
        PERFORM recalc_holding(NEW.account_id, NEW.ticker);
        IF TG_OP = 'UPDATE' AND
           (OLD.account_id <> NEW.account_id OR OLD.ticker <> NEW.ticker) THEN
            PERFORM recalc_holding(OLD.account_id, OLD.ticker);
        END IF;
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transactions_recalc
AFTER INSERT OR UPDATE OR DELETE ON transactions
FOR EACH ROW EXECUTE FUNCTION transactions_recalc_trigger();
```

- 트리거가 transaction 안에서 실행되므로 매도 초과 시 거래 입력도 함께 롤백.
- 클라이언트는 `supabase.from('transactions').insert(...)` 한 번만 호출.

---

# 8. Edge Function: sync-prices

## 8.1 역할

- 호출 주체는 **Web App "동기화" 버튼**이다. 스킬에서는 호출하지 않는다.
- 현재 보유 중이거나 `instrument_type = 'fx'`인 종목의 가격을 Yahoo Finance JSON 엔드포인트에서 fetch.
- 각 ticker별로 `holding_prices_daily`의 마지막 저장일을 조회하고, 다음 날부터 누락된 날짜만 upsert.
- 실행 결과는 `sync_runs`에 저장해 자료 페이지 hero와 동기화 결과 피드의 기준으로 사용한다.
- Yahoo는 공식 API/인증 키가 없음. yfinance가 내부적으로 호출하는 비공식 JSON 엔드포인트를 직접 fetch:
  ```
  https://query1.finance.yahoo.com/v8/finance/chart/<source_symbol>?interval=1d&range=...
  ```

## 8.2 호출 인터페이스

```text
POST /functions/v1/sync-prices
Authorization: Bearer <user JWT>      ← Supabase Auth 세션 토큰

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

## 8.3 동작

1. JWT 검증 (Supabase Auth). 미인증 401.
2. 대상 ticker 결정:
   - body에 `tickers` 명시 → 해당 목록만
   - 아니면 instruments 중 (현재 보유 종목 ∪ fx 타입)
3. 각 ticker에 대해:
   - 마지막 저장일 조회 → 다음 날부터 fetch 필요 날짜 산정
   - `source_symbol` 또는 `ticker`로 Yahoo JSON fetch
   - 응답 파싱 → `holding_prices_daily` upsert (`on_conflict = user_id,ticker,price_date`)
4. 성공/실패 집계를 `sync_runs`에 insert.
5. 부분 실패는 `failed`에 담아 200으로 반환. 전체 장애는 500.

## 8.4 폴백

Yahoo 비공식 엔드포인트가 변경/차단될 수 있다. 실패 시 사용자가 자료 > 환율/종목 탭의 detail drawer form에서 `holding_prices_daily`를 직접 입력한다(`source = manual`).

---

# 9. 통화 환산 및 portfolio_view

평가금액/손익/비중은 Postgres view에서 계산해 클라이언트가 한 번의 select로 받도록 한다. 클라이언트는 view를 select만 하고 계산식 자체를 갖지 않는다.

## 9.1 환산 규칙

```text
if instrument.currency == 'KRW':
    market_value_krw = quantity * close_price

if instrument.currency == 'USD':
    market_value_krw = quantity * close_price * USDKRW_close
```

- `USDKRW_close`는 같은 `user_id`의 `holding_prices_daily`에서 `ticker = 'USDKRW=X'`와 동일 또는 직전 영업일의 가격.
- 종목 통화는 `instruments.currency`에서 가져온다(holdings/transactions에 저장하지 않음).

## 9.2 portfolio_view 정의

```sql
CREATE VIEW portfolio_view
WITH (security_invoker = true)  -- 호출자 권한으로 RLS 적용
AS
WITH latest_price AS (
    SELECT DISTINCT ON (user_id, ticker)
        user_id, ticker, price_date, close_price
    FROM holding_prices_daily
    ORDER BY user_id, ticker, price_date DESC
),
fx AS (
    SELECT user_id, price_date, close_price AS usdkrw
    FROM holding_prices_daily
    WHERE ticker = 'USDKRW=X'
)
SELECT
    h.id,
    h.user_id,
    h.account_id,
    a.name AS account_name,
    h.ticker,
    i.display_name,
    i.currency,
    i.instrument_type,
    h.quantity,
    h.avg_price,
    h.note,
    p.close_price,
    p.price_date,
    -- market_value_native
    (h.quantity * p.close_price) AS market_value_native,
    -- market_value_krw
    CASE
        WHEN i.currency = 'KRW' THEN h.quantity * p.close_price
        WHEN i.currency = 'USD' THEN h.quantity * p.close_price *
            COALESCE(
                (SELECT usdkrw FROM fx WHERE user_id = h.user_id AND price_date = p.price_date),
                (SELECT usdkrw FROM fx WHERE user_id = h.user_id AND price_date <= p.price_date ORDER BY price_date DESC LIMIT 1)
            )
        ELSE NULL
    END AS market_value_krw,
    -- unrealized_pnl_krw
    CASE
        WHEN i.currency = 'KRW' THEN h.quantity * (p.close_price - h.avg_price)
        WHEN i.currency = 'USD' THEN h.quantity * (p.close_price - h.avg_price) *
            COALESCE(
                (SELECT usdkrw FROM fx WHERE user_id = h.user_id AND price_date = p.price_date),
                (SELECT usdkrw FROM fx WHERE user_id = h.user_id AND price_date <= p.price_date ORDER BY price_date DESC LIMIT 1)
            )
        ELSE NULL
    END AS unrealized_pnl_krw
FROM holdings h
JOIN instruments i ON i.user_id = h.user_id AND i.ticker = h.ticker
JOIN accounts a ON a.user_id = h.user_id AND a.id = h.account_id
LEFT JOIN latest_price p ON p.user_id = h.user_id AND p.ticker = h.ticker;
```

- `security_invoker = true`로 view를 만들어 호출자(`auth.uid()`)의 RLS가 그대로 적용된다.
- `weight_pct`는 view에서 직접 계산하지 않고 클라이언트가 `market_value_krw / SUM(market_value_krw) * 100`으로 계산(view에서 window function 사용 시 필터 조합이 까다로워짐).

## 9.3 클라이언트 사용

```ts
const { data: portfolio } = await supabase
  .from('portfolio_view')
  .select('*')

// total_value_krw, weight_pct는 클라이언트에서 합산/비율 계산
```

`lib/portfolio/presentation.ts`는 합산과 비중 계산만 담당하고 환율/평가금액 계산식은 갖지 않는다.

---

# 10. JSONB 스키마

클라이언트가 SDK로 insert/select 할 때 따르는 스키마. DB 차원 검증은 하지 않으므로 클라이언트에서 Zod로 검증한다.

## 10.1 `daily_reports.trade_suggestions`

```json
[
  { "action": "BUY", "ticker": "133690", "display_name": "TIGER 미국나스닥100", "reason": "..." }
]
```

- `action`: `"BUY"` | `"SELL"` | `"HOLD"`

## 10.2 `daily_reports.risk_warnings`

```json
[
  { "level": "high", "message": "..." }
]
```

- `level`: `"low"` | `"medium"` | `"high"`

## 10.3 `daily_reports.indicators`

```json
{
  "sp500": 5200.1,
  "sp500_change_pct": -0.5,
  "nasdaq": 18300.2,
  "nasdaq_change_pct": -0.8,
  "kospi": 2680.5,
  "kospi_change_pct": 0.3,
  "usdkrw": 1380.0,
  "vix": 18.5
}
```

## 10.4 `rebalance_suggestions.actions`

```json
[
  {
    "account_name": "미래에셋 일반",
    "ticker": "133690",
    "display_name": "TIGER 미국나스닥100",
    "action": "BUY",
    "quantity": 50,
    "estimated_amount_krw": 2500000,
    "reason": "미국 성장주 비중 확대"
  }
]
```

## 10.5 `rebalance_suggestions.based_on_reports`

```json
[
  { "report_date": "2026-05-05", "headline": "나스닥 반등, 성장주 매수 기회" }
]
```

## 10.6 `rebalance_suggestions.user_decision`

```json
{
  "decided_at": "2026-05-06",
  "note": "나스닥 50주만 매수, 채권 조정은 보류",
  "partially_applied": ["미래에셋 일반 TIGER 미국나스닥100 50주 매수"]
}
```

---

# 11. Supabase SDK 사용 패턴

## 11.1 클라이언트 초기화

```ts
// lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr'
export const supabase = () =>
  createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

// lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
export const supabaseServer = () =>
  createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { ... } }
  )
```

## 11.2 호출 매핑

| 작업 | 호출 |
|---|---|
| 계좌 목록 | `from('accounts').select().order('id')` |
| 계좌 추가/수정 | `from('accounts').upsert({...})` |
| 계좌 삭제 | `from('accounts').delete().eq('id', id)` (CASCADE) |
| 종목 마스터 | `from('instruments').select / upsert` |
| 태그 마스터 | `from('tags').select / upsert / delete` |
| 종목 태그 연결 | `from('instrument_tags').select / insert / delete` |
| 보유 종목 (계산 포함) | `from('portfolio_view').select()` |
| 보유 종목 원본 (편집) | `from('holdings').select/upsert/delete` |
| 거래 입력/수정/삭제 | `from('transactions').insert/update/delete()` (트리거가 holdings 갱신) |
| 가격 조회 | `from('holding_prices_daily').select(...)` |
| 가격 직접 저장 | `from('holding_prices_daily').upsert(..., { onConflict: 'user_id,ticker,price_date' })` |
| 가격 동기화 | `functions.invoke('sync-prices', { body: {...} })` |
| 동기화 이력 조회 | `from('sync_runs').select().order('run_at', { ascending: false }).limit(1)` |
| 포트폴리오 스냅샷 조회 | `from('portfolio_snapshots').select().order('snapshot_date')` |
| 리포트 조회 | `from('daily_reports').select().order('report_date', { ascending: false }).limit(14)` |
| 리밸런싱 제안 조회 | `from('rebalance_suggestions').select().order(...)` |
| 리밸런싱 결정 갱신 | `from('rebalance_suggestions').update({status, user_decision}).eq('id', id)` |
| 본문 미리보기 URL | `storage.from('reports').createSignedUrl(storage_path, 60)` |
| 본문 다운로드 | `storage.from('reports').download(storage_path)` |

---

# 12. 무료 사용량

- DB 500MB: 리포트 본문은 Supabase Storage `reports` 버킷에 저장하고 `storage_path`만 DB에 둠.
- Edge Functions 500K invocations/month: `sync-prices` 1개만 운영 → 충분.
- Auth 50K MAU: 단일 사용자에게 무한대.
- 일별 가격은 보유 종목과 환율 코드 위주로만 저장.

---

# 13. 구현 순서 / 타입 생성 파이프라인

## 13.1 구현 순서

1. Next.js + Supabase 프로젝트 생성, 환경 변수 설정
2. Supabase 마이그레이션 작성 (스키마 + RLS + 트리거 + portfolio_view + Storage 버킷)
3. `supabase db push`로 원격에 마이그레이션 적용
4. `supabase gen types typescript --linked > lib/supabase/types.ts` 실행
5. `sync-prices` Edge Function 구현 + 배포
6. Auth 흐름 (로그인 페이지, 콜백, middleware)
7. Supabase 클라이언트 헬퍼 (`lib/supabase/`)
8. UI는 [PRD_PORTFOLIO_UI.md](./PRD_PORTFOLIO_UI.md)의 `index-v2.html` 기준 master-detail 구조대로 구현
9. **자료 페이지 데이터 흐름**: 환율 + 종목 마스터 + 관리형 태그 + 가격 동기화 + `sync_runs` 결과 + 수동 보완
10. **분석 페이지 데이터 흐름**: 리포트/리밸런싱 조회 + user_decision 저장 + Storage signed URL 미리보기
11. Vercel 배포

## 13.2 타입 생성 파이프라인

마이그레이션 적용 직후 항상 타입을 재생성한다.

```bash
# package.json scripts
"db:push":   "supabase db push",
"db:types":  "supabase gen types typescript --linked > lib/supabase/types.ts",
"db:sync":   "npm run db:push && npm run db:types"
```

- `db:sync`를 마이그레이션 추가/수정 후 표준 절차로 사용한다.
- 생성된 `types.ts`는 커밋해 PR 리뷰에서 스키마 변경을 확인할 수 있게 한다.
- 클라이언트 코드는 `Database` 타입을 import해 select/insert 응답을 타입 안전하게 다룬다:

```ts
import { Database } from '@/lib/supabase/types'
const supabase = createBrowserClient<Database>(...)
```

---

# 14. 검증 체크리스트

> UI 검증 항목은 [PRD_PORTFOLIO_UI.md §11 검증 체크리스트](./PRD_PORTFOLIO_UI.md)에서 관리한다. 본 절은 DB/백엔드/플랫폼 항목만 다룬다.

DB / Backend:
- [ ] 모든 테이블에 `user_id UUID NOT NULL DEFAULT auth.uid()` 컬럼이 있음
- [ ] 모든 테이블에 RLS가 활성화되어 있고 `auth.uid() = user_id` 정책이 적용됨
- [ ] `transactions.currency`, `holding_prices_daily.currency` 컬럼이 존재하지 않음 (instruments join으로 도출)
- [ ] `instruments`는 `(user_id, ticker)` UNIQUE로 사용자별 종목 마스터를 격리함
- [ ] `holding_prices_daily`는 `(user_id, ticker, price_date)` UNIQUE로 중복 방지
- [ ] `portfolio_snapshots`가 자산 hero 기간 변동을 제공함
- [ ] `sync_runs`가 자료 hero의 synced/total, 마지막 실행, 실패 ticker를 제공함
- [ ] SELL 거래의 `transactions.realized_pnl_krw`가 계산되어 거래 feed에 표시 가능함
- [ ] 사용자 태그는 `tags`와 `instrument_tags`로 관리되고 `(user_id, name)`, `(user_id, ticker, tag_id)` 중복이 방지됨
- [ ] `rebalance_suggestions.status`에 CHECK 제약이 적용됨
- [ ] `daily_reports.cycle_phase`가 `recovery`/`caution`/`neutral` 표준값만 허용함
- [ ] `transactions` INSERT/UPDATE/DELETE 후 `holdings`가 자동 갱신됨
- [ ] 매도 수량 초과 시 트리거 예외로 거래 입력이 롤백됨
- [ ] 거래 삭제 후 holdings가 정확히 재계산됨
- [ ] `portfolio_view`가 `security_invoker = true`이며 RLS가 호출자에 적용됨
- [ ] `portfolio_view`가 KRW/USD 평가금액과 미실현손익을 정확히 계산함
- [ ] `sync-prices`가 마지막 저장일 다음 날부터 누락된 날짜만 upsert
- [ ] `sync-prices`가 user JWT를 검증함
- [ ] `daily_reports`는 `(user_id, report_date)` UNIQUE이며 upsert로 덮어씀
- [ ] 리포트/리밸런싱 본문 참조는 Drive 계열 컬럼이 아니라 `storage_path`로 통일됨
- [ ] `reports` Storage 버킷이 private이며 `(storage.foldername(name))[1] = auth.uid()::text` 정책으로 격리됨
- [ ] 모든 DATE 컬럼이 KST 기준
- [ ] `supabase gen types`로 생성된 `lib/supabase/types.ts`가 커밋되어 있음

플랫폼 / 배포:
- [ ] Vercel 배포 URL 접속 가능
- [ ] 미인증 상태로 보호 라우트 접근 시 `/login` 리다이렉트 (middleware)
- [ ] 이메일 로그인 링크 인증 후 `/assets`로 진입
- [ ] 브라우저 번들에 `service_role key`가 없음 (anon key만)

CRUD / 데이터 흐름:
- [ ] 계좌/보유종목/거래 CRUD가 SDK로 동작 (RLS 통과 확인)
- [ ] 거래 추가/수정/삭제 후 holdings 값이 자동 갱신됨 (트리거 동작)
- [ ] 거래 detail drawer form에서 통화가 instruments에서 자동으로 채워짐
- [ ] "가격 동기화" 버튼이 `sync-prices` Edge Function을 호출하고 synced/failed를 결과로 받음
- [ ] 리포트/리밸런싱 본문이 signed URL로 다운로드 가능
- [ ] 결정 기록 폼 저장 시 `rebalance_suggestions.update({status, user_decision})`이 수행됨

회귀 방지:
- [ ] PRD 본문에 옛 API 서버, 공유 API 키, Google Drive, 별도 대시보드 페이지 요구사항이 남아있지 않음
- [ ] UI 명세가 [PRD_PORTFOLIO_UI.md](./PRD_PORTFOLIO_UI.md)로 이전되었고 본 PRD에는 잔존 UI 명세가 없음
