# Database Overview

Read this file first for database work. Inspect only the relevant migration files when exact DDL, RPC bodies, grants, indexes, or RLS policies are needed.

## Scope

- Schema: `public`; all application records are tenant-scoped by `user_id`.
- Primary API surface: `app_*` RPCs for the web app and `mcp_*` wrappers for token-authenticated agents.

## Core Data Model

| Area | Tables | Notes |
| --- | --- | --- |
| Identity and sharing | `profiles`, `viewer_sessions`, `friendships` | Profiles can enable password-protected sharing. Guest sessions expire after seven days; logged-in friends retain read-only access until removed. |
| Accounts and holdings | `accounts`, `holdings`, legacy `transactions`, `trade_previews`, `trade_entries`, `trade_reversal_previews`, `trade_reversals`, `holding_reconciliation_previews`, `holding_reconciliations`, `holding_verifications`, mutation receipts | Holdings preserve the existing projection and add a numeric quantity/cost pool plus state version. Completed market trades, reversals, and absolute corrections use expiring version-bound previews. Reversals preserve the original entry and replay only changes after the latest absolute checkpoint. Verification snapshots only explicitly checked fields and never mutates values. |
| Instruments and prices | `instruments`, `instrument_tags`, `tags`, `holding_prices_daily` | An instrument belongs to one user and ticker; tags have a name and sort order, and prices are per user, ticker, and date. |
| Portfolio outputs | `portfolio_snapshots`, `daily_reports`, `rebalance_suggestions`, `sync_runs`, `strategies`, `strategy_buckets`, `strategy_bucket_tags`, `strategy_bucket_mode_targets` | Persisted portfolio analysis, active mode, detailed principles, mode-specific strategy targets, and price-sync results. |
| News research | `news_facts`, `news_fact_annotations` | Country-, date-, and axis-scoped factual records with separate signal opinions attached as annotations. |
| Daily review | `daily_review_contexts`, `daily_briefings`, `daily_briefing_evidence`, `daily_briefing_scopes`, `daily_briefing_scope_sources`, `daily_briefing_scope_evidence`, `daily_review_mutation_receipts` | Short-lived server-owned analysis inputs and a single durable briefing aggregate containing the consumed snapshot, conclusions, uncertainties, source evidence, checked sources, and research windows. Mutation receipts make briefing saves idempotent. |
| Decisions and follow-ups | `investment_decisions`, `investment_decision_state_history`, `portfolio_tasks`, `portfolio_task_history`, `portfolio_task_evidence`, `investment_decision_tasks`, `decision_task_mutation_receipts` | Owner-only proposed/adopted decisions and linked research questions. Creation and version-checked state transitions are idempotent; resolved/reopened questions preserve source evidence. Execution plans remain deferred. |
| Personal investment policy | `investment_policy_profiles`, `investment_policy_history`, `investment_policy_mutation_receipts` | Owner-only optional personal goals, horizon, liquidity needs, risk/trading preferences, and explicit preferences/prohibitions. Partial patches are version-checked and idempotent; missing fields remain unknown. Existing strategy allocations and operating limits stay separate. |
| Holding theses | `holding_theses`, `holding_thesis_history`, `holding_thesis_mutation_receipts` | Owner-only current reasons for holding an instrument, with an optional account override, horizon, review condition/date, expected-version history, and idempotent writes. Existing instrument/holding notes remain separate. |
| Audit and agent access | `activity_events`, `agent_tokens` | User and agent actions are recorded; agent tokens can be revoked. |

`portfolio_view` joins holdings, accounts, instruments, and the newest price. It converts USD values with the latest available `USDKRW=X` price.

Instrument types are constrained to `market` for market-priced investments, `valuation` for evaluation-based investments, `cash` for cash balances, and `fx` for system-managed exchange rates.

## RPC Groups

