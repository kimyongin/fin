create or replace function public.app_get_shared_feature_access(input_owner_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    relationship_access boolean;
    features jsonb;
begin
    if current_user_id is null then
        raise exception 'Authentication required';
    end if;
    if input_owner_user_id is null then
        raise exception 'Owner is required';
    end if;

    relationship_access := public.can_view_owner(input_owner_user_id);

    select jsonb_object_agg(feature_key, allowed)
    into features
    from (
        select feature_key,
               relationship_access and public.can_view_feature(input_owner_user_id, feature_key) as allowed
        from (values
            ('assets'), ('strategy'), ('news'), ('activity'), ('briefings'),
            ('decisions'), ('tasks'), ('investment_profile'), ('holding_theses'),
            ('research_evidence')
        ) feature(feature_key)
    ) access_rows;

    return jsonb_build_object(
        'owner_user_id', input_owner_user_id,
        'relationship_access', relationship_access,
        'features', coalesce(features, '{}'::jsonb)
    );
end;
$$;

grant execute on function public.app_get_shared_feature_access(uuid) to authenticated;
