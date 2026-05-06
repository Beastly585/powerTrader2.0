#!/usr/bin/env node
/**
 * ercot-sync/sync.js
 * ─────────────────────────────────────────────────────────────────
 * Fetches ERCOT CDR settlement point + DAM price pages, parses
 * hub prices for every hour, upserts into Supabase.
 * Safe to run multiple times — fully idempotent.
 *
 * ERCOT CDR table formats detected automatically:
 *
 *   Format A — "hub-as-columns" (RT SPP, real_time_spp.html):
 *     Columns: Oper Day | Interval Ending | HB_NORTH | HB_HOUSTON | ...
 *     Rows:    one per 15-min or hourly interval
 *     → Pivoted into Map<hub, Map<hourEnding, price>>
 *
 *   Format B — "hub-as-rows" (DAM SPP, dam_spp.html):
 *     Columns: Settlement Point | HE1 | HE2 | ... | HE24
 *     Rows:    one per settlement point
 *     → Directly read as Map<hub, Map<hourEnding, price>>
 *
 * Usage
 * ─────
 *   node sync.js --dam  <url>
 *   node sync.js --rt   <url>
 *   node sync.js --dam  <url> --rt <url>
 *   node sync.js --dam  <url> --date 2026-05-03
 *   node sync.js --dry-run --rt <url>
 *   node sync.js --help
 */

import fetch from 'node-fetch';
import { parse as parseHtml } from 'node-html-parser';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));

// ── Load .env ─────────────────────────────────────────────────────
function loadEnv() {
  const envPath = resolve(__dir, '.env');
  if (!existsSync(envPath)) {
    console.error('❌  .env not found. Copy .env.example → .env and add your keys.');
    process.exit(1);
  }
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (k && !process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || SUPABASE_KEY === 'your_service_role_key_here') {
  console.error('❌  Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env');
  console.error('    Get service key: Supabase → Settings → API → service_role (secret)');
  process.exit(1);
}

// ── Configuration ─────────────────────────────────────────────────
const HUBS = ['HB_NORTH', 'HB_HOUSTON', 'HB_SOUTH', 'HB_WEST', 'HB_PAN'];

const ALL_POINTS = [
  'HB_NORTH', 'HB_HOUSTON', 'HB_SOUTH', 'HB_WEST', 'HB_PAN',
  'HB_BUSAVG', 'HB_HUBAVG',
  'LZ_NORTH', 'LZ_HOUSTON', 'LZ_SOUTH', 'LZ_WEST', 'LZ_AEN',
];

// Hour slots you forecast — must match config.js HOUR_SLOTS
// slot 700 → HE7 (the hour ending at 07:00)
const FORECAST_SLOTS = [700, 1200, 1700, 2200];
const slotToHE = (slot) => Math.floor(slot / 100);

// ── CLI args ──────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
ERCOT Sync — push ERCOT prices to Supabase
──────────────────────────────────────────
  node sync.js --dam  <url>              Sync DAM prices
  node sync.js --rt   <url>              Sync RT SPP actuals
  node sync.js --dam  <url> --rt <url>   Sync both
  node sync.js --date YYYY-MM-DD         Override date
  node sync.js --dry-run [flags]         Preview without writing

Examples:
  node sync.js --rt  https://www.ercot.com/content/cdr/html/20260502_real_time_spp.html
  node sync.js --dam https://www.ercot.com/content/cdr/html/20260502_dam_spp.html
  node sync.js --dam https://www.ercot.com/content/cdr/html/dam_spp.html --date 2026-05-03
`);
    process.exit(0);
  }
  const get = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
  return {
    damUrl: get('--dam'),
    rtUrl:  get('--rt'),
    date:   get('--date'),
    dryRun: args.includes('--dry-run'),
  };
}

// ── Date helpers ──────────────────────────────────────────────────
function dateFromUrl(url) {
  if (!url) return null;
  const m = url.match(/\/(\d{8})_/);
  if (!m) return null;
  const s = m[1];
  return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
}

function todayCPT() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

// ── Fetch page ────────────────────────────────────────────────────
async function fetchPage(url) {
  console.log(`  Fetching: ${url}`);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ercot-sync/1.0)',
      'Accept': 'text/html,*/*',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`);
  return res.text();
}

