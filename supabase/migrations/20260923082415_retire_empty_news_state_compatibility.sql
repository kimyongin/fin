-- The stored daily-context builder was retired. Its empty news-state shim now
-- has no web, OAuth MCP, token MCP, or database caller.
drop function if exists public.app_get_news_state(uuid);
