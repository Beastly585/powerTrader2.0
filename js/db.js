// ============================================================
// db.js — Dual-schema data access layer
//
// Routes by date:
//   ≤ CUTOFF_DATE  → legacy project (daily_logs / notes / strategies)
//   >  CUTOFF_DATE → new project   (daily_entries / hub_forecasts / notes with kind)
// ============================================================

const DB = (() => {

  const CUTOFF   = window.SUPABASE_CUTOFF ?? '2026-04-29';
  const isLegacy = (date) => !date || date <= CUTOFF;

  // ── LEGACY readers ──────────────────────────────────────────

  function legacyLogToEntry(row) {
    if (!row) return null;
    const blocks = Array.isArray(row.blocks) ? row.blocks : [];
    const notesBlock = blocks.find(b =>
      String(b.label || '').toLowerCase() === 'notes' && b.section === 'Thesis'
    );
    const systemNotes = notesBlock
      ? String(notesBlock.value || '').replace(/<[^>]*>/g, ' ').trim()
      : null;
    return {
      id: row.id, entry_date: row.entry_date, title: row.title,
      tags: Array.isArray(row.tags) ? row.tags : [],
      system_notes: systemNotes, news_items: [], fuel_mix: {},
      morning_thesis: null, evening_review: null, outages: [],
      _legacy: true, _blocks: row.blocks,
      created_at: row.created_at, updated_at: row.created_at,
    };
  }

  async function legacyGetEntry(date) {
    const { data, error } = await sbLegacy.from('daily_logs').select('*')
      .eq('entry_date', date).maybeSingle();
    if (error) throw error;
    return legacyLogToEntry(data);
  }

  async function legacyListEntries({ limit = 60, offset = 0 } = {}) {
    const { data, error } = await sbLegacy.from('daily_logs')
      .select('id, entry_date, title, tags')
      .order('entry_date', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    return (data ?? []).map(legacyLogToEntry);
  }

  async function legacyListNotes() {
    const { data, error } = await sbLegacy.from('notes').select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(n => ({ ...n, kind: 'note', _legacy: true }));
  }

  async function legacyListStrategies() {
    const { data, error } = await sbLegacy.from('strategies').select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(s => ({ ...s, kind: 'strategy', _legacy: true }));
  }

  // ── Daily entries ──────────────────────────────────────────

  async function getEntry(date) {
    if (isLegacy(date)) return legacyGetEntry(date);
    const { data, error } = await sbNew.from('daily_entries').select('*')
      .eq('entry_date', date).maybeSingle();
    if (error) throw error;
    return data;
  }

  async function listEntries({ limit = 60, offset = 0 } = {}) {
    const [newRows, legacyRows] = await Promise.allSettled([
      sbNew.from('daily_entries')
        .select('id, entry_date, title, tags, system_notes, morning_thesis')
        .order('entry_date', { ascending: false })
        .range(offset, offset + limit - 1)
        .then(r => { if (r.error) throw r.error; return r.data ?? []; }),
      legacyListEntries({ limit, offset }),
    ]);
    const combined = [
      ...(newRows.status    === 'fulfilled' ? newRows.value    : []),
      ...(legacyRows.status === 'fulfilled' ? legacyRows.value : []),
    ];
    const seen = new Set();
    return combined
      .filter(r => { if (seen.has(r.entry_date)) return false; seen.add(r.entry_date); return true; })
      .sort((a, b) => b.entry_date.localeCompare(a.entry_date))
      .slice(0, limit);
  }

  async function upsertEntry(entry) {
    const { data, error } = await sbNew.from('daily_entries')
      .upsert({ ...entry, updated_at: new Date().toISOString() }, { onConflict: 'entry_date' })
      .select().single();
    if (error) throw error;
    return data;
  }

  async function deleteEntry(date) {
    if (isLegacy(date)) throw new Error('Cannot delete legacy entries.');
    await sbNew.from('hub_forecasts').delete().eq('entry_date', date);
    const { error } = await sbNew.from('daily_entries').delete().eq('entry_date', date);
    if (error) throw error;
  }

  // ── Hub forecasts ──────────────────────────────────────────

  async function getForecasts(date) {
    if (isLegacy(date)) return [];
    const { data, error } = await sbNew.from('hub_forecasts').select('*')
      .eq('entry_date', date).order('hub').order('hour_slot');
    if (error) throw error;
    return data ?? [];
  }

  async function getForecastsRange(startDate, endDate) {
    const effectiveStart = startDate > CUTOFF ? startDate : CUTOFF.replace('29', '30');
    if (effectiveStart > endDate) return [];
    const { data, error } = await sbNew.from('hub_forecasts').select('*')
      .gte('entry_date', effectiveStart).lte('entry_date', endDate)
      .order('entry_date', { ascending: false }).order('hub').order('hour_slot');
    if (error) throw error;
    return data ?? [];
  }

  async function upsertForecasts(rows) {
    if (!rows.length) return [];
    const { data, error } = await sbNew.from('hub_forecasts')
      .upsert(rows.map(r => ({ ...r, updated_at: new Date().toISOString() })),
              { onConflict: 'entry_date,hub,hour_slot' })
      .select();
    if (error) throw error;
    return data ?? [];
  }

  // Copy yesterday's DAM prices into today's forecast rows as starting point
  async function copyYesterdayDam(targetDate) {
    const d = new Date(targetDate + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    const yesterday = d.toISOString().slice(0, 10);
    const rows = await getForecasts(yesterday);
    return rows.map(r => ({
      hub: r.hub, hour_slot: r.hour_slot,
      dam_price: r.dam_price, dam_hourly: r.dam_hourly,
    }));
  }

  // ── Notes ──────────────────────────────────────────────────

  async function listNotes(kind = null) {
    const [newRes, legNotes, legStrats] = await Promise.allSettled([
      (async () => {
        let q = sbNew.from('notes').select('*').order('created_at', { ascending: false });
        if (kind) q = q.eq('kind', kind);
        const { data, error } = await q;
        if (error) throw error;
        return data ?? [];
      })(),
      (!kind || kind === 'note')     ? legacyListNotes()      : Promise.resolve([]),
      (!kind || kind === 'strategy') ? legacyListStrategies() : Promise.resolve([]),
    ]);
    return [
      ...(newRes.status    === 'fulfilled' ? newRes.value    : []),
      ...(legNotes.status  === 'fulfilled' ? legNotes.value  : []),
      ...(legStrats.status === 'fulfilled' ? legStrats.value : []),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  async function upsertNote(note) {
    const payload = { ...note, updated_at: new Date().toISOString() };
    if (!payload.kind) payload.kind = 'note';
    if (!payload.id) delete payload.id;
    const { data, error } = await sbNew.from('notes').upsert(payload).select().single();
    if (error) throw error;
    return data;
  }

  async function deleteNote(id) {
    const { error } = await sbNew.from('notes').delete().eq('id', id);
    if (error) throw error;
  }

  // ── Accuracy stats (extended) ───────────────────────────────
  // Returns energy accuracy + congestion accuracy + MAE + tag cross-tab

  async function getAccuracyStats({ days = 30 } = {}) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const cutoffStart = new Date(CUTOFF);
    cutoffStart.setDate(cutoffStart.getDate() + 1);
    const effectiveSince = since < cutoffStart ? cutoffStart : since;
    const startDate = effectiveSince.toISOString().slice(0, 10);

    // Fetch forecast rows with actuals
    const fcRes = await sbNew.from('hub_forecasts')
      .select('hub, hour_slot, entry_date, pred_energy, actual_energy, pred_congestion, actual_congestion')
      .gte('entry_date', startDate)
      .not('actual_energy', 'is', null)
      .not('pred_energy', 'is', null);

    if (fcRes.error) {
      console.warn('[DB] getAccuracyStats error:', fcRes.error.message);
      return { overall: null, byHub: {}, congestion: null, congestionByHub: {}, mae: null, maeByHub: {}, sampleSize: 0, tagCrosstab: {} };
    }

    // Also fetch entry tags for cross-tab
    const entryRes = await sbNew.from('daily_entries')
      .select('entry_date, tags')
      .gte('entry_date', startDate);
    const tagMap = {}; // entry_date → tags[]
    (entryRes.data ?? []).forEach(e => { tagMap[e.entry_date] = e.tags ?? []; });

    const rows = fcRes.data ?? [];
    if (!rows.length) return { overall: null, byHub: {}, congestion: null, congestionByHub: {}, mae: null, maeByHub: {}, sampleSize: 0, tagCrosstab: {} };

    // ── Energy accuracy + MAE ──────────────────────────────
    let totalPctErr = 0, totalAbsErr = 0, count = 0;
    const byHub = {};

    // ── Congestion accuracy ────────────────────────────────
    let congTotalPctErr = 0, congCount = 0;
    const congByHub = {};

    // ── Tag cross-tab: tag → hub → {totalPctErr, count} ───
    const tagCrosstab = {};

    rows.forEach(r => {
      const pctErr = Math.abs(r.pred_energy - r.actual_energy) / Math.max(Math.abs(r.actual_energy), 1);
      const absErr = Math.abs(r.pred_energy - r.actual_energy);
      totalPctErr += pctErr;
      totalAbsErr += absErr;
      count++;

      if (!byHub[r.hub]) byHub[r.hub] = { totalPctErr: 0, totalAbsErr: 0, count: 0 };
      byHub[r.hub].totalPctErr += pctErr;
      byHub[r.hub].totalAbsErr += absErr;
      byHub[r.hub].count++;

      // Congestion
      if (r.pred_congestion != null && r.actual_congestion != null && r.actual_congestion !== 0) {
        const cPctErr = Math.abs(r.pred_congestion - r.actual_congestion) / Math.max(Math.abs(r.actual_congestion), 1);
        congTotalPctErr += cPctErr;
        congCount++;
        if (!congByHub[r.hub]) congByHub[r.hub] = { totalPctErr: 0, count: 0 };
        congByHub[r.hub].totalPctErr += cPctErr;
        congByHub[r.hub].count++;
      }

      // Tag cross-tab
      const entryTags = tagMap[r.entry_date] ?? [];
      entryTags.forEach(tag => {
        if (!tagCrosstab[tag]) tagCrosstab[tag] = {};
        if (!tagCrosstab[tag][r.hub]) tagCrosstab[tag][r.hub] = { totalPctErr: 0, count: 0 };
        tagCrosstab[tag][r.hub].totalPctErr += pctErr;
        tagCrosstab[tag][r.hub].count++;
      });
    });

    const acc  = (pctErr, n) => n ? Math.max(0, Math.round((1 - pctErr / n) * 100)) : null;
    const mae  = (absErr, n) => n ? Math.round((absErr / n) * 100) / 100 : null;

    const overall      = acc(totalPctErr, count);
    const overallMae   = mae(totalAbsErr, count);
    const congOverall  = congCount ? acc(congTotalPctErr, congCount) : null;

    const hubAcc = {}, hubMae = {}, hubCongAcc = {};
    Object.entries(byHub).forEach(([hub, d]) => {
      hubAcc[hub] = acc(d.totalPctErr, d.count);
      hubMae[hub] = mae(d.totalAbsErr, d.count);
    });
    Object.entries(congByHub).forEach(([hub, d]) => {
      hubCongAcc[hub] = acc(d.totalPctErr, d.count);
    });

    // Resolve tag cross-tab to accuracy numbers
    const tagCrosstabAcc = {};
    Object.entries(tagCrosstab).forEach(([tag, hubs]) => {
      tagCrosstabAcc[tag] = {};
      Object.entries(hubs).forEach(([hub, d]) => {
        tagCrosstabAcc[tag][hub] = acc(d.totalPctErr, d.count);
      });
    });

    return {
      overall, byHub: hubAcc,
      mae: overallMae, maeByHub: hubMae,
      congestion: congOverall, congestionByHub: hubCongAcc,
      sampleSize: count, congestionSampleSize: congCount,
      tagCrosstab: tagCrosstabAcc,
    };
  }

  return {
    getEntry, listEntries, upsertEntry, deleteEntry,
    getForecasts, getForecastsRange, upsertForecasts,
    copyYesterdayDam,
    listNotes, upsertNote, deleteNote,
    getAccuracyStats,
    legacy: { listNotes: legacyListNotes, listStrategies: legacyListStrategies, listEntries: legacyListEntries, getEntry: legacyGetEntry },
  };
})();

window.DB = DB;