// ── Parse ERCOT CDR HTML — auto-detects format ────────────────────
//
// Returns: Map<settlementPoint, Map<hourEnding(1-24), avgPrice>>
//
// Format A — hub-as-columns (RT SPP):
//   Headers: Oper Day | Interval Ending | HB_NORTH | HB_HOUSTON | ...
//   Each row = one time interval. "Interval Ending" is like "05/03/2026 01:15"
//   Multiple 15-min rows per hour → averaged into one HE value.
//
// Format B — hub-as-rows (DAM SPP):
//   Headers: Settlement Point | HE1 | HE2 | ... | HE24
//   Each row = one settlement point, one price per hour column.

function parseErcotTable(html) {
  const root = parseHtml(html);
  const tables = root.querySelectorAll('table');
  if (!tables.length) throw new Error('No <table> found in page');

  // Pick the table with the most rows
  const table = tables.reduce((best, t) =>
    t.querySelectorAll('tr').length > best.querySelectorAll('tr').length ? t : best
  , tables[0]);

  const rows = table.querySelectorAll('tr');
  if (rows.length < 2) throw new Error('Table has fewer than 2 rows');

  const headers = rows[0].querySelectorAll('th,td').map(c => c.text.trim());
  console.log(`  Headers: ${headers.join(' | ')}`);

  // ── Detect format ──────────────────────────────────────────────

  // Format A: headers contain hub names like HB_NORTH, HB_HOUSTON
  const hubColMap = new Map(); // hubId → column index
  headers.forEach((h, i) => {
    if (ALL_POINTS.includes(h.trim())) hubColMap.set(h.trim(), i);
  });

  // Format B: headers contain HE1..HE24 or Hour Ending N
  const heColMap = new Map(); // hourEnding(int) → column index
  headers.forEach((h, i) => {
    const m = h.match(/^(?:HE\s*|Hour\s*Ending\s*)(\d{1,2})$/i);
    if (m) heColMap.set(parseInt(m[1]), i);
  });

  if (hubColMap.size > 0) {
    console.log(`  Format A (hub-as-columns): found ${hubColMap.size} hub columns`);
    return parseFormatA(rows, headers, hubColMap);
  } else if (heColMap.size > 0) {
    console.log(`  Format B (hub-as-rows): found ${heColMap.size} hour columns`);
    return parseFormatB(rows, headers, heColMap);
  } else {
    throw new Error(
      `Cannot detect table format.\nHeaders: ${headers.join(' | ')}\n` +
      `Expected either hub names (HB_NORTH etc.) or hour columns (HE1..HE24) in headers.`
    );
  }
}

// ── Format A parser (RT SPP) ──────────────────────────────────────
// Rows are time intervals. "Interval Ending" column tells us the hour.
// Multiple 15-min intervals per hour → average them.
function parseFormatA(rows, headers, hubColMap) {
  // Find the time column — covers both RT ("Interval Ending") and DAM ("Hour Ending")
  const timeColIdx = headers.findIndex(h =>
    /interval.?ending/i.test(h) ||
    /hour.?ending/i.test(h) ||
    /^time$/i.test(h)
  );

  if (timeColIdx < 0) {
    throw new Error(
      `Cannot find time column in Format A table.\nHeaders: ${headers.join(' | ')}`
    );
  }
  console.log(`  Time column: "${headers[timeColIdx]}" (col ${timeColIdx})`);

  // We'll collect: hub → he → [prices] then average
  const accumulator = new Map();
  for (const hub of hubColMap.keys()) {
    accumulator.set(hub, new Map());
  }

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].querySelectorAll('td').map(c => c.text.trim());
    if (cells.length < 2) continue;

    const timeStr = cells[timeColIdx]?.trim() || '';
    let he = null;

    // Format 1: bare integer 1..24  (DAM "Hour Ending" column)
    const intVal = parseInt(timeStr);
    if (!isNaN(intVal) && intVal >= 1 && intVal <= 24 && String(intVal) === timeStr) {
      he = intVal;
    }

    // Format 2: HHMM 4-digit integer e.g. "0700", "1215", "0015"
    // This is what the dated RT SPP files use (e.g. 20260504_real_time_spp.html)
    if (he === null && /^\d{3,4}$/.test(timeStr)) {
      const raw = timeStr.padStart(4, '0');
      const h = parseInt(raw.slice(0, 2));
      const m = parseInt(raw.slice(2, 4));
      if (!isNaN(h) && !isNaN(m)) {
        // ERCOT interval ending: "0700" = interval ended at 07:00
        // HE7 covers 06:00–07:00, i.e. endings :15/:30/:45/:00 up to HH:00
        he = (m === 0) ? (h === 0 ? 24 : h) : h + 1;
        if (he > 24) he = 24;
      }
    }

    // Format 3: HH:MM with or without date prefix  e.g. "07:00", "05/04/2026 07:15"
    if (he === null) {
      const tm = timeStr.match(/(\d{1,2}):(\d{2})/);
      if (tm) {
        const h = parseInt(tm[1]), m = parseInt(tm[2]);
        he = (h === 0 && m === 0) ? 24 : (m === 0 ? h : h + 1);
        if (he > 24) he = 24;
      }
    }

    if (he === null) continue; // can't determine hour — skip row

    // Extract price for each hub column
    for (const [hub, colIdx] of hubColMap) {
      const raw = cells[colIdx]?.replace(/,/g, '').trim();
      if (!raw) continue;
      const price = parseFloat(raw);
      if (isNaN(price)) continue;

      const heMap = accumulator.get(hub);
      if (!heMap.has(he)) heMap.set(he, []);
      heMap.get(he).push(price);
    }
  }

  // Average the intervals within each hour
  const result = new Map();
  for (const [hub, heMap] of accumulator) {
    if (heMap.size === 0) continue;
    const averaged = new Map();
    for (const [he, prices] of heMap) {
      const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
      averaged.set(he, Math.round(avg * 100) / 100);
    }
    result.set(hub, averaged);
  }

  return result;
}

