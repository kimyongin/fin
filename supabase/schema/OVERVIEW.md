# Database Overview

Read this file first for database work. Inspect only the relevant migration files when exact DDL, RPC bodies, grants, indexes, or RLS policies are needed.

## Scope

- Schema: `public`; all application records are tenant-scoped by `user_id`.
- Primary API surface: `app_*` RPCs for the web app and `mcp_*` wrappers for token-authenticated agents.

## Core Data Model

| Area | Tables | Notes |
| --- | --- | --- |
| Identity and sharing | `profiles`, `viewer_sessions`, `friendships` | Profiles can enable password-protected sharing. Guest sessions expire after seven days; logged-in friends retain read-only access until removed. |
| Accounts and holdings | `accounts`, `holdings`, `transactions` | Transactions recalculate the corresponding holding. |
| Instruments and prices | `instruments`, `instrument_tags`, `tags`, `holding_prices_daily` | An instrument belongs to one user and ticker; prices are per user, ticker, and date. |
| Portfolio outputs | `portfolio_snapshots`, `daily_reports`, `rebalance_suggestions`, `sync_runs`, `strategies`, `strategy_buckets`, `strategy_bucket_tags` | Persisted portfolio analysis, strategy targets, and price-sync results. |
| Audit and agent access | `activity_events`, `agent_tokens` | User and agent actions are recorded; agent tokens can be revoked. |

`portfolio_view` joins holdings, accounts, instruments, and the newest price. It converts USD values with the latest available `USDKRW=X` price.

## RPC Groups

| Prefix | Purpose |
| --- | --- |
| `app_save_*`, `app_delete_*` | Create, update, and remove accounts, holdings, instruments, and tags while writing activity events. |
| `app_find_holdings`, `app_get_portfolio_state`, `app_list_recent_activity` | Web app read models. |
| `mcp_*` | Agent-token wrappers around portfolio reads, mutations, price upserts, and sync-run recording. |
| `agent_*` | Manage tokens and update holding average price. |
| `set_viewer_profile`, `unlock_viewer_access`, `get_active_viewer_access` | Configure and validate password-protected portfolio sharing. |
| `add_friend`, `list_friends`, `remove_friend` | Create, list, and remove persistent friend portfolio access after password verification. |
| `app_get_strategy_state`, `app_save_strategy` | Read a shared strategy or save the owner's strategy buckets, tag mappings, and rules. |

## Access Rules

- RLS applies to every application table.
- Owners have full access to their own rows through `auth.uid() = user_id` policies.
- Selected portfolio data can be read by an authorized guest viewer or friend through `can_view_owner`.
- Use RPCs for mutations where possible: they enforce ownership and create audit events.

## Change Routing

- UI or Edge Function behavior only: inspect the relevant client/function and this overview; do not load migrations by default.
- Table, RPC, view, trigger, RLS, index, or grant change: inspect only the relevant migration files, add an incremental migration, then refresh this overview.
- Historical deployment, rollback, or migration-sync issue: inspect only the relevant migration files and run `supabase migration list` before changing history.
