-- ============================================================
-- MIGRATION 2 — run in new Supabase project SQL Editor
-- Safe: only ADDs columns, no data dropped.
-- ============================================================

-- Thesis narrative fields on daily_entries
alter table public.daily_entries
  add column if not exists morning_thesis  text,   -- written before open: your setup narrative
  add column if not exists evening_review  text,   -- written after close: what actually happened
  add column if not exists outages         jsonb   -- [{element, type, impact, notes}]
    default '[]'::jsonb;

-- No changes needed to hub_forecasts —
-- pred_congestion / actual_congestion already exist.
-- The app now tracks congestion accuracy separately in JS.

-- Done.
