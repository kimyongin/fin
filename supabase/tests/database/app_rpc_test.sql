begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select extensions.plan(25);

create temp table test_context (
  user_id uuid not null
) on commit drop;

do $$
declare
  generated_user_id uuid := '00000000-0000-0000-0000-000000000101';
begin
  begin
    insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (
      generated_user_id,
      'authenticated',
      'authenticated',
      'db-test-owner@example.com',
      '',
      now(),
      now(),
      now()
    );

    insert into test_context (user_id) values (generated_user_id);
  exception
    when insufficient_privilege then
      insert into test_context (user_id)
      values ('ecbac1b5-7d89-48a1-b267-1ff6e71fb79c');
  end;

  if not exists (select 1 from test_context) then
    raise exception 'No test user is available';
  end if;
end $$;

select set_config('request.jwt.claim.sub', (select user_id::text from test_context limit 1), true);
set local role authenticated;

select extensions.is(
  (select name from public.app_save_account(null, '  Test Account  ', '  Test Broker  ', '  Memo  ', 'user', 'create account')),
  'Test Account',
  'app_save_account trims and returns account name'
);

select extensions.is(
  (select count(*) from public.accounts where user_id = auth.uid() and name = 'Test Account'),
  1::bigint,
  'app_save_account inserts one account for auth.uid()'
);

select extensions.is(
  (select action_type from public.activity_events where user_id = auth.uid() and target_table = 'accounts' order by id desc limit 1),
  'create_account',
  'app_save_account records create_account activity'
);

select extensions.throws_like(
  $$ select * from public.app_save_account(null, '   ', null, null, 'user', null) $$,
  '%Account name is required%',
  'app_save_account rejects blank names'
);

insert into public.tags (user_id, name, sort_order)
values (auth.uid(), 'Growth', 1);

select extensions.is(
  (select name from public.app_save_tag(null, 'Income', 2, 'user', 'create tag')),
  'Income',
  'app_save_tag saves a tag without a color'
);

select extensions.is(
  (
    select ticker
    from public.app_save_instrument(
      null,
      ' aapl ',
      ' Apple ',
      'USD',
      'market',
      210.5,
      date '2026-07-12',
      (select id from public.tags where user_id = auth.uid() and name = 'Growth'),
      'user',
      'create instrument',
      'manual',
      ' core instrument '
    )
  ),
  'AAPL',
  'app_save_instrument uppercases ticker'
);

select extensions.is(
  (select close_price::numeric from public.holding_prices_daily where user_id = auth.uid() and ticker = 'AAPL' and price_date = date '2026-07-12'),
  210.5::numeric,
  'app_save_instrument upserts manual price'
);

select extensions.is(
  (select t.name from public.instrument_tags it join public.tags t on t.id = it.tag_id where it.user_id = auth.uid() and it.ticker = 'AAPL'),
  'Growth',
  'app_save_instrument assigns tag'
);

select extensions.is(
  (select note from public.instruments where user_id = auth.uid() and ticker = 'AAPL'),
  'core instrument',
  'app_save_instrument trims and stores instrument note'
);

select extensions.is(
  (
    select ticker
    from public.app_save_instrument(
      (select id from public.instruments where user_id = auth.uid() and ticker = 'AAPL'),
      'AAPL',
      'Apple',
      'USD',
      'market',
      null,
      null,
      (select id from public.tags where user_id = auth.uid() and name = 'Growth'),
      'user',
      'update instrument tag',
      'manual',
      'core instrument'
    )
  ),
  'AAPL',
  'app_save_instrument updates an existing instrument without ticker ambiguity'
);

select extensions.throws_like(
  $$ select * from public.app_save_instrument(null, '', 'No ticker', 'USD', 'market', null, null, null, 'user', null, 'manual') $$,
  '%Ticker is required%',
  'app_save_instrument rejects blank tickers'
);

