-- #168 S2: render the existing purpose-specific write facts before the legacy
-- body fallback runs. Never reconstruct edited records on read.
create function public.app_describe_automatic_activity()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  subject text;
  action_label text;
  facts text[]:=array[]::text[];
  change_item jsonb;
  before_item jsonb;
  after_item jsonb;
  field_name text;
  field_label text;
  field_unit text;
  before_text text;
  after_text text;
  account_label text;
  currency_label text;
  tag_before text;
  tag_after text;
  previous_targets jsonb;
  target_item jsonb;
  old_target jsonb;
  tag_label text;
  previous_snapshot jsonb;
  saved_snapshot jsonb;
  saved_holding jsonb;
  prior_holding jsonb;
  row_changes text[];
begin
  if new.action_type='record_manual_activity' or new.status<>'succeeded' then return new; end if;
  -- Older purpose-specific writers can issue an unchanged UPDATE. It must not
  -- produce a performed-fact record merely because updated_at changed.
  if new.action_type='update_account'
    and jsonb_typeof(new.before_data)='object' and jsonb_typeof(new.after_data)='object'
    and (new.before_data->'name') is not distinct from (new.after_data->'name')
    and (new.before_data->'broker') is not distinct from (new.after_data->'broker')
    and (new.before_data->'note') is not distinct from (new.after_data->'note')
    and (new.before_data->'is_active') is not distinct from (new.after_data->'is_active')
    then return null; end if;
  if new.action_type='update_instrument'
    and jsonb_typeof(new.before_data)='object' and jsonb_typeof(new.after_data)='object'
    and (select jsonb_agg(new.before_data->key_name order by key_name)
      from unnest(array['ticker','display_name','currency','instrument_type','tag_id','note',
        'manual_price','manual_price_date']) as fields(key_name))
      is not distinct from
      (select jsonb_agg(new.after_data->key_name order by key_name)
      from unnest(array['ticker','display_name','currency','instrument_type','tag_id','note',
        'manual_price','manual_price_date']) as fields(key_name))
    then return null; end if;
  if new.action_type in ('update_holding','update_holding_avg_price')
    and jsonb_typeof(new.before_data)='object' and jsonb_typeof(new.after_data)='object'
    and (select jsonb_agg(new.before_data->key_name order by key_name)
      from unnest(array['account_id','ticker','quantity','avg_price','purchase_amount',
        'valuation_amount','include_in_allocation']) as fields(key_name))
      is not distinct from
      (select jsonb_agg(new.after_data->key_name order by key_name)
      from unnest(array['account_id','ticker','quantity','avg_price','purchase_amount',
        'valuation_amount','include_in_allocation']) as fields(key_name))
    then return null; end if;
  if new.action_type='update_tag'
    and jsonb_typeof(new.before_data)='object' and jsonb_typeof(new.after_data)='object'
    and (new.before_data->'name') is not distinct from (new.after_data->'name')
    and (new.before_data->'sort_order') is not distinct from (new.after_data->'sort_order')
    then return null; end if;

  if new.action_type in ('create_account','update_account','delete_account') then
    subject:=coalesce(new.after_data->>'name',new.before_data->>'name','계좌');
    action_label:=case new.action_type when 'create_account' then '등록' when 'delete_account' then '삭제' else '수정' end;
    new.title:=coalesce(new.title,left(subject,485)||' · 계좌 '||action_label);
    if new.action_type='delete_account' then
      facts:=array_append(facts,'계좌를 삭제했습니다.');
    elsif new.action_type='create_account' then
      facts:=array_append(facts,'계좌를 등록했습니다.');
    end if;
    if new.before_data->>'name' is distinct from new.after_data->>'name' and new.action_type='update_account' then
      facts:=array_append(facts,format('이름: %s → %s',new.before_data->>'name',new.after_data->>'name'));
    end if;
    if new.action_type<>'delete_account' then
      if new.before_data->>'broker' is distinct from new.after_data->>'broker' then
        facts:=array_append(facts,format('증권사: %s → %s',coalesce(new.before_data->>'broker','없음'),coalesce(new.after_data->>'broker','없음')));
      end if;
      if new.before_data->>'note' is distinct from new.after_data->>'note' then
        facts:=array_append(facts,coalesce(nullif(new.after_data->>'note',''),'메모를 삭제했습니다.'));
      end if;
    end if;

  elsif new.action_type in ('create_instrument','update_instrument','delete_instrument') then
    subject:=coalesce(new.after_data->>'display_name',new.before_data->>'display_name','종목');
    action_label:=case new.action_type when 'create_instrument' then '등록' when 'delete_instrument' then '삭제' else '수정' end;
    new.title:=coalesce(new.title,left(subject,485)||' · 종목 '||action_label);
    if coalesce(new.after_data->>'instrument_type',new.before_data->>'instrument_type')='market' then
      new.instrument_ticker:=coalesce(new.instrument_ticker,
        public.app_normalize_activity_ticker(coalesce(new.after_data->>'ticker',new.before_data->>'ticker')));
    end if;
    facts:=array_append(facts,format('티커: %s',coalesce(new.after_data->>'ticker',new.before_data->>'ticker','없음')));
    if new.action_type='delete_instrument' then
      facts:=array_append(facts,'종목을 삭제했습니다.');
    else
      foreach field_name in array array['display_name','currency','instrument_type','note'] loop
        if new.before_data->>field_name is distinct from new.after_data->>field_name then
          field_label:=case field_name when 'display_name' then '종목명' when 'currency' then '통화' when 'instrument_type' then '종류' else '메모' end;
          if field_name='note' then
            facts:=array_append(facts,coalesce(nullif(new.after_data->>'note',''),'메모를 삭제했습니다.'));
          else
            facts:=array_append(facts,format('%s: %s → %s',field_label,
              coalesce(new.before_data->>field_name,'없음'),coalesce(new.after_data->>field_name,'없음')));
          end if;
        end if;
      end loop;
    end if;

  elsif new.action_type in ('create_holding','update_holding','delete_holding','update_holding_avg_price') then
    subject:=coalesce(new.after_data->>'display_name',new.before_data->>'display_name',
      (select i.display_name from public.instruments i where i.user_id=new.user_id
        and i.ticker=coalesce(new.after_data->>'ticker',new.before_data->>'ticker')),
      coalesce(new.after_data->>'ticker',new.before_data->>'ticker'),'보유');
    account_label:=coalesce(new.after_data->>'account_name',new.before_data->>'account_name',
      (select a.name from public.accounts a where a.user_id=new.user_id
        and a.id=coalesce(nullif(new.after_data->>'account_id','')::bigint,
          nullif(new.before_data->>'account_id','')::bigint)),'계좌');
    action_label:=case new.action_type when 'create_holding' then '추가' when 'delete_holding' then '삭제' else '수정' end;
    new.title:=coalesce(new.title,left(subject,480)||' · 보유 '||action_label);
    if exists(select 1 from public.instruments i where i.user_id=new.user_id
      and i.ticker=coalesce(new.after_data->>'ticker',new.before_data->>'ticker')
      and i.instrument_type='market') then
      new.instrument_ticker:=coalesce(new.instrument_ticker,
        public.app_normalize_activity_ticker(coalesce(new.after_data->>'ticker',new.before_data->>'ticker')));
    end if;
    if new.before_data is null and new.after_data is null then
      facts:=array_append(facts,'보유 정보를 수정했습니다. 당시 세부 변경 값은 남아 있지 않습니다.');
    else
      facts:=array_append(facts,format('계좌: %s · 종목: %s',account_label,subject));
    end if;
    if new.action_type='delete_holding' then
      facts:=array_append(facts,'보유를 삭제했습니다.');
    end if;
    foreach field_name in array array['quantity','avg_price','purchase_amount','valuation_amount','include_in_allocation'] loop
      if new.before_data->>field_name is distinct from new.after_data->>field_name then
        field_label:=case field_name when 'quantity' then '수량' when 'avg_price' then '평균가'
          when 'purchase_amount' then '매입액' when 'valuation_amount' then '평가액' else '배분' end;
        field_unit:=case field_name when 'quantity' then '주' when 'include_in_allocation' then '' else ' '||
          coalesce((select i.currency from public.instruments i where i.user_id=new.user_id
            and i.ticker=coalesce(new.after_data->>'ticker',new.before_data->>'ticker')),'') end;
        if field_name='include_in_allocation' then
          before_text:=case new.before_data->>field_name when 'true' then '포함' when 'false' then '제외' else '없음' end;
          after_text:=case new.after_data->>field_name when 'true' then '포함' when 'false' then '제외' else '없음' end;
        else
          before_text:=coalesce((new.before_data->>field_name)||field_unit,'없음');
          after_text:=coalesce((new.after_data->>field_name)||field_unit,'없음');
        end if;
        facts:=array_append(facts,format('%s: %s → %s',field_label,before_text,after_text));
      end if;
    end loop;

  elsif new.action_type in ('create_tag','update_tag','delete_tag') then
    subject:=coalesce(new.after_data->>'name',new.before_data->>'name','태그');
    action_label:=case new.action_type when 'create_tag' then '추가' when 'delete_tag' then '삭제' else '수정' end;
    new.title:=coalesce(new.title,left(subject,485)||' · 태그 '||action_label);
    facts:=array_append(facts,case new.action_type when 'create_tag' then '태그를 추가했습니다.'
      when 'delete_tag' then '태그를 삭제했습니다.' else '태그를 수정했습니다.' end);
    if new.action_type='update_tag' and new.before_data->>'name' is distinct from new.after_data->>'name' then
      facts:=array_append(facts,format('이름: %s → %s',new.before_data->>'name',new.after_data->>'name'));
    end if;

  elsif new.action_type='save_asset_detail' and jsonb_typeof(new.after_data->'changes')='array' then
    subject:=coalesce((select i.display_name from public.instruments i
      where i.user_id=new.user_id and i.id=new.instrument_id), '자산');
    currency_label:=coalesce((select i.currency from public.instruments i
      where i.user_id=new.user_id and i.id=new.instrument_id),'');
    new.title:=left(subject,485)||' · 자산 정보 수정';
    for change_item in select value from jsonb_array_elements(new.after_data->'changes') loop
      before_item:=change_item->'before'; after_item:=change_item->'after';
      if change_item->>'subject'='instrument' then
        foreach field_name in array array['display_name','currency','instrument_type','tag_id','note'] loop
          if before_item->>field_name is distinct from after_item->>field_name then
            field_label:=case field_name when 'display_name' then '종목명' when 'currency' then '통화'
              when 'instrument_type' then '종류' when 'tag_id' then '대표 태그' else '메모' end;
            if field_name='tag_id' then
              select name into tag_before from public.tags where user_id=new.user_id and id=(before_item->>'tag_id')::bigint;
              select name into tag_after from public.tags where user_id=new.user_id and id=(after_item->>'tag_id')::bigint;
              before_text:=coalesce(tag_before,'없음'); after_text:=coalesce(tag_after,'없음');
            else
              before_text:=coalesce(before_item->>field_name,'없음'); after_text:=coalesce(after_item->>field_name,'없음');
            end if;
            if field_name='note' then
              facts:=array_append(facts,coalesce(nullif(after_item->>'note',''),'메모를 삭제했습니다.'));
            else
              facts:=array_append(facts,format('%s: %s → %s',field_label,before_text,after_text));
            end if;
          end if;
        end loop;
      elsif change_item->>'subject'='holding' then
        account_label:=coalesce(change_item->>'account_name','계좌');
        if jsonb_typeof(before_item)='null' then
          facts:=array_append(facts,format('%s · 보유 추가',account_label));
        end if;
        foreach field_name in array array['quantity','avg_price','purchase_amount','valuation_amount','include_in_allocation'] loop
          if before_item->>field_name is distinct from after_item->>field_name then
            field_label:=case field_name when 'quantity' then '수량' when 'avg_price' then '평균가'
              when 'purchase_amount' then '매입액' when 'valuation_amount' then '평가액' else '배분' end;
            field_unit:=case field_name when 'quantity' then '주' when 'include_in_allocation' then '' else ' '||currency_label end;
            if field_name='include_in_allocation' then
              before_text:=case before_item->>field_name when 'true' then '포함' when 'false' then '제외' else '없음' end;
              after_text:=case after_item->>field_name when 'true' then '포함' when 'false' then '제외' else '없음' end;
            else
              before_text:=coalesce((before_item->>field_name)||field_unit,'없음');
              after_text:=coalesce((after_item->>field_name)||field_unit,'없음');
            end if;
            facts:=array_append(facts,format('%s · %s: %s → %s',account_label,field_label,before_text,after_text));
          end if;
        end loop;
      end if;
    end loop;
    if position(E'\n사유: ' in coalesce(new.body,''))>0 then
      facts:=array_append(facts,'사유: '||split_part(new.body,E'\n사유: ',2));
    end if;
    new.body:=array_to_string(facts,E'\n');

  elsif new.action_type in ('update_strategy','reset_allocation_targets') then
    new.title:=coalesce(new.title,case new.action_type when 'reset_allocation_targets'
      then '목표 배분 초기화' else '목표 배분 변경' end);
    if new.action_type='reset_allocation_targets' then
      facts:=array_append(facts,'설정된 목표 배분을 초기화했습니다.');
      if jsonb_typeof(new.before_data)='array' then
        for old_target in select value from jsonb_array_elements(new.before_data) loop
          select name into tag_label from public.tags where user_id=new.user_id
            and id=(old_target->>'tag_id')::bigint;
          facts:=array_append(facts,format('- %s: %s%% → 초기화',
            coalesce(tag_label,'태그'),old_target->>'target_percentage'));
        end loop;
      end if;
    else
      facts:=array_append(facts,'태그별 목표 배분을 변경했습니다.');
      if jsonb_typeof(new.after_data)='array' then
        for target_item in select value from jsonb_array_elements(new.after_data) loop
          select name into tag_label from public.tags where user_id=new.user_id
            and id=(target_item->>'tag_id')::bigint;
          select value into old_target from jsonb_array_elements(
            case when jsonb_typeof(new.before_data)='array' then new.before_data else '[]'::jsonb end)
            where value->>'tag_id'=target_item->>'tag_id' limit 1;
          if old_target->>'target_percentage' is distinct from target_item->>'target_percentage' then
            facts:=array_append(facts,format('- %s: %s → %s%%',coalesce(tag_label,'태그'),
              case when old_target is null then '미설정' else (old_target->>'target_percentage')||'%' end,
              target_item->>'target_percentage'));
          end if;
        end loop;
        if jsonb_typeof(new.before_data)='array' then
          for old_target in select value from jsonb_array_elements(new.before_data) loop
            if not exists(select 1 from jsonb_array_elements(new.after_data) item
              where item->>'tag_id'=old_target->>'tag_id') then
              select name into tag_label from public.tags where user_id=new.user_id
                and id=(old_target->>'tag_id')::bigint;
              facts:=array_append(facts,format('- %s: %s%% → 0%%',
                coalesce(tag_label,'태그'),old_target->>'target_percentage'));
            end if;
          end loop;
        end if;
      end if;
    end if;
    if nullif(trim(coalesce(new.body,'')),'') is not null then facts:=array_append(facts,new.body); end if;
    new.body:=array_to_string(facts,E'\n\n');

  elsif new.action_type in ('complete_general_task','reopen_general_task','cancel_general_task') then
    subject:=coalesce(new.after_data->>'title','할 일');
    action_label:=case new.action_type when 'complete_general_task' then '완료'
      when 'reopen_general_task' then '다시 열기' else '중단' end;
    new.title:=coalesce(new.title,left(subject,500));
    facts:=array_append(facts,case new.action_type when 'complete_general_task' then subject||' 완료'
      when 'reopen_general_task' then subject||' 다시 열림' else subject||' 반복 중단' end);
    if nullif(new.after_data->>'result','') is not null then
      facts:=array_append(facts,'결과: '||(new.after_data->>'result'));
    end if;
    if nullif(new.after_data->>'reason','') is not null then
      facts:=array_append(facts,'사유: '||(new.after_data->>'reason'));
    end if;

  elsif new.action_type in ('log_completed_trade','reconcile_holding') then
    subject:=coalesce(new.after_data->>'instrument_name',new.title,'보유');
    if new.action_type='log_completed_trade' then
      new.title:=coalesce(new.title,left(subject,480)||(case new.after_data->>'side' when 'buy' then ' · 매수' else ' · 매도' end));
      facts:=array_append(facts,format('%s · %s %s주 · 체결가 %s · 보유 %s→%s주',
        coalesce(new.after_data->>'account_name','계좌'),case new.after_data->>'side' when 'buy' then '매수' else '매도' end,
        coalesce(new.after_data->>'trade_quantity','?'),coalesce(new.after_data->>'unit_price','?'),
        coalesce(new.before_data->>'quantity','0'),coalesce(new.after_data->>'quantity','?')));
    else
      new.title:=coalesce(new.title,left(subject,480)||' · 잔고 보정');
      foreach field_name in array array['quantity','avg_price','purchase_amount','valuation_amount'] loop
        if new.before_data->>field_name is distinct from new.after_data->>field_name then
          field_label:=case field_name when 'quantity' then '수량' when 'avg_price' then '평균가'
            when 'purchase_amount' then '매입액' else '평가액' end;
          facts:=array_append(facts,format('%s: %s → %s',field_label,
            coalesce(new.before_data->>field_name,'없음'),coalesce(new.after_data->>field_name,'없음')));
        end if;
      end loop;
      if nullif(new.after_data->>'reason','') is not null then
        facts:=array_append(facts,'사유: '||(new.after_data->>'reason'));
      end if;
    end if;
    if new.body is null then new.body:=array_to_string(facts,E'\n'); end if;

  elsif new.action_type='bulk_edit_portfolio' then
    new.title:=coalesce(new.title,format('보유 %s건 수정',coalesce(new.after_data->>'row_count','0')));
    facts:=array_append(facts,format('표에서 보유 %s건을 저장했습니다. 새 계좌 %s개, 새 종목 %s개.',
      coalesce(new.after_data->>'row_count','0'),coalesce(new.after_data->>'created_account_count','0'),
      coalesce(new.after_data->>'created_instrument_count','0')));
    previous_snapshot:=new.before_data->'portfolio_snapshot';
    saved_snapshot:=new.after_data->'portfolio_snapshot';
    if jsonb_typeof(previous_snapshot->'holdings')='array'
      and jsonb_typeof(saved_snapshot->'holdings')='array' then
      for saved_holding in select value from jsonb_array_elements(saved_snapshot->'holdings') loop
        select value into prior_holding from jsonb_array_elements(previous_snapshot->'holdings')
        where value->>'account_id'=saved_holding->>'account_id'
          and value->>'ticker'=saved_holding->>'ticker' limit 1;
        row_changes:=array[]::text[];
        foreach field_name in array array['quantity','avg_price','purchase_amount','valuation_amount','include_in_allocation'] loop
          if prior_holding->>field_name is distinct from saved_holding->>field_name then
            field_label:=case field_name when 'quantity' then '수량' when 'avg_price' then '평균가'
              when 'purchase_amount' then '매입액' when 'valuation_amount' then '평가액' else '배분' end;
            if field_name='include_in_allocation' then
              before_text:=case prior_holding->>field_name when 'true' then '포함' when 'false' then '제외' else '없음' end;
              after_text:=case saved_holding->>field_name when 'true' then '포함' when 'false' then '제외' else '없음' end;
            else
              before_text:=coalesce(prior_holding->>field_name,'없음');
              after_text:=coalesce(saved_holding->>field_name,'없음');
            end if;
            row_changes:=array_append(row_changes,format('%s %s→%s',field_label,before_text,after_text));
          end if;
        end loop;
        if array_length(row_changes,1)>0 then
          select value->>'name' into account_label from jsonb_array_elements(saved_snapshot->'accounts')
          where value->>'id'=saved_holding->>'account_id' limit 1;
          select value->>'display_name' into subject from jsonb_array_elements(saved_snapshot->'instruments')
          where value->>'ticker'=saved_holding->>'ticker' limit 1;
          facts:=array_append(facts,format('- %s · %s (%s): %s',
            coalesce(account_label,'계좌'),coalesce(subject,'종목'),saved_holding->>'ticker',
            array_to_string(row_changes,'; ')));
        end if;
      end loop;
    end if;
    new.body:=array_to_string(facts,E'\n');
  end if;

  if new.body is null and array_length(facts,1)>0 then new.body:=array_to_string(facts,E'\n'); end if;
  if new.title is not null and char_length(new.title)>500 then raise exception 'Activity title is too long'; end if;
  if new.body is not null and char_length(new.body)>25000 then raise exception 'Activity body is too long'; end if;
  return new;
end;
$$;

create trigger activity_events_aaa_describe_automatic
before insert on public.activity_events
for each row execute function public.app_describe_automatic_activity();
