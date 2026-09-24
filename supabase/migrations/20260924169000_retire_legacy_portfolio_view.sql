-- The unused compatibility view projected holdings.note and can block its
-- retirement in freshly rebuilt environments. No application path reads it.
drop view if exists public.portfolio_view;
