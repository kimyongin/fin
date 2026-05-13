## What to build

Supabase 프로젝트의 모든 백엔드 기반을 설정한다. 이후 모든 슬라이스가 이 슬라이스에 의존한다.

도메인 언어는 `portfolio-app/CONTEXT.md`, 아키텍처 결정은 `docs/adr/`를 참조한다.

## DB 스키마

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
    instrument_type TEXT NOT NULL CHECK (instrument_type IN ('stock','etf','fund','fx','cash','other')),
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
    trade_type TEXT NOT NULL CHECK (trade_type IN ('BUY','SELL')),
    quantity REAL NOT NULL,
    price REAL NOT NULL,
    amount REAL NOT NULL,
    fee REAL DEFAULT 0,
    realized_pnl_krw REAL,
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (user_id, ticker) REFERENCES instruments(user_id, ticker)
);
-- currency 컬럼 없음: instruments.currency로 join해서 도출 (ADR-0002)

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
-- currency 컬럼 없음: instruments.currency로 join해서 도출 (ADR-0002)

CREATE TABLE daily_reports (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) DEFAULT auth.uid(),
    report_date DATE NOT NULL,
    headline TEXT,
    market_impact_summary TEXT,
    trade_suggestions JSONB,
    risk_warnings JSONB,
    cycle_phase TEXT CHECK (cycle_phase IN ('recovery','caution','neutral')),
    indicators JSONB,
    news_count INT,
    storage_path TEXT,
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
    storage_path TEXT,
    user_decision JSONB,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','partial')),
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
    started_by TEXT NOT NULL CHECK (started_by IN ('web','market-analysis-skill','manual')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## RLS

모든 테이블에 RLS 활성화 + 동일 정책:

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all" ON <table>
    FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
```

Storage 버킷 RLS:

```sql
CREATE POLICY "owner_storage" ON storage.objects
    FOR ALL TO authenticated
    USING (bucket_id = 'reports' AND (storage.foldername(name))[1] = auth.uid()::text)
    WITH CHECK (bucket_id = 'reports' AND (storage.foldername(name))[1] = auth.uid()::text);
```

## Holdings 재계산 트리거

```sql
CREATE OR REPLACE FUNCTION recalc_holding(p_account_id BIGINT, p_ticker TEXT)
RETURNS VOID AS $$
DECLARE
    r RECORD;
    total_qty REAL := 0;
    total_cost REAL := 0;
    avg_price REAL := 0;
BEGIN
    FOR r IN
        SELECT trade_type, quantity, price FROM transactions
        WHERE account_id = p_account_id AND ticker = p_ticker
        ORDER BY trade_date, created_at
    LOOP
        IF r.trade_type = 'BUY' THEN
            total_qty  := total_qty + r.quantity;
            total_cost := total_cost + r.quantity * r.price;
            IF total_qty > 0 THEN avg_price := total_cost / total_qty; END IF;
        ELSIF r.trade_type = 'SELL' THEN
            IF r.quantity > total_qty THEN
                RAISE EXCEPTION 'Sell quantity exceeds holdings for %, %', p_account_id, p_ticker;
            END IF;
            total_qty  := total_qty - r.quantity;
            total_cost := avg_price * total_qty;
        END IF;
    END LOOP;
    INSERT INTO holdings (account_id, ticker, quantity, avg_price, updated_at)
    VALUES (p_account_id, p_ticker, total_qty, avg_price, NOW())
    ON CONFLICT (account_id, ticker)
    DO UPDATE SET quantity = EXCLUDED.quantity, avg_price = EXCLUDED.avg_price, updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION transactions_recalc_trigger() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM recalc_holding(OLD.account_id, OLD.ticker); RETURN OLD;
    ELSE
        PERFORM recalc_holding(NEW.account_id, NEW.ticker);
        IF TG_OP = 'UPDATE' AND (OLD.account_id <> NEW.account_id OR OLD.ticker <> NEW.ticker) THEN
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

## portfolio_view

```sql
CREATE VIEW portfolio_view WITH (security_invoker = true) AS
WITH latest_price AS (
    SELECT DISTINCT ON (user_id, ticker) user_id, ticker, price_date, close_price
    FROM holding_prices_daily ORDER BY user_id, ticker, price_date DESC
),
fx AS (
    SELECT user_id, price_date, close_price AS usdkrw
    FROM holding_prices_daily WHERE ticker = 'USDKRW=X'
)
SELECT
    h.id, h.user_id, h.account_id, a.name AS account_name,
    h.ticker, i.display_name, i.currency, i.instrument_type,
    h.quantity, h.avg_price, h.note,
    p.close_price, p.price_date,
    (h.quantity * p.close_price) AS market_value_native,
    CASE
        WHEN i.currency = 'KRW' THEN h.quantity * p.close_price
        WHEN i.currency = 'USD' THEN h.quantity * p.close_price *
            COALESCE(
                (SELECT usdkrw FROM fx WHERE user_id = h.user_id AND price_date = p.price_date),
                (SELECT usdkrw FROM fx WHERE user_id = h.user_id AND price_date <= p.price_date ORDER BY price_date DESC LIMIT 1)
            )
        ELSE NULL
    END AS market_value_krw,
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

`weight_pct`는 view에 없음 — 클라이언트가 `market_value_krw / SUM(market_value_krw)`로 계산.

## Seed 데이터

```sql
-- 기본 FX Rate (포트폴리오 소유자 로그인 후 insert)
INSERT INTO instruments (ticker, display_name, instrument_type, currency, price_source)
VALUES ('USDKRW=X', 'USD/KRW 환율', 'fx', 'KRW', 'yfinance');
```

## Acceptance criteria

- [ ] 모든 테이블이 `user_id UUID NOT NULL DEFAULT auth.uid()` 컬럼을 가진다
- [ ] 모든 테이블에 RLS가 활성화되어 있고 `auth.uid() = user_id` 정책이 적용된다
- [ ] `transactions.currency`, `holding_prices_daily.currency` 컬럼이 없다 (ADR-0002)
- [ ] Transaction insert 후 `holdings`가 자동 재계산된다
- [ ] 매도 수량 초과 시 트리거가 예외를 발생시키고 트랜잭션이 롤백된다
- [ ] `portfolio_view`가 KRW/USD 평가금액과 미실현손익을 올바르게 계산한다
- [ ] `portfolio_view`가 `security_invoker = true`로 생성된다
- [ ] `reports` Storage 버킷이 private이고 본인 폴더만 접근 가능하다
- [ ] `supabase db push`로 원격에 적용되고 Supabase 대시보드에서 확인된다

## Blocked by

None - can start immediately
