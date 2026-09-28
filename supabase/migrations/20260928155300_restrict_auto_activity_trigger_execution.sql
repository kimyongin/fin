-- The activity formatter is invoked only by its table trigger. Keep its
-- SECURITY DEFINER privileges unavailable as a direct public RPC.
revoke execute on function public.app_describe_automatic_activity() from public, anon, authenticated;
