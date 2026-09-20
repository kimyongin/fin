create or replace function public.app_get_portfolio_integrity()
returns jsonb language sql stable security definer set search_path=public as $$
  with rows as (
    select h.id holding_id,h.account_id,a.name account_name,h.ticker,h.state_version,
      v.created_at verified_at,v.holding_state_version verified_version,
      case when v.id is null then 'never_verified' when v.holding_state_version<h.state_version then 'changed_since' else 'verified' end status
    from public.holdings h join public.accounts a on a.id=h.account_id and a.user_id=h.user_id
    left join lateral(select hv.* from public.holding_verifications hv where hv.user_id=h.user_id and hv.holding_id=h.id order by hv.created_at desc,hv.id desc limit 1) v on true
    where h.user_id=auth.uid()
  ), accounts_summary as (
    select account_id,account_name,count(*) total_count,count(*) filter(where status='verified') verified_count,
      count(*) filter(where status='changed_since') changed_count,count(*) filter(where status='never_verified') never_verified_count,
      max(verified_at) last_verified_at from rows group by account_id,account_name
  ) select jsonb_build_object(
    'total_count',(select count(*) from rows),'verified_count',(select count(*) from rows where status='verified'),
    'changed_count',(select count(*) from rows where status='changed_since'),'never_verified_count',(select count(*) from rows where status='never_verified'),
    'last_verified_at',(select max(verified_at) from rows),
    'accounts',coalesce((select jsonb_agg(to_jsonb(accounts_summary) order by account_name) from accounts_summary),'[]'::jsonb),
    'holdings',coalesce((select jsonb_agg(to_jsonb(rows) order by account_name,ticker) from rows),'[]'::jsonb));
$$;
grant execute on function public.app_get_portfolio_integrity() to authenticated;
