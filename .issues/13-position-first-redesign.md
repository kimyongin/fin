# Position-first redesign

## Goal

Change the portfolio app from transaction-led maintenance to holding-led
maintenance.

The user should be able to keep the portfolio useful by periodically updating
current quantity and average price from the broker app. A complete transaction
ledger should be optional.

Reference: `docs/adr/0006-position-first-portfolio.md`

## Scope

### Data

- Add `holdings.last_verified_at`.
- Add `holdings.source` with values:
  - `manual`
  - `transaction`
  - `import`
  - `adjustment`
- Optional: add `holding_revisions` for a lightweight edit history.
- Stop treating `transactions` as the only canonical input.
- Remove or constrain `transactions_recalc` so it does not overwrite manual
  holdings unexpectedly.

### UI

- Rename the current `positions` surface to `Holdings` in product language.
- Make holding create/edit the primary workflow.
- Rename or demote `Transactions` to `History`.
- Keep transaction entry available only as optional context.
- Add `last_verified_at` to the holding drawer.
- Remove warning copy that says transactions will overwrite Initial Load
  holdings.

### Product Behavior

- Portfolio totals, weights, charts, market analysis, and rebalancing continue
  to read from `portfolio_view`.
- The user can update quantity and average price directly without entering
  transactions.
- Historical transaction completeness is not required for a healthy portfolio.

## Acceptance Criteria

- [ ] A holding can be created directly from the main Assets page.
- [ ] A holding can be edited directly without entering a transaction.
- [ ] Editing a transaction cannot silently overwrite a manually maintained
      holding.
- [ ] `portfolio_view` still returns market value and unrealized P/L from
      holdings.
- [ ] The main UI labels make Holdings the primary concept and History optional.
- [ ] Rebalancing and market analysis still work from `portfolio_view`.

## Suggested Implementation Order

1. Apply database migration for `holdings.last_verified_at` and `holdings.source`.
2. Decide whether to create `holding_revisions` now or defer.
3. Update trigger behavior.
4. Update Assets page labels and tab order.
5. Promote direct holding edit in `app/js/assets.js`.
6. Test against the live Supabase project with one small holding edit.