select extensions.is(
  (
    select ticker
    from public.app_save_holding(
      null,
      (select id from public.accounts where user_id = auth.uid() and name = 'Test Account'),
      ' aapl ',
      3.5,
      100,
      ' core ',
      'user',
      'create holding'
    )
  ),
  'AAPL',
  'app_save_holding uppercases ticker'
);

select extensions.is(
  (select quantity::numeric from public.holdings where user_id = auth.uid() and ticker = 'AAPL'),
  3.5::numeric,
  'app_save_holding inserts holding quantity'
);

select extensions.is(
  (select note from public.holdings where user_id = auth.uid() and ticker = 'AAPL'),
  'core',
  'app_save_holding trims note'
);

select extensions.is(
  (select action_type from public.activity_events where user_id = auth.uid() and target_table = 'holdings' order by id desc limit 1),
  'create_holding',
  'app_save_holding records create_holding activity'
);

select extensions.is(
  (
    select quantity::numeric
    from public.app_save_holding(
      null,
      (select id from public.accounts where user_id = auth.uid() and name = 'Test Account'),
      'AAPL',
      4,
      120,
      null,
      'agent',
      'rebalance'
    )
  ),
  4::numeric,
  'app_save_holding updates existing account/ticker row'
);

select extensions.is(
  (select action_type from public.activity_events where user_id = auth.uid() and target_table = 'holdings' order by id desc limit 1),
  'update_holding',
  'app_save_holding records update_holding activity on upsert'
);

select extensions.throws_like(
  $$
    select * from public.app_save_holding(
      null,
      (select id from public.accounts where user_id = auth.uid() and name = 'Test Account'),
      'AAPL',
      -1,
      120,
      null,
      'user',
      null
    )
  $$,
  '%Quantity must be zero or greater%',
  'app_save_holding rejects negative quantity'
);

select extensions.is(
  (select count(*) from public.app_find_holdings('apple')),
  1::bigint,
  'app_find_holdings finds saved holding by display name'
);

select extensions.is(
  (
    select holding_count
    from public.app_bulk_save_portfolio_rows(
      jsonb_build_array(jsonb_build_object(
        'account_name', 'Test Account',
        'broker', 'Test Broker',
        'ticker', 'AAPL',
        'display_name', 'Apple',
        'currency', 'USD',
        'instrument_type', 'market',
        'quantity', 4,
        'avg_price', 120,
        'purchase_amount', null,
        'valuation_amount', null,
        'tag_id', (select id from public.tags where user_id = auth.uid() and name = 'Growth'),
        'note', 'snapshot test'
      ))
    )
  ),
  1,
  'app_bulk_save_portfolio_rows saves the submitted row'
);

select extensions.ok(
  (
    select before_data -> 'portfolio_snapshot' ?& array['accounts', 'instruments', 'tags', 'instrument_tags', 'holdings']
    from public.activity_events
    where user_id = auth.uid() and action_type = 'bulk_edit_portfolio'
    order by id desc limit 1
  ),
  'bulk save records a complete before portfolio snapshot'
);

select extensions.ok(
  (
    select after_data -> 'portfolio_snapshot' ?& array['accounts', 'instruments', 'tags', 'instrument_tags', 'holdings']
    from public.activity_events
    where user_id = auth.uid() and action_type = 'bulk_edit_portfolio'
    order by id desc limit 1
  ),
  'bulk save records a complete after portfolio snapshot'
);

select extensions.is(
  ((select public.app_get_portfolio_state()) -> 'holdings') @> jsonb_build_array(jsonb_build_object('ticker', 'AAPL')),
  true,
  'app_get_portfolio_state includes saved holding'
);

select extensions.is(
  (select unlinked_instrument_count from public.app_delete_tag((select id from public.tags where user_id = auth.uid() and name = 'Growth'), 'user', 'remove tag')),
  1,
  'app_delete_tag unlinks tagged instruments'
);

select extensions.is(
  (select count(*) from public.instrument_tags where user_id = auth.uid() and ticker = 'AAPL'),
  0::bigint,
  'app_delete_tag removes the instrument tag link'
);

select * from extensions.finish();

rollback;

