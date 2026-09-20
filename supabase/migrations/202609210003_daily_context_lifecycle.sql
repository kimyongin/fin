alter function public.app_create_daily_context(text, text[])
    rename to app_create_daily_context_without_lifecycle;
revoke execute on function public.app_create_daily_context_without_lifecycle(text, text[])
    from public, authenticated;

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
            context.snapshot,
            '{open_tasks}',
            jsonb_build_object(
                'status', 'available',
                'items', public.app_list_portfolio_tasks(null, 20, null)
            )
        ),
        '{decisions}',
        jsonb_build_object(
            'status', 'available',
            'items', public.app_list_investment_decisions(20, null)
        )
    )
    where context.id = created_context_id and context.user_id = auth.uid()
    returning context.snapshot into enriched_snapshot;

    return created_context || jsonb_build_object('snapshot', enriched_snapshot);
end;
$$;

grant execute on function public.app_create_daily_context(text, text[]) to authenticated;
