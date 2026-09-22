-- The isolated baseline predates the strategy JSON column present in the
-- ordinary local and linked schemas. Keep it compatible with later migrations.
alter table public.strategies
    add column if not exists principles jsonb not null default '{}'::jsonb;
