-- ============================================================
-- Energy Trader — Supabase Schema v2
-- Run entire file in Supabase → SQL Editor → New query
-- WARNING: Drops existing tables and all data.
-- ============================================================

create extension if not exists "pgcrypto";

-- ── Drop existing ─────────────────────────────────────────
drop table if exists public.daily_logs     cascade;
drop table if exists public.notes          cascade;
drop table if exists public.strategies     cascade;
drop table if exists public.hub_forecasts  cascade;
drop table if exists public.daily_entries  cascade;
drop table if exists public.news_items     cascade;

-- ── HUBS (reference) ─────────────────────────────────────
-- Not a DB table — defined in app config.
-- Hubs: HB_NORTH, HB_HOUSTON, HB_SOUTH, HB_WEST, HB_PAN
-- Hour slots: configurable in admin (e.g. 700, 1200, 1700, 2200)

-- ── daily_entries ─────────────────────────────────────────
-- One row per day. Holds top-level context.
create table public.daily_entries (
  id            uuid        primary key default gen_random_uuid(),
  entry_date    date        not null unique,
  title         text,
  -- Market context
  fuel_mix      jsonb       default '{}'::jsonb,   -- {gas: %, wind: %, solar: %, ...}
  system_notes  text,                              -- overall market notes for the day
  news_items    jsonb       default '[]'::jsonb,   -- [{headline, source, url}]
  -- Tags
  tags          jsonb       default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── hub_forecasts ─────────────────────────────────────────
-- One row per (date × hub × hour_slot)
-- Stores both the prediction AND the actual, enabling side-by-side comparison
create table public.hub_forecasts (
  id              uuid        primary key default gen_random_uuid(),
  entry_date      date        not null,
  hub             text        not null,  -- e.g. 'HB_NORTH'
  hour_slot       smallint    not null,  -- e.g. 700, 1200, 1700, 2200

  -- Day-ahead prediction (filled morning of)
  dam_price       numeric(10,2),         -- ERCOT DAM price (entered manually or auto)
  pred_energy     numeric(10,2),         -- My predicted RT energy price
  pred_congestion numeric(10,2),         -- My predicted congestion component
  pred_notes      text,                  -- Notes for this hub/time prediction

  -- Weather forecast at prediction time
  wx_temp_f       numeric(5,1),
  wx_condition    text,
  wx_wind_mph     numeric(5,1),
  wx_wind_dir     text,
  wx_cloud_pct    smallint,
  wx_humidity     smallint,

  -- Actuals (filled following day)
  actual_energy   numeric(10,2),         -- Actual RT SPP
  actual_congestion numeric(10,2),       -- Actual congestion
  review_notes    text,                  -- Post-hoc analysis notes

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (entry_date, hub, hour_slot)
);

-- ── notes ─────────────────────────────────────────────────
create table public.notes (
  id          uuid        primary key default gen_random_uuid(),
  kind        text        not null default 'note' check (kind in ('note','strategy')),
  title       text        not null,
  body        text        not null,
  tags        jsonb       default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── Indexes ───────────────────────────────────────────────
create index de_entry_date_idx      on public.daily_entries (entry_date desc);
create index hf_entry_date_idx      on public.hub_forecasts (entry_date desc);
create index hf_date_hub_hour_idx   on public.hub_forecasts (entry_date, hub, hour_slot);
create index notes_kind_idx         on public.notes (kind, created_at desc);

-- ── Row Level Security ────────────────────────────────────
alter table public.daily_entries  enable row level security;
alter table public.hub_forecasts  enable row level security;
alter table public.notes          enable row level security;

-- Public read
create policy "public_read_daily_entries"  on public.daily_entries  for select using (true);
create policy "public_read_hub_forecasts"  on public.hub_forecasts  for select using (true);
create policy "public_read_notes"          on public.notes          for select using (true);

-- Anon write (protected by secret admin URL)
create policy "anon_write_daily_entries"   on public.daily_entries  for all to anon using (true) with check (true);
create policy "anon_write_hub_forecasts"   on public.hub_forecasts  for all to anon using (true) with check (true);
create policy "anon_write_notes"           on public.notes          for all to anon using (true) with check (true);

-- ── Storage bucket ────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('log-images', 'log-images', true)
on conflict (id) do nothing;

drop policy if exists "storage_read_log_images"   on storage.objects;
drop policy if exists "storage_insert_log_images" on storage.objects;
drop policy if exists "storage_delete_log_images" on storage.objects;

create policy "storage_read_log_images"   on storage.objects for select using (bucket_id = 'log-images');
create policy "storage_insert_log_images" on storage.objects for insert to anon with check (bucket_id = 'log-images');
create policy "storage_delete_log_images" on storage.objects for delete to anon using (bucket_id = 'log-images');

-- Done. See README for schema notes.
