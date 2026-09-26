-- New connections use OAuth. Existing agent tokens remain valid until their
-- legacy endpoint and stored credentials are retired in a separate release.
drop function public.agent_create_token(text, text, text);
