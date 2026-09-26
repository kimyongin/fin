-- Keep owner reads under RLS, but financial and tag writes must pass through
-- the existing purpose-specific security-definer RPCs for validation, activity,
-- expected-version checks, and idempotency.
revoke all on public.accounts,public.holdings,public.instruments,public.tags from anon,authenticated;
grant select on public.accounts,public.holdings,public.instruments,public.tags to authenticated;
