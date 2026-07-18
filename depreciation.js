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

  // Depreciation expense charged in month `mk` (YYYY-MM). The purchase
  // month itself is charge-free: the first charge lands the month AFTER
  // purchase, and the schedule runs the full life from there (a 5-year
  // asset bought July 2026 charges Aug 2026 … Jul 2031).
  function forMonth(item, years, mk) {
    const m = lifeMonths(years);
    if (!m) return 0;
    const start = monthKeyIdx(String(item.date).slice(0, 7));
    const cur = monthKeyIdx(mk);
    return cur > start && cur <= start + m ? monthlyAmount(item.cost, years) : 0;
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
    // No charge in the purchase month, so months elapsed excludes it.
    const elapsed = Math.min(Math.max(monthKeyIdx(mk) - start, 0), m);
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

  // A fixed asset bought through a payable doesn't touch cash at purchase —
  // cash leaves in the month the payable is settled. aparRows is the raw
  // ap_ar list; only rows with asset_id participate.
  function cashPurchaseRowsForMonth(depItems, aparRows, mk) {
    const linkedAssetIds = new Set(aparRows.filter((r) => r.asset_id).map((r) => r.asset_id));
    const rows = [];
    depItems.forEach((it) => {
      // No linked payable → it was bought with cash, so it hits cash flow
      // in its own purchase month.
      if (purchasedInMonth(it, mk) && !linkedAssetIds.has(it.id)) {
        rows.push({ name: it.name || "item", value: -(Number(it.cost) || 0) });
      }
    });
    aparRows.forEach((row) => {
      if (row.asset_id && row.paid_date && String(row.paid_date).slice(0, 7) === mk) {
        // Label the settlement by the asset it bought — the payable itself
        // may be unnamed or renamed, but the asset is what the money was for.
        const asset = depItems.find((it) => it.id === row.asset_id);
        const name = (asset && asset.name) || row.name || "item";
        rows.push({ name: name + " · payable settled", value: -(Number(row.amount) || 0) });
      }
    });
    return rows;
  }

  // Cumulative cash outflow for fixed-asset purchases through and including
  // month `mk` — same rule as cashPurchaseRowsForMonth, just summed instead
  // of itemized. Always ≤ 0.
  function cashPurchasesThroughMonth(depItems, aparRows, mk) {
    const linkedAssetIds = new Set(aparRows.filter((r) => r.asset_id).map((r) => r.asset_id));
    let total = 0;
    depItems.forEach((it) => {
      if (!linkedAssetIds.has(it.id) && String(it.date).slice(0, 7) <= mk) {
        total -= Number(it.cost) || 0;
      }
    });
    aparRows.forEach((row) => {
      if (row.asset_id && row.paid_date && String(row.paid_date).slice(0, 7) <= mk) {
        total -= Number(row.amount) || 0;
      }
    });
    return total;
  }

  return {
    monthKeyIdx,
    monthlyAmount,
    forMonth,
    forYear,
    accumulated,
    netBookValue,
    purchasedInMonth,
    purchasedInYear,
    cashPurchaseRowsForMonth,
    cashPurchasesThroughMonth,
  };
});
