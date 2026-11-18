(() => {
  'use strict';
  function monthParameter(value, currentMonth) {
    if (!value) return null;
    if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value) || value < '2000-01' || value > currentMonth) throw Error('Choisissez un mois entre janvier 2000 et le mois actuel.');
    return value + '-01';
  }
  function onlineUsers(rows, now = Date.now()) {
    return rows.filter(row => {
      const seen = Date.parse(row.last_seen_at);
      return Number.isFinite(seen) && seen >= now - 120000 && seen <= now + 30000;
    }).sort((a, b) => Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at));
  }
  function count(value) {
    if ((typeof value === 'number' && !Number.isSafeInteger(value)) || !/^\d+$/.test(String(value))) return '—';
    return new Intl.NumberFormat('fr-CH').format(BigInt(value));
  }
  function money(value) {
    const amount = Number(value);
    return value !== null && value !== '' && Number.isFinite(amount) && amount >= 0
      ? new Intl.NumberFormat('fr-CH', { style: 'currency', currency: 'CHF', maximumFractionDigits: 4 }).format(amount) : '—';
  }
  window.CP_ADMIN_TOOLS = Object.freeze({ monthParameter, onlineUsers, count, money });
})();
