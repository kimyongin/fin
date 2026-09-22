create or replace function public.app_list_principles(
    input_on date default null,
    input_timezone text default 'Asia/Seoul',
    input_include_ended boolean default false
) returns jsonb
language plpgsql volatile security definer set search_path=public
as $$
declare
    cutoff timestamptz;
    items jsonb;
begin
    if auth.uid() is null then raise exception 'Authentication required'; end if;
    if not exists(select 1 from pg_timezone_names where name=input_timezone) then
        raise exception 'Invalid timezone';
    end if;
    cutoff := case when input_on is null then clock_timestamp()
        else (input_on + 1)::timestamp at time zone input_timezone end;
    select coalesce(jsonb_agg(to_jsonb(latest) - 'user_id'
           order by latest.kind, latest.effective_at desc, latest.id desc), '[]'::jsonb)
      into items
    from (
        select distinct on (principle_id) *
        from public.principles
        where user_id=auth.uid()
          and (case when input_on is null then effective_at<=cutoff else effective_at<cutoff end)
        order by principle_id, effective_at desc, id desc
    ) latest
    where input_include_ended or not latest.ended;
    return jsonb_build_object('items',items,'on_date',input_on,'timezone',input_timezone);
end;
$$;
