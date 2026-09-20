create or replace function public.app_create_daily_context(
    input_timezone text default 'Asia/Seoul',
    input_subject_tickers text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    created_context jsonb;
    created_context_id uuid;
    enriched_snapshot jsonb;
begin
    created_context := public.app_create_daily_context_without_lifecycle(
        input_timezone,
        input_subject_tickers
    );
    created_context_id := (created_context ->> 'context_id')::uuid;

    update public.daily_review_contexts context
    set snapshot = jsonb_set(
        jsonb_set(
            jsonb_set(
                context.snapshot,
                '{open_tasks}',
                jsonb_build_object(
                    'status', 'available',
                    'items', public.app_list_open_portfolio_tasks_internal(20)
                )
            ),
            '{decisions}',
            jsonb_build_object(
                'status', 'available',
                'items', public.app_list_investment_decisions(20, null)
            )
        ),
        '{investment_policy}',
        coalesce(public.app_get_investment_policy() -> 'profile', 'null'::jsonb)
    )
    where context.id = created_context_id and context.user_id = auth.uid()
    returning context.snapshot into enriched_snapshot;

    return created_context || jsonb_build_object('snapshot', enriched_snapshot);
end;
$$;

grant execute on function public.app_create_daily_context(text, text[]) to authenticated;
