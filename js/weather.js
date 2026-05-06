// ============================================================
// weather.js — Open-Meteo (free, CORS-enabled, no key)
//
// FIX: Uses the batch endpoint to fetch all hubs in ONE request
// instead of 5 parallel requests (which triggers 429 rate limits).
// Batch API: https://api.open-meteo.com/v1/forecast with
//   latitude=a,b,c&longitude=x,y,z  (comma-separated lists)
// ============================================================

const Weather = (() => {

  const BASE = 'https://api.open-meteo.com/v1/forecast';

  const HOURLY_VARS = [
    'temperature_2m','relative_humidity_2m','wind_speed_10m',
    'wind_direction_10m','wind_gusts_10m','weather_code',
    'cloud_cover','precipitation_probability','cape',
  ].join(',');

  const DAILY_VARS = [
    'temperature_2m_max','temperature_2m_min',
    'precipitation_sum','wind_speed_10m_max','weather_code',
  ].join(',');

  const CURRENT_VARS = [
    'temperature_2m','relative_humidity_2m','wind_speed_10m',
    'wind_direction_10m','weather_code','cloud_cover',
  ].join(',');

  // Fetch ONE location (used for weather.atHour calls)
  async function fetch1(lat, lon, tz = 'America/Chicago') {
    const params = new URLSearchParams({
      latitude: lat, longitude: lon,
      hourly: HOURLY_VARS,
      daily: DAILY_VARS,
      current: CURRENT_VARS,
      temperature_unit: 'fahrenheit',
      wind_speed_unit: 'mph',
      timezone: tz,
      forecast_days: 7,
    });
    const r = await fetch(`${BASE}?${params}`);
    if (!r.ok) throw new Error(`Weather ${r.status}: ${await r.text()}`);
    return await r.json();
  }

  // Fetch ALL hubs in a single batched request
  // Returns the same shape as fetchAll() — keyed by hub id
  async function fetchAll() {
    const hubs = APP.HUBS;
    const lats = hubs.map(h => h.lat).join(',');
    const lons = hubs.map(h => h.lon).join(',');

    const params = new URLSearchParams({
      latitude:  lats,
      longitude: lons,
      hourly:    HOURLY_VARS,
      daily:     DAILY_VARS,
      current:   CURRENT_VARS,
      temperature_unit: 'fahrenheit',
      wind_speed_unit:  'mph',
      timezone:  'America/Chicago',
      forecast_days: 7,
    });

    const r = await fetch(`${BASE}?${params}`);
    if (!r.ok) {
      // If batch fails (e.g. old API doesn't support it), fall back to sequential with delay
      console.warn('Batch weather fetch failed, falling back to sequential');
      return fetchAllSequential();
    }

    const json = await r.json();

    // Batch response: if multiple locations, returns an array; single = object
    const responses = Array.isArray(json) ? json : [json];
    const results = {};
    hubs.forEach((hub, i) => {
      results[hub.id] = responses[i] ?? null;
    });
    return results;
  }

  // Sequential fallback with 300ms gaps to avoid 429
  async function fetchAllSequential() {
    const results = {};
    for (const hub of APP.HUBS) {
      try {
        results[hub.id] = await fetch1(hub.lat, hub.lon);
        await new Promise(res => setTimeout(res, 350)); // 350ms gap
      } catch(e) {
        console.warn('Weather fetch failed for', hub.id, e.message);
        results[hub.id] = null;
      }
    }
    return results;
  }

  // Current conditions summary
  function currentSummary(data) {
    if (!data?.current) return null;
    const c = data.current;
    return {
      tempF:    Math.round(c.temperature_2m),
      humidity: c.relative_humidity_2m,
      windMph:  Math.round(c.wind_speed_10m),
      windDir:  bearingToDir(c.wind_direction_10m),
      cloud:    c.cloud_cover,
      code:     c.weather_code,
      desc:     APP.wxDesc(c.weather_code),
    };
  }

  // Conditions for a specific date + hour slot from hourly forecast
  function atHour(data, dateStr, hourSlot) {
    if (!data?.hourly) return null;
    // hourSlot is like 700, 1200, 1700 — convert to HH:MM
    const h = Math.floor(hourSlot / 100);
    const target = `${dateStr}T${String(h).padStart(2,'0')}:00`;
    const idx = data.hourly.time.findIndex(t => t === target);
    if (idx < 0) return null;
    const hv = data.hourly;
    return {
      tempF:    Math.round(hv.temperature_2m[idx]),
      humidity: hv.relative_humidity_2m[idx],
      windMph:  Math.round(hv.wind_speed_10m[idx]),
      windDir:  bearingToDir(hv.wind_direction_10m[idx]),
      cloud:    hv.cloud_cover[idx],
      code:     hv.weather_code[idx],
      desc:     APP.wxDesc(hv.weather_code[idx]),
    };
  }

  function bearingToDir(deg) {
    if (deg === null || deg === undefined) return '';
    return ['N','NE','E','SE','S','SW','W','NW'][Math.round(deg / 45) % 8];
  }

  return { fetch1, fetchAll, fetchAllSequential, currentSummary, atHour, bearingToDir };
})();

window.Weather = Weather;
