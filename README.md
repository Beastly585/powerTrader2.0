# Energy.Trader — ERCOT Forecasting Portfolio

## File structure
```
index.html              ← Dashboard: live hub cards, map, daily log viewer, stats
review.html             ← Full accuracy analytics: by hub, hour, period
notes.html              ← Journal notes + trading strategies
admin-lEqo0dka.html     ← SECRET admin: day-ahead predictions + prior-day review

css/styles.css          ← Design system (dark trading terminal)
js/supabase.js          ← Supabase client (public anon key)
js/config.js            ← Hub definitions, hour slots, helpers
js/db.js                ← Supabase data access layer
js/weather.js           ← Open-Meteo weather (free, CORS-enabled, no key)
js/ui.js                ← Shared UI helpers

SETUP.sql               ← Run once in Supabase SQL Editor
README.md               ← This file
```

## Supabase setup
1. Open Supabase → SQL Editor → New query
2. Paste full `SETUP.sql` and run
3. Two tables created: `daily_entries` (one per day) and `hub_forecasts` (one per hub × date × hour slot)

## CORS note — ERCOT live prices
ERCOT CDR HTML tables do **not** send CORS headers. They cannot be fetched from browsers directly.  
**The app handles this by:** providing quick-link buttons to open CDR pages in a new tab so you can read prices, then enter them manually in Admin. Weather data from Open-Meteo works perfectly (CORS enabled).

## Daily workflow

### Morning (~8 min)
1. Open `admin-lEqo0dka.html`
2. Set date to **today**
3. Click **⛅ Load Weather** — all hubs × hour slots auto-populate with Open-Meteo data
4. Open ERCOT links (RT SPP, DAM SPP) in new tabs to read current prices
5. Fill in DAM prices + your RT predictions + congestion estimates per hub/hour
6. Add title, tags, system notes in Context tab
7. Click **Save All**

### Prior-day review (~5 min)
1. Set date to **yesterday**
2. Go to **Prior Day Review** tab
3. Click ERCOT RT SPP link, read actual prices for your hour slots
4. Enter actual prices per hub/hour
5. App calculates accuracy automatically
6. Add review notes where predictions diverged
7. Save All

## Configuring hub + hour slots
Edit `js/config.js`:
- `APP.HUBS` — add/remove/reorder tracked hubs
- `APP.HOUR_SLOTS` — change which hours you forecast (e.g. `[700, 1000, 1400, 1700, 2200]`)

## Deploy to GitHub Pages
Push all files maintaining folder structure (`css/`, `js/`). Enable Pages in repo Settings.

Admin URL: `https://yourusername.github.io/reponame/admin-lEqo0dka.html`

## Rotating admin slug
Rename `admin-lEqo0dka.html` → `admin-<new-slug>.html`, commit, push.