// ── Format B parser (DAM SPP) ─────────────────────────────────────
// Each row is a settlement point. Columns are HE1..HE24.
function parseFormatB(rows, headers, heColMap) {
  // Find settlement point column
  let spCol = headers.findIndex(h =>
    /settlement\s*point/i.test(h) || h === 'Settlement Point Name' || h === 'SPP'
  );
  if (spCol < 0) spCol = 0; // fallback: first column

  const result = new Map();

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].querySelectorAll('td').map(c => c.text.trim());
    if (cells.length <= spCol) continue;
    const sp = cells[spCol]?.trim();
    if (!sp || !ALL_POINTS.includes(sp)) continue;

    const heMap = new Map();
    for (const [he, ci] of heColMap) {
      const raw = cells[ci]?.replace(/,/g, '').trim();
      if (!raw) continue;
      const price = parseFloat(raw);
      if (!isNaN(price)) heMap.set(he, price);
    }
    if (heMap.size > 0) result.set(sp, heMap);
  }

  return result;
}

// ── Supabase REST ─────────────────────────────────────────────────
async function sbUpsert(table, rows, conflict) {
  if (!rows.length) return;
  const url = `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflict}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'apikey':        SUPABASE_KEY,
      'Prefer':        'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase upsert ${table} [${res.status}]: ${body}`);
  }
}

