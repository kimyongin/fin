# ADR-0006: Position-first portfolio management

## Status

Proposed

## Context

The current portfolio model treats `transactions` as the canonical input and
`holdings` as a derived table recalculated by triggers. This is accurate, but it
does not match the real maintenance cost for this project.

The portfolio owner does not have a broker API that can import executions
automatically. Manually entering every buy and sell is too much friction. The
data that actually matters for most decisions is the current position state:

- account
- ticker
- quantity
- average price
- latest price
- market value
- unrealized P/L
- weight

Transaction history is useful context, but it should not be required to keep the
portfolio usable.

## Decision

Make `holdings` the primary editable source of truth for current positions.

`transactions` becomes optional supporting history. The app should no longer
require a complete transaction ledger to produce a correct portfolio view.

The operating model changes from:

```text
transactions -> trigger recalculates holdings -> portfolio_view
```

to:

```text
holdings edited directly -> portfolio_view
optional transactions/revisions for context
```

## Product Changes

The Assets page should prioritize these workflows:

1. Review current total value and position weights.
2. Add or edit a holding with `account_id`, `ticker`, `quantity`, `avg_price`,
   and `note`.
3. Update holdings periodically from the broker app, without entering every
   trade.
4. Keep transactions only when the user wants extra context.
5. Use rebalancing and analysis from current positions, not from transaction
   completeness.

The "Transactions" tab should be demoted or renamed to "History". It should not
be the expected daily workflow.

## Data Model Direction

Keep the existing `holdings` table as the canonical position table.

Recommended additions:

```sql
ALTER TABLE holdings
ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual'
    CHECK (source IN ('manual', 'transaction', 'import', 'adjustment'));
```

Add a lightweight revision log if auditability is still useful:

```sql
CREATE TABLE IF NOT EXISTS holding_revisions (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) DEFAULT auth.uid(),
    holding_id BIGINT REFERENCES holdings(id) ON DELETE SET NULL,
    account_id BIGINT REFERENCES accounts(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL,
    previous_quantity REAL,
    previous_avg_price REAL,
    new_quantity REAL NOT NULL,
    new_avg_price REAL NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (user_id, ticker) REFERENCES instruments(user_id, ticker)
);

ALTER TABLE holding_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all" ON holding_revisions
    FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
```

## Transaction Trigger Direction

The current `transactions_recalc` trigger should not silently overwrite manually
maintained holdings.

Preferred path:

- Stop using transaction insert/update/delete as automatic holding mutation.
- If a transaction UI remains, make "apply to holding" an explicit user action.
- If automatic transaction application is kept, it must only affect holdings
  whose `source = 'transaction'`, never manually maintained holdings.

This avoids the most dangerous failure mode: the user updates a holding manually,
then later edits an old transaction and unexpectedly loses the current position.

## UI Direction

Assets tabs should become:

```text
Accounts | Holdings | History
```

`Holdings` is the main tab. It should support:

- create/edit holding
- quantity
- average price
- account
- ticker
- note
- last verified date
- latest price/market value read-only
- optional recent history section

`History` can list recent transactions or holding revisions, but it should be
secondary.

## Consequences

Benefits:

- Much lower maintenance burden.
- Portfolio remains accurate enough for decisions.
- Rebalancing and analysis become practical to keep updated.
- The app better matches the owner's real workflow.

Tradeoffs:

- Realized P/L from exact trade lots becomes less reliable.
- Historical transaction analytics become optional and incomplete.
- Average price is trusted as user-provided broker data.

These tradeoffs are acceptable because the project's primary goal is portfolio
awareness and allocation decisions, not brokerage-grade accounting.

## Migration Plan

1. Update product docs to describe holdings as canonical.
2. Add `last_verified_at` and `source` to `holdings`.
3. Add `holding_revisions` or defer it if UI complexity should stay low.
4. Change Assets UI so the existing Positions/Holdings workflow is the main
   editing path.
5. Demote Transactions tab to History.
6. Remove or constrain the automatic transaction trigger.
7. Verify `portfolio_view`, market analysis, and rebalancing skills still read
   from `portfolio_view` only.

