create index if not exists principles_change_page_idx
    on public.principles(user_id, effective_at desc, id desc);

create function public.app_list_principle_changes(
    input_limit integer default 20,
    input_cursor jsonb default null
) returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
    page_limit integer;
    cursor_at timestamptz;
    cursor_id bigint;
    result jsonb;
begin
    if auth.uid() is null then raise exception 'Authentication required'; end if;
    page_limit := least(greatest(coalesce(input_limit, 20), 1), 50);
    if input_cursor is not null then
        if jsonb_typeof(input_cursor) <> 'object'
           or not (input_cursor ? 'effective_at' and input_cursor ? 'id') then
            raise exception 'Invalid principle change cursor';
        end if;
        begin
            cursor_at := (input_cursor ->> 'effective_at')::timestamptz;
            cursor_id := (input_cursor ->> 'id')::bigint;
        exception when others then
            raise exception 'Invalid principle change cursor';
        end;
        if cursor_at is null or cursor_id is null then
            raise exception 'Invalid principle change cursor';
        end if;
    end if;

    with bounded as (
        select p.* from public.principles p
        where p.user_id = auth.uid()
          and (cursor_at is null or (p.effective_at, p.id) < (cursor_at, cursor_id))
        order by p.effective_at desc, p.id desc
        limit page_limit + 1
    ), page as (
        select * from bounded order by effective_at desc, id desc limit page_limit
    ), decorated as (
        select p.effective_at, p.id,
               (to_jsonb(p) - 'user_id') || jsonb_build_object(
                   'change_type', case when p.ended then 'ended'
                                       when previous.id is null then 'added'
                                       else 'updated' end,
                   'previous', case when previous.id is null then null
                                    else jsonb_build_object(
                                        'id', previous.id, 'kind', previous.kind,
                                        'scope', previous.scope, 'body', previous.body,
                                        'effective_at', previous.effective_at
                                    ) end
               ) item
        from page p
        left join lateral (
            select old.id, old.kind, old.scope, old.body, old.effective_at
            from public.principles old
            where old.user_id = p.user_id and old.principle_id = p.principle_id
              and (old.effective_at, old.id) < (p.effective_at, p.id)
            order by old.effective_at desc, old.id desc limit 1
        ) previous on true
    )
    select jsonb_build_object(
        'items', coalesce((select jsonb_agg(item order by effective_at desc, id desc) from decorated), '[]'::jsonb),
        'next_cursor', case when (select count(*) from bounded) > page_limit
            then (select jsonb_build_object('effective_at', effective_at, 'id', id)
                  from page order by effective_at, id limit 1)
            else null end
    ) into result;
    return result;
end;
$$;

revoke all on function public.app_list_principle_changes(integer, jsonb) from public, anon;
grant execute on function public.app_list_principle_changes(integer, jsonb) to authenticated;
