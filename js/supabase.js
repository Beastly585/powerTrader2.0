// ============================================================
// supabase.js — Dual-project client
//
// LEGACY project (rejcqfftouzztfnzsyaq):
//   Schema: daily_logs, notes, strategies
//   Data:   up to and including 2026-04-29
//
// NEW project (oxbroydlxuzgkfozqgox):
//   Schema: daily_entries, hub_forecasts, notes (kind column)
//   Data:   2026-04-30 onward — run SETUP.sql here first
// ============================================================

// ── Legacy project ────────────────────────────────────────
const LEGACY_URL      = "https://rejcqfftouzztfnzsyaq.supabase.co";
const LEGACY_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJlamNxZmZ0b3V6enRmbnpzeWFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNTQyNDYsImV4cCI6MjA5MTkzMDI0Nn0.blEDnSFRGDIXiHm3cUg2eyCQPWH3qIMzbG8HTH4s-EM";

// ── New project ───────────────────────────────────────────
const NEW_URL      = "https://oxbroydlxuzgkfozqgox.supabase.co";
// ⚠️  REPLACE with your real anon key:
//     New project → Settings → API → anon (public)
const NEW_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94YnJveWRseHV6Z2tmb3pxZ294Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3MjQwOTYsImV4cCI6MjA5MzMwMDA5Nn0.L06ABaR5d0kjC-rcyk6uX0Pn7Jr2Xp11Q6MQbCGWMkc";

// ── Cutoff: on/before = legacy; after = new ───────────────
const CUTOFF_DATE = "2026-04-29";

// ── Initialize clients ────────────────────────────────────
window.sbLegacy = window.supabase.createClient(LEGACY_URL, LEGACY_ANON_KEY);
window.sbNew    = window.supabase.createClient(NEW_URL, NEW_ANON_KEY);

// Helper: route by date
window.sbForDate = (dateStr) => dateStr <= CUTOFF_DATE ? window.sbLegacy : window.sbNew;

// Default sb → new project (writes always go here)
window.sb = window.sbNew;

window.SUPABASE_CUTOFF = CUTOFF_DATE;
window.SUPABASE_URL    = NEW_URL;