async function sbSelect(table, qs) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${new URLSearchParams(qs)}`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'apikey': SUPABASE_KEY },
  });
  if (!res.ok) throw new Error(`Supabase select [${res.status}]`);
  return res.json();
}

// ── Sync DAM ──────────────────────────────────────────────────────
async function syncDam(url, date, dryRun) {
  console.log('\n📋  DAM Prices');
  const html  = await fetchPage(url);
  const table = parseErcotTable(html);
  const now   = new Date().toISOString();

  if (table.size === 0) throw new Error('Parsed 0 settlement points — check the URL.');

  const fcRows = [];
  const damAvg = {};

  for (const hub of ALL_POINTS) {
    const hm = table.get(hub);
    if (!hm) { console.warn(`  ⚠  ${hub}: not in table`); continue; }

    const hourly = Object.fromEntries([...hm].map(([he, p]) => [String(he), p]));
    damAvg[hub]  = hourly;

    if (!HUBS.includes(hub)) continue; // only write hub_forecasts for main 5 hubs

    for (const slot of FORECAST_SLOTS) {
      const he    = slotToHE(slot);
      const price = hm.get(he) ?? null;
      console.log(`  ${hub.padEnd(12)} HE${String(he).padEnd(3)} DAM = ${price != null ? '$' + price.toFixed(2) : 'n/a'}`);
      fcRows.push({
        entry_date:    date,
        hub,
        hour_slot:     slot,
        dam_price:     price,
        dam_hourly:    hourly,
        dam_synced_at: now,
        updated_at:    now,
      });
    }
  }

  if (dryRun) { console.log('\n  [dry-run] skipping writes'); return; }

  await sbUpsert('hub_forecasts', fcRows, 'entry_date,hub,hour_slot');
  console.log(`\n  ✓  ${fcRows.length} hub_forecasts rows written`);

  await sbUpsert('daily_entries', [{
    entry_date: date, dam_hub_avg: damAvg, ercot_synced_at: now, updated_at: now,
  }], 'entry_date');
  console.log('  ✓  daily_entries.dam_hub_avg updated');
}

// ── Sync RT SPP ───────────────────────────────────────────────────
async function syncRt(url, date, dryRun) {
  console.log('\n⚡  RT Settlement Point Prices');
  const html  = await fetchPage(url);
  const table = parseErcotTable(html);
  const now   = new Date().toISOString();

  if (table.size === 0) throw new Error('Parsed 0 settlement points — check the URL.');

  const fcRows = [];
  const rtAvg  = {};

  for (const hub of ALL_POINTS) {
    const hm = table.get(hub);
    if (!hm) { console.warn(`  ⚠  ${hub}: not in table`); continue; }

    const hourly = Object.fromEntries([...hm].map(([he, p]) => [String(he), p]));
    rtAvg[hub]   = hourly;

    if (!HUBS.includes(hub)) continue;

    for (const slot of FORECAST_SLOTS) {
      const he     = slotToHE(slot);
      const actual = hm.get(he) ?? null;
      console.log(`  ${hub.padEnd(12)} HE${String(he).padEnd(3)} RT  = ${actual != null ? '$' + actual.toFixed(2) : 'n/a'}`);
      fcRows.push({
        entry_date:    date,
        hub,
        hour_slot:     slot,
        actual_energy: actual,
        rt_hourly:     hourly,
        rt_synced_at:  now,
        updated_at:    now,
      });
    }
  }

  if (dryRun) { console.log('\n  [dry-run] skipping writes'); return; }

  await sbUpsert('hub_forecasts', fcRows, 'entry_date,hub,hour_slot');
  console.log(`\n  ✓  ${fcRows.length} hub_forecasts rows written`);

  await sbUpsert('daily_entries', [{
    entry_date: date, rt_hub_avg: rtAvg, ercot_synced_at: now, updated_at: now,
  }], 'entry_date');
  console.log('  ✓  daily_entries.rt_hub_avg updated');
}

// ── Summary ───────────────────────────────────────────────────────
async function printSummary(date) {
  console.log(`\n📊  Supabase snapshot for ${date}:`);
  try {
    const rows = await sbSelect('hub_forecasts', {
      entry_date: `eq.${date}`,
      select:     'hub,hour_slot,dam_price,actual_energy,pred_energy',
      order:      'hub.asc,hour_slot.asc',
    });
    const fmt = (v) => v != null ? `$${parseFloat(v).toFixed(2).padStart(8)}` : '          —';
    console.log('  Hub            Slot    DAM          RT Actual    My Forecast');
    console.log('  ─────────────  ─────   ─────────    ─────────    ───────────');
    for (const r of rows) {
      console.log(`  ${r.hub.padEnd(13)}  ${String(r.hour_slot).padEnd(5)}  ${fmt(r.dam_price)}   ${fmt(r.actual_energy)}   ${fmt(r.pred_energy)}`);
    }
    if (!rows.length) console.log('  (no rows for this date yet)');
  } catch(e) {
    console.warn('  (summary unavailable)', e.message);
  }
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  const { damUrl, rtUrl, date: dateArg, dryRun } = parseArgs();

  if (!damUrl && !rtUrl) {
    console.error('❌  Provide --dam <url> and/or --rt <url>');
    console.error('    Run --help for usage.');
    process.exit(1);
  }

  const date = dateArg
    || dateFromUrl(damUrl)
    || dateFromUrl(rtUrl)
    || todayCPT();

  console.log(`\nERCOT Sync${dryRun ? ' [DRY RUN]' : ''}`);
  console.log(`Date    : ${date}`);
  console.log(`Project : ${SUPABASE_URL}`);

  try {
    if (damUrl) await syncDam(damUrl, date, dryRun);
    if (rtUrl)  await syncRt(rtUrl,   date, dryRun);
    if (!dryRun) await printSummary(date);
    console.log('\n✅  Done.\n');
  } catch(e) {
    console.error('\n❌  Error:', e.message);
    process.exit(1);
  }
}

main();
