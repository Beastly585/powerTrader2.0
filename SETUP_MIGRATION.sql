-- ============================================================
-- MIGRATION — run this in your NEW Supabase project
-- (oxbroydlxuzgkfozqgox) SQL Editor.
-- Safe to run on existing data — only ADDs columns.
-- ============================================================

-- Add DAM and RT SPP storage columns to hub_forecasts
-- These are populated by the ercot-sync Node tool.

alter table public.hub_forecasts
  -- Full hourly DAM price curve for this hub (all 24 hrs)
  -- Stored as: { "1": 45.12, "2": 43.80, ..., "24": 51.00 }
  add column if not exists dam_hourly     jsonb default '{}'::jsonb,

  -- Full hourly RT SPP actuals for this hub (populated after settlement)
  -- Stored as: { "1": 48.20, "2": 44.10, ..., "24": 53.80 }
  add column if not exists rt_hourly      jsonb default '{}'::jsonb,

  -- Timestamp of last sync from ercot-sync tool
  add column if not exists dam_synced_at  timestamptz,
  add column if not exists rt_synced_at   timestamptz;

-- Also add a top-level daily_entries table column for raw ERCOT data
alter table public.daily_entries
  add column if not exists ercot_synced_at timestamptz,
  -- Store system-wide DAM and RT hub averages for quick dashboard display
  add column if not exists dam_hub_avg    jsonb default '{}'::jsonb,
  -- { "HB_NORTH": {"1":45.12,...,"24":51.00}, ... }
  add column if not exists rt_hub_avg     jsonb default '{}'::jsonb;

-- Index for faster hourly queries
create index if not exists hf_entry_hub_idx
  on public.hub_forecasts (entry_date, hub);

-- Done. No data was dropped.
-- The ercot-sync tool will populate dam_hourly and rt_hourly.
-- hub_forecasts.dam_price (single value per hour_slot) still works
-- as before for admin manual entry.