| Prefix | Purpose |
| --- | --- |
| `app_save_*`, `app_delete_*`, `app_bulk_save_portfolio_rows` | Create, update, and remove accounts, holdings, instruments, and tags while writing activity events. The bulk editor saves up to 200 portfolio rows atomically as one user action and records whole-portfolio before/after snapshots. |
| `app_find_holdings`, `app_get_portfolio_state`, `app_list_recent_activity` | Web app read models. |
| `mcp_*` | Agent-token wrappers around portfolio, strategy, and news reads or mutations, plus price upserts and sync-run recording. |
| `agent_*` | Manage tokens and update holding average price. |
| `set_viewer_profile`, `unlock_viewer_access`, `get_active_viewer_access` | Configure and validate password-protected portfolio sharing. |
| `add_friend`, `list_friends`, `remove_friend` | Create, list, and remove persistent friend portfolio access after password verification. |
| `app_get_strategy_state`, `app_save_strategy` | Read a shared strategy or save the owner's active mode, detailed principles, buckets, mode targets, tag mappings, and rules. |
| `app_get_news_state`, `app_save_news_fact`, `app_update_news_fact`, `app_save_news_fact_annotation`, `app_delete_news_fact`, `app_delete_news_fact_annotation` | Read shared news research, record, update, or delete facts, and attach or remove one signal opinion per fact. |
| `app_create_daily_context` | Assemble the current portfolio, strategy, saved news, recent activity, previous briefing, last research scopes, current decisions, and open follow-ups into a six-hour server-owned context without marking a review complete. It accepts at most 200 subjects, limits snapshots to 2 MiB, and retains at most ten active contexts per user. |
| `app_save_daily_briefing` | Atomically copy a valid context snapshot into one briefing aggregate, save evidence and research scopes, write an activity event, and return the original result for an identical idempotent retry. |
| `app_get_daily_briefing`, `app_list_daily_briefings` | Read one complete owner-only briefing aggregate or list compact briefing summaries. |
| `app_record_investment_decision` | Atomically record a proposed or explicitly adopted decision plus zero to three research follow-ups. It is idempotent and cannot create an execution plan, trade, order, or holding change. |
| `app_get/list_investment_decision*`, `app_get/list_portfolio_task*` | Read owner-only decision/task detail and compact lists. Initial history and decision-task snapshots preserve what was linked at creation. |
| `app_transition_investment_decision`, `app_transition_portfolio_task` | Apply idempotent expected-version transitions. Proposed decisions can be adopted/dismissed; research tasks can wait, resolve with evidence, reopen with new evidence, pause, resume, or close. These RPCs never change holdings or record trades. |
| `app_get_investment_policy`, `app_save_investment_policy` | Read the owner's optional personal policy with the existing strategy, or patch only explicitly supplied personal fields with expected-version history and idempotency. The save RPC does not change strategy buckets, operating mode, holdings, decisions, or trades. |
| `app_list_holding_theses`, `app_get_holding_thesis`, `app_save_holding_thesis` | List owner-only current theses, resolve an instrument base versus optional account override, or explicitly patch one scoped thesis with history and idempotency. These RPCs do not change notes, quantities, trades, decisions, or tasks. |
| `app_preview_trade_entry`, `app_log_completed_trade`, `app_list_transactions` | Preview a user-reported completed market buy/sell against the current version, confirm that exact preview idempotently while updating the holding projection, or list the new local trade ledger. These RPCs never place brokerage orders, move cash, or mark balances verified. |
| `app_preview_holding_reconciliation`, `app_reconcile_holding`, `app_verify_holding`, `app_get_holding_integrity` | Preview/apply an absolute market, valuation, or cash checkpoint; record only explicitly compared brokerage fields; and read whether the latest verification predates a holding change. Price sync and briefing writes do not affect verification. |
| `app_preview_trade_reversal`, `app_reverse_trade_entry` | Preview and idempotently reverse a recorded local trade while preserving the original row. Trades before the latest reconciliation checkpoint do not alter the current holding; later valid trades are replayed and an impossible oversell is rejected atomically. |

## Access Rules

- RLS applies to every application table.
- Owners have full access to their own rows through `auth.uid() = user_id` policies.
- Selected portfolio data can be read by an authorized guest viewer or friend through `can_view_owner`.
- Use RPCs for mutations where possible: they enforce ownership and create audit events.
- Daily review contexts, briefings, evidence, scopes, links, and mutation receipts are owner-only in the first vertical slice. Feature-level sharing is intentionally deferred to the sharing slice.
- Decisions, research tasks, their histories, links, and mutation receipts are owner-only until their feature-level sharing DTO is implemented.
- Personal investment policy profiles and history are owner-only and are not included in existing strategy sharing responses.
- Holding theses and history are owner-only and are not included in existing portfolio or strategy sharing responses.

## Change Routing

- UI or Edge Function behavior only: inspect the relevant client/function and this overview; do not load migrations by default.
- Table, RPC, view, trigger, RLS, index, or grant change: inspect only the relevant migration files, add an incremental migration, then refresh this overview.
- Historical deployment, rollback, or migration-sync issue: inspect only the relevant migration files and run `supabase migration list` before changing history.
