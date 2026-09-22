create or replace function public.set_activity_current_content()
returns trigger
language plpgsql
set search_path = public
as $$
declare
    decision_question text;
begin
    if new.target_table = 'investment_decisions' and new.target_id is not null then
        select left(decision.question, 500) into decision_question
        from public.investment_decisions decision
        where decision.user_id = new.user_id and decision.id = new.target_id::uuid;
    end if;
    new.title := coalesce(new.title, decision_question, nullif(trim(coalesce(new.after_data ->> 'title', new.after_data ->> 'question', '')), ''));
    new.note := coalesce(new.note, nullif(trim(coalesce(new.after_data ->> 'note', '')), ''));
    new.result := coalesce(new.result, nullif(trim(coalesce(new.after_data ->> 'result', new.after_data ->> 'answer', '')), ''));
    new.conclusion := coalesce(new.conclusion, nullif(trim(coalesce(new.after_data ->> 'conclusion', new.after_data ->> 'selected_option', new.after_data ->> 'reason', '')), ''));
    new.updated_at := coalesce(new.updated_at, new.created_at, clock_timestamp());
    return new;
end;
$$;

update public.activity_events event
set title = left(decision.question, 500)
from public.investment_decisions decision
where event.user_id = decision.user_id
  and event.target_table = 'investment_decisions'
  and event.target_id = decision.id::text
  and event.title is distinct from left(decision.question, 500);
