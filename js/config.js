// ============================================================
// config.js  — single source of truth for app-wide constants
// ============================================================

const APP = {
  // ── Hubs of interest ──────────────────────────────────
  HUBS: [
    { id: 'HB_NORTH',   label: 'North',    city: 'Dallas',      lat: 32.78,  lon: -96.80,  color: '#3b82f6' },
    { id: 'HB_HOUSTON', label: 'Houston',  city: 'Houston',     lat: 29.76,  lon: -95.37,  color: '#f59e0b' },
    { id: 'HB_SOUTH',   label: 'South',    city: 'San Antonio', lat: 29.42,  lon: -98.49,  color: '#10b981' },
    { id: 'HB_WEST',    label: 'West',     city: 'Midland',     lat: 31.99,  lon: -102.08, color: '#ef4444' },
    { id: 'HB_PAN',     label: 'Panhandle',city: 'Amarillo',    lat: 35.22,  lon: -101.83, color: '#8b5cf6' },
  ],

  // ── Hour slots (24h integers) ─────────────────────────
  // These are the only hours you forecast. Edit freely.
  HOUR_SLOTS: [700, 1200, 1700, 2200],

  // ── Price tiers ──────────────────────────────────────
  PRICE_TIERS: [
    { max: 0,    cls: 'neg',    label: 'Negative' },
    { max: 25,   cls: 'low',    label: 'Low'      },
    { max: 50,   cls: 'mid',    label: 'Normal'   },
    { max: 100,  cls: 'high',   label: 'High'     },
    { max: 9999, cls: 'spike',  label: 'Spike'    },
  ],

  // ── Tags ─────────────────────────────────────────────
  TAGS: [
    { value: 'low-solar',    label: 'Low Solar',    color: '#facc15' },
    { value: 'high-solar',   label: 'High Solar',   color: '#f97316' },
    { value: 'low-wind',     label: 'Low Wind',     color: '#60a5fa' },
    { value: 'high-wind',    label: 'High Wind',    color: '#2563eb' },
    { value: 'high-demand',  label: 'High Demand',  color: '#dc2626' },
    { value: 'high-price',   label: 'High Price',   color: '#16a34a' },
    { value: 'low-price',    label: 'Low Price',    color: '#4ade80' },
    { value: 'congestion',   label: 'Congestion',   color: '#9333ea' },
  ],

  // ── Open-Meteo endpoints (free, no key) ──────────────
  WEATHER_URL: 'https://api.open-meteo.com/v1/forecast',

  // ── ERCOT note ────────────────────────────────────────
  // ERCOT CDR HTML tables (ercot.com/content/cdr/html/*)
  // do NOT send CORS headers — they cannot be fetched from
  // the browser directly. The admin page provides a manual
  // entry flow + links to open CDR pages in a new tab.
  // Weather via Open-Meteo works fine (CORS enabled).
  ERCOT_LIVE_URLS: {
    rtSpp:   'https://www.ercot.com/content/cdr/html/real_time_spp.html',
    damSpp:  'https://www.ercot.com/content/cdr/html/dam_spp.html',
    asCap:   'https://www.ercot.com/content/cdr/html/as_capacity_monitor.html',
    sysLoad: 'https://www.ercot.com/gridmktinfo/dashboards/systemwideprices',
  },

  // Helpers
  hubById(id)        { return APP.HUBS.find(h => h.id === id); },
  hubLabel(id)       { return APP.hubById(id)?.label ?? id; },
  fmtHour(slot)      {
    const h = Math.floor(slot / 100);
    const m = slot % 100;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
  },
  fmtPrice(v, d=2)   {
    if (v === null || v === undefined || v === '') return '—';
    const n = parseFloat(v);
    if (isNaN(n)) return '—';
    return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(d);
  },
  priceTier(v) {
    const n = parseFloat(v);
    if (isNaN(n)) return '';
    return (APP.PRICE_TIERS.find(t => n <= t.max) ?? APP.PRICE_TIERS.at(-1)).cls;
  },
  accuracy(pred, actual) {
    const p = parseFloat(pred), a = parseFloat(actual);
    if (isNaN(p) || isNaN(a) || a === 0) return null;
    return Math.round((1 - Math.abs(p - a) / Math.abs(a)) * 100);
  },
  todayCPT() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  },
  fmtDateLong(d) {
    if (!d) return '';
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    });
  },
  fmtDateMed(d) {
    if (!d) return '';
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
  },
  fmtDateShort(d) {
    if (!d) return '';
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  },

  // Weather code → text + emoji
  WX: {
    0:'☀️ Clear',1:'🌤 Mostly Clear',2:'⛅ Partly Cloudy',3:'☁️ Overcast',
    45:'🌫 Foggy',48:'🌫 Icy Fog',51:'🌦 Lt Drizzle',53:'🌦 Drizzle',55:'🌧 Drizzle',
    61:'🌧 Lt Rain',63:'🌧 Rain',65:'🌧 Hvy Rain',71:'🌨 Lt Snow',73:'🌨 Snow',75:'❄️ Hvy Snow',
    80:'🌦 Showers',81:'🌦 Showers',82:'🌧 Hvy Showers',95:'⛈ Thunderstorm',96:'⛈ Hail',99:'⛈ Severe',
  },
  wxDesc(code) { return APP.WX[code] ?? `WX${code}`; },
};

window.APP = APP;
