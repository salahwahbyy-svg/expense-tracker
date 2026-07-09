// Shared straight-line depreciation math — the single source of truth for
// the P&L expense, the Balance Sheet accumulated depreciation / net book
// value, and the Cash Flow investing outflow + operating add-back. Loaded
// by the browser (window.Depreciation) and by the server exports (require).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Depreciation = factory();
})(typeof self !== "undefined" ? self : this, function () {
  function monthKeyIdx(mk) {
    return Number(mk.slice(0, 4)) * 12 + Number(mk.slice(5, 7)) - 1;
  }

  function lifeMonths(years) {
    return Math.max(0, Math.round(Number(years) || 0)) * 12;
  }

  // Straight-line monthly charge: cost ÷ (years × 12).
  function monthlyAmount(cost, years) {
    const m = lifeMonths(years);
    return m ? (Number(cost) || 0) / m : 0;
  }

  // Depreciation expense charged in month `mk` (YYYY-MM). Non-zero only
  // between the purchase month and the end of the useful life.
  function forMonth(item, years, mk) {
    const m = lifeMonths(years);
    if (!m) return 0;
    const start = monthKeyIdx(String(item.date).slice(0, 7));
    const cur = monthKeyIdx(mk);
    return cur >= start && cur < start + m ? monthlyAmount(item.cost, years) : 0;
  }

  // Depreciation expense for a calendar year (proration handled naturally:
  // only the months the item was in service contribute).
  function forYear(item, years, year) {
    let s = 0;
    for (let i = 1; i <= 12; i++) s += forMonth(item, years, year + "-" + String(i).padStart(2, "0"));
    return s;
  }

  // Contra-asset balance: accumulated depreciation up to and including
  // month `mk`, capped at cost once fully depreciated. Computed, never
  // stored, so all statements always agree.
  function accumulated(item, years, mk) {
    const m = lifeMonths(years);
    if (!m) return 0;
    const start = monthKeyIdx(String(item.date).slice(0, 7));
    const elapsed = Math.min(Math.max(monthKeyIdx(mk) - start + 1, 0), m);
    return monthlyAmount(item.cost, years) * elapsed;
  }

  // Net book value = original cost − accumulated depreciation. The asset
  // itself stays on the books at cost.
  function netBookValue(item, years, mk) {
    return (Number(item.cost) || 0) - accumulated(item, years, mk);
  }

  function purchasedInMonth(item, mk) {
    return String(item.date).slice(0, 7) === mk;
  }

  function purchasedInYear(item, year) {
    return String(item.date).slice(0, 4) === String(year);
  }

  return { monthKeyIdx, monthlyAmount, forMonth, forYear, accumulated, netBookValue, purchasedInMonth, purchasedInYear };
});
