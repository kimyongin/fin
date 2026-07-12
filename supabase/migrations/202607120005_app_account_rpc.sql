create or replace function public.app_save_account(
    input_account_id bigint default null,
    input_name text default null,
    input_broker text default null,
    input_note text default null,
    input_source text default 'user',
    input_request text default null
)
returns table (
    account_id bigint,
    name text,
    broker text,
    note text,
    is_active boolean,
    activity_id bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    normalized_source text := coalesce(nullif(trim(input_source), ''), 'user');
    before_row jsonb;
    after_row jsonb;
    saved_account_id bigint;
    event_id bigint;
    activity_type text;
begin
    if current_user_id is null then
        raise exception 'Authentication required';
    end if;

    if normalized_source not in ('user', 'agent') then
        raise exception 'Invalid activity source';
    end if;

    if nullif(trim(coalesce(input_name, '')), '') is null then
        raise exception 'Account name is required';
    end if;

    if input_account_id is not null then
        select to_jsonb(a)
        into before_row
        from public.accounts a
        where a.id = input_account_id
          and a.user_id = current_user_id;

        if before_row is null then
            raise exception 'Account not found';
        end if;

        update public.accounts
        set name = trim(input_name),
            broker = nullif(trim(coalesce(input_broker, '')), ''),
            note = nullif(trim(coalesce(input_note, '')), ''),
            is_active = true
        where id = input_account_id
          and user_id = current_user_id
        returning id into saved_account_id;
    else
        insert into public.accounts (
            user_id,
            name,
            broker,
            note,
            is_active
        )
        values (
            current_user_id,
            trim(input_name),
            nullif(trim(coalesce(input_broker, '')), ''),
            nullif(trim(coalesce(input_note, '')), ''),
            true
        )
        returning id into saved_account_id;
    end if;

    select to_jsonb(a)
    into after_row
    from public.accounts a
    where a.id = saved_account_id
      and a.user_id = current_user_id;

    activity_type := case when before_row is null then 'create_account' else 'update_account' end;

    insert into public.activity_events (
        user_id,
        source,
        action_type,
        natural_language_request,
        target_table,
        target_id,
        before_data,
        after_data,
        status
    )
    values (
        current_user_id,
        normalized_source,
        activity_type,
        nullif(trim(coalesce(input_request, '')), ''),
        'accounts',
        saved_account_id::text,
        before_row,
        after_row,
        'succeeded'
    )
    returning id into event_id;

    return query
    select
        (after_row ->> 'id')::bigint,
        after_row ->> 'name',
        after_row ->> 'broker',
        after_row ->> 'note',
        (after_row ->> 'is_active')::boolean,
        event_id;
end;
$$;

create or replace function public.app_delete_account(
    input_account_id bigint,
    input_source text default 'user',
    input_request text default null
)
returns table (
    account_id bigint,
    name text,
    broker text,
    note text,
    is_active boolean,
    activity_id bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    normalized_source text := coalesce(nullif(trim(input_source), ''), 'user');
    before_row jsonb;
    event_id bigint;
begin
    if current_user_id is null then
        raise exception 'Authentication required';
    end if;

    if normalized_source not in ('user', 'agent') then
        raise exception 'Invalid activity source';
    end if;

    if input_account_id is null then
        raise exception 'Account id is required';
    end if;

    select to_jsonb(a)
    into before_row
    from public.accounts a
    where a.id = input_account_id
      and a.user_id = current_user_id;

    if before_row is null then
        raise exception 'Account not found';
    end if;

    if exists (
        select 1
        from public.holdings h
        where h.account_id = input_account_id
          and h.user_id = current_user_id
    ) then
        raise exception 'Account has linked holdings';
    end if;

    delete from public.accounts
    where id = input_account_id
      and user_id = current_user_id;

    insert into public.activity_events (
        user_id,
        source,
        action_type,
        natural_language_request,
        target_table,
        target_id,
        before_data,
        after_data,
        status
    )
    values (
        current_user_id,
        normalized_source,
        'delete_account',
        nullif(trim(coalesce(input_request, '')), ''),
        'accounts',
        input_account_id::text,
        before_row,
        null,
        'succeeded'
    )
    returning id into event_id;

    return query
    select
        (before_row ->> 'id')::bigint,
        before_row ->> 'name',
        before_row ->> 'broker',
        before_row ->> 'note',
        (before_row ->> 'is_active')::boolean,
        event_id;
end;
$$;

grant execute on function public.app_save_account(bigint, text, text, text, text, text) to authenticated;
grant execute on function public.app_delete_account(bigint, text, text) to authenticated;
