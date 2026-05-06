// ============================================================
// ui.js — Shared UI utilities
// ============================================================

const UI = (() => {

  // ── Toast ────────────────────────────────────────────────
  function toast(msg, type = 'info', duration = 3500) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }
    const el = document.createElement('div');
    el.className = `toast toast--${type}`;
    el.innerHTML = `<span class="toast-icon">${{info:'ℹ',success:'✓',error:'✕',warn:'⚠'}[type]??'ℹ'}</span><span>${escapeHtml(msg)}</span>`;
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('toast--show'));
    setTimeout(() => {
      el.classList.remove('toast--show');
      setTimeout(() => el.remove(), 300);
    }, duration);
  }

  // ── Escape HTML ──────────────────────────────────────────
  function escapeHtml(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  // ── Price badge ──────────────────────────────────────────
  function priceBadge(value, showTier = false) {
    const fmt = APP.fmtPrice(value);
    if (fmt === '—') return `<span class="price-empty">—</span>`;
    const tier = APP.priceTier(value);
    const label = showTier ? ` <small>${APP.PRICE_TIERS.find(t=>parseFloat(value)<=t.max)?.label??''}</small>` : '';
    return `<span class="price price--${tier}">${escapeHtml(fmt)}${label}</span>`;
  }

  // ── Accuracy badge ───────────────────────────────────────
  function accuracyBadge(pred, actual) {
    const acc = APP.accuracy(pred, actual);
    if (acc === null) return `<span class="acc-badge acc-badge--na">N/A</span>`;
    const cls = acc >= 90 ? 'great' : acc >= 75 ? 'good' : acc >= 55 ? 'ok' : 'poor';
    return `<span class="acc-badge acc-badge--${cls}">${acc}%</span>`;
  }

  // ── Weather chip ─────────────────────────────────────────
  function wxChip(wx) {
    if (!wx) return `<span class="wx-empty">No data</span>`;
    return `<span class="wx-chip">
      <span class="wx-icon">${wx.desc.split(' ')[0]}</span>
      <span class="wx-temp">${wx.tempF}°F</span>
      <span class="wx-wind">${wx.windMph}mph ${wx.windDir}</span>
    </span>`;
  }

  // ── Tag pill ─────────────────────────────────────────────
  function tagPill(value) {
    const def = APP.TAGS.find(t => t.value === value);
    return `<span class="tag-pill" style="--tag-color:${def?.color ?? '#6b7280'}">${escapeHtml(def?.label ?? value)}</span>`;
  }

  // ── Loading skeleton ─────────────────────────────────────
  function skeleton(rows = 3, height = '16px') {
    return Array.from({ length: rows }).map(() =>
      `<div class="skeleton" style="height:${height};margin-bottom:10px;border-radius:4px"></div>`
    ).join('');
  }

  // ── Confirm dialog ───────────────────────────────────────
  function confirm(msg) {
    return window.confirm(msg);
  }

  // ── Hub color dot ────────────────────────────────────────
  function hubDot(id) {
    const h = APP.hubById(id);
    return `<span class="hub-dot" style="background:${h?.color??'#666'}"></span>`;
  }

  return { toast, escapeHtml, priceBadge, accuracyBadge, wxChip, tagPill, skeleton, confirm, hubDot };
})();

window.UI = UI;
