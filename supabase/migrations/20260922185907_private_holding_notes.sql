-- Current holding reasons live on the existing owner rows. They remain private
-- because older portfolio/financial DTOs used to share the public note field.
alter table public.instruments add column private_note text
    check (private_note is null or char_length(private_note) <= 25000);
alter table public.holdings add column private_note text
    check (private_note is null or char_length(private_note) <= 25000);

update public.instruments instrument
set private_note = concat_ws(E'\n', thesis.reason_text,
    case when nullif(trim(thesis.horizon_text),'') is not null then '기간: ' || thesis.horizon_text end,
    case when nullif(trim(thesis.review_condition_text),'') is not null then '재검토 조건: ' || thesis.review_condition_text end,
    case when thesis.next_review_date is not null then '다음 점검: ' || thesis.next_review_date::text end)
from public.holding_theses thesis
where thesis.user_id=instrument.user_id and thesis.instrument_id=instrument.id
  and thesis.account_id is null and thesis.is_active;

update public.holdings holding
set private_note = concat_ws(E'\n', thesis.reason_text,
    case when nullif(trim(thesis.horizon_text),'') is not null then '기간: ' || thesis.horizon_text end,
    case when nullif(trim(thesis.review_condition_text),'') is not null then '재검토 조건: ' || thesis.review_condition_text end,
    case when thesis.next_review_date is not null then '다음 점검: ' || thesis.next_review_date::text end)
from public.holding_theses thesis
join public.instruments instrument on instrument.id=thesis.instrument_id and instrument.user_id=thesis.user_id
where thesis.user_id=holding.user_id and thesis.account_id=holding.account_id
  and holding.ticker=instrument.ticker and thesis.is_active;

create function public.app_redact_private_note(input_value jsonb)
returns jsonb language plpgsql immutable set search_path=public
as $$
declare
    result jsonb;
begin
    if input_value is null then return null; end if;
    if jsonb_typeof(input_value)='object' then
        select coalesce(jsonb_object_agg(key, public.app_redact_private_note(value)), '{}'::jsonb)
        into result from jsonb_each(input_value) where key <> 'private_note';
        return result;
    elsif jsonb_typeof(input_value)='array' then
        select coalesce(jsonb_agg(public.app_redact_private_note(value) order by ordinal), '[]'::jsonb)
        into result from jsonb_array_elements(input_value) with ordinality as entry(value,ordinal);
        return result;
    end if;
    return input_value;
end;
$$;
revoke all on function public.app_redact_private_note(jsonb) from public,anon,authenticated;

create function public.app_redact_activity_private_notes()
returns trigger language plpgsql set search_path=public
as $$
begin
    new.before_data:=public.app_redact_private_note(new.before_data);
    new.after_data:=public.app_redact_private_note(new.after_data);
    return new;
end;
$$;
create trigger activity_events_redact_private_notes
before insert or update on public.activity_events
for each row execute function public.app_redact_activity_private_notes();

alter function public.app_get_portfolio_state(uuid)
    rename to app_get_portfolio_state_before_private_notes;
revoke all on function public.app_get_portfolio_state_before_private_notes(uuid)
    from public,anon,authenticated;
create function public.app_get_portfolio_state(input_owner_user_id uuid default null)
returns jsonb language sql stable security definer set search_path=public
as $$
    select public.app_redact_private_note(
        public.app_get_portfolio_state_before_private_notes(input_owner_user_id));
$$;
revoke all on function public.app_get_portfolio_state(uuid) from public,anon;
grant execute on function public.app_get_portfolio_state(uuid) to authenticated;

create function public.app_list_private_holding_notes()
returns jsonb language sql stable security definer set search_path=public
as $$
    select jsonb_build_object('items',
        coalesce((select jsonb_agg(jsonb_build_object(
            'instrument_id',instrument.id,'account_id',null,'note',instrument.private_note)
            order by instrument.id)
          from public.instruments instrument
          where instrument.user_id=auth.uid() and instrument.private_note is not null),'[]'::jsonb)
        || coalesce((select jsonb_agg(jsonb_build_object(
            'instrument_id',instrument.id,'account_id',holding.account_id,'note',holding.private_note)
            order by instrument.id,holding.account_id)
          from public.holdings holding
          join public.instruments instrument on instrument.user_id=holding.user_id and instrument.ticker=holding.ticker
          where holding.user_id=auth.uid() and holding.private_note is not null),'[]'::jsonb));
$$;

create function public.app_save_private_holding_note(
    input_instrument_id bigint, input_account_id bigint,
    input_expected_note text, input_note text
) returns jsonb language plpgsql security definer set search_path=public
as $$
declare
    owner_id uuid:=auth.uid();
    target_instrument public.instruments%rowtype;
    target_holding public.holdings%rowtype;
    next_note text:=nullif(trim(coalesce(input_note,'')),'');
    current_note text;
begin
    if owner_id is null then raise exception 'Authentication required'; end if;
    if char_length(next_note)>25000 then raise exception 'Holding note is too long'; end if;
    select * into target_instrument from public.instruments
    where id=input_instrument_id and user_id=owner_id for update;
    if not found then raise exception 'Instrument was not found'; end if;
    if input_account_id is null then
        current_note:=target_instrument.private_note;
        if current_note is not distinct from next_note then
            return jsonb_build_object('instrument_id',input_instrument_id,'account_id',null,'note',current_note);
        end if;
        if current_note is distinct from input_expected_note then raise exception 'Holding note changed; reload before saving'; end if;
        update public.instruments set private_note=next_note where id=input_instrument_id and user_id=owner_id;
    else
        select * into target_holding from public.holdings
        where user_id=owner_id and account_id=input_account_id and ticker=target_instrument.ticker for update;
        if not found then raise exception 'Holding was not found'; end if;
        current_note:=target_holding.private_note;
        if current_note is not distinct from next_note then
            return jsonb_build_object('instrument_id',input_instrument_id,'account_id',input_account_id,'note',current_note);
        end if;
        if current_note is distinct from input_expected_note then raise exception 'Holding note changed; reload before saving'; end if;
        update public.holdings set private_note=next_note where id=target_holding.id and user_id=owner_id;
    end if;
    return jsonb_build_object('instrument_id',input_instrument_id,'account_id',input_account_id,'note',next_note);
end;
$$;

revoke all on function public.app_list_private_holding_notes(),
    public.app_save_private_holding_note(bigint,bigint,text,text) from public,anon;
grant execute on function public.app_list_private_holding_notes(),
    public.app_save_private_holding_note(bigint,bigint,text,text) to authenticated;
