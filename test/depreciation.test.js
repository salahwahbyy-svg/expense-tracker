const test = require("node:test");
const assert = require("node:assert/strict");
const Dep = require("../depreciation");

// ---------- forMonth ----------

test("forMonth: purchase month itself is charge-free", () => {
  const item = { date: "2026-01-15", cost: 60000 };
  assert.strictEqual(Dep.forMonth(item, 5, "2026-01"), 0);
});

test("forMonth: first charge lands the month after purchase", () => {
  const item = { date: "2026-01-15", cost: 60000 };
  assert.strictEqual(Dep.forMonth(item, 5, "2026-02"), 1000); // 60000 / (5*12)
});

test("forMonth: last charge month is exactly life months after purchase", () => {
  const item = { date: "2026-01-15", cost: 60000 };
  // 5 years = 60 months; purchase 2026-01 -> last charge 2031-01.
  assert.strictEqual(Dep.forMonth(item, 5, "2031-01"), 1000);
});

test("forMonth: zero outside the asset's life (before purchase or after full depreciation)", () => {
  const item = { date: "2026-01-15", cost: 60000 };
  assert.strictEqual(Dep.forMonth(item, 5, "2025-12"), 0); // before purchase
  assert.strictEqual(Dep.forMonth(item, 5, "2031-02"), 0); // one month past life
});

// ---------- accumulated ----------

test("accumulated: grows monthly and caps at cost once fully depreciated", () => {
  const item = { date: "2026-01-15", cost: 60000 };
  assert.strictEqual(Dep.accumulated(item, 5, "2026-01"), 0); // purchase month, no charge yet
  assert.strictEqual(Dep.accumulated(item, 5, "2026-02"), 1000); // one month elapsed
  assert.strictEqual(Dep.accumulated(item, 5, "2031-01"), 60000); // full life elapsed
  assert.strictEqual(Dep.accumulated(item, 5, "2031-02"), 60000); // capped, no further growth
  assert.strictEqual(Dep.accumulated(item, 5, "2040-01"), 60000); // still capped, years later
});

// ---------- cashPurchaseRowsForMonth ----------

test("cashPurchaseRowsForMonth: cash-bought asset subtracts only in its purchase month", () => {
  const depItems = [{ id: "cash1", date: "2026-03-05", cost: 5000, name: "Printer" }];
  const aparRows = [];

  const marchRows = Dep.cashPurchaseRowsForMonth(depItems, aparRows, "2026-03");
  assert.deepStrictEqual(marchRows, [{ name: "Printer", value: -5000 }]);

  assert.deepStrictEqual(Dep.cashPurchaseRowsForMonth(depItems, aparRows, "2026-02"), []);
  assert.deepStrictEqual(Dep.cashPurchaseRowsForMonth(depItems, aparRows, "2026-04"), []);
});

test("cashPurchaseRowsForMonth: payable-bought asset that's still unpaid never subtracts", () => {
  const depItems = [{ id: "assetB", date: "2026-03-05", cost: 3000, name: "Laptop" }];
  const aparRows = [{ id: "ap1", kind: "ap", asset_id: "assetB", amount: 3000, paid_date: null }];

  // Not in the purchase month (it's on credit, not cash)...
  assert.deepStrictEqual(Dep.cashPurchaseRowsForMonth(depItems, aparRows, "2026-03"), []);
  // ...and not in any later month either, since it hasn't been paid.
  assert.deepStrictEqual(Dep.cashPurchaseRowsForMonth(depItems, aparRows, "2026-06"), []);
});

test("cashPurchaseRowsForMonth: payable-bought asset paid two months later subtracts at the paid month, not the purchase month", () => {
  const depItems = [{ id: "assetC", date: "2026-03-05", cost: 3000, name: "Chair" }];
  const aparRows = [{ id: "ap2", kind: "ap", asset_id: "assetC", amount: 3000, paid_date: "2026-05-10" }];

  assert.deepStrictEqual(Dep.cashPurchaseRowsForMonth(depItems, aparRows, "2026-03"), []); // purchase month: no cash movement
  assert.deepStrictEqual(Dep.cashPurchaseRowsForMonth(depItems, aparRows, "2026-04"), []); // nothing happened yet
  assert.deepStrictEqual(Dep.cashPurchaseRowsForMonth(depItems, aparRows, "2026-05"), [
    { name: "Chair · payable settled", value: -3000 },
  ]);
  assert.deepStrictEqual(Dep.cashPurchaseRowsForMonth(depItems, aparRows, "2026-06"), []); // only fires in the paid month
});

test("cashPurchaseRowsForMonth: mixed list only reports the right row for the right month", () => {
  const depItems = [
    { id: "cash1", date: "2026-03-05", cost: 5000, name: "Printer" },
    { id: "assetB", date: "2026-03-10", cost: 3000, name: "Laptop" },
    { id: "assetC", date: "2026-03-20", cost: 3000, name: "Chair" },
  ];
  const aparRows = [
    { id: "ap1", kind: "ap", asset_id: "assetB", amount: 3000, paid_date: null },
    { id: "ap2", kind: "ap", asset_id: "assetC", amount: 3000, paid_date: "2026-05-10" },
  ];

  // Purchase month: only the cash-bought item shows up.
  assert.deepStrictEqual(Dep.cashPurchaseRowsForMonth(depItems, aparRows, "2026-03"), [
    { name: "Printer", value: -5000 },
  ]);
  // Paid month for assetC: only the settlement row shows up.
  assert.deepStrictEqual(Dep.cashPurchaseRowsForMonth(depItems, aparRows, "2026-05"), [
    { name: "Chair · payable settled", value: -3000 },
  ]);
  // A month with nothing happening reports nothing.
  assert.deepStrictEqual(Dep.cashPurchaseRowsForMonth(depItems, aparRows, "2026-04"), []);
});

// ---------- cashPurchasesThroughMonth ----------

test("cashPurchasesThroughMonth: cumulative total reflects cash-out timing, not accounting timing", () => {
  const depItems = [
    { id: "cash1", date: "2026-03-05", cost: 5000, name: "Printer" }, // cash buy
    { id: "assetB", date: "2026-03-10", cost: 3000, name: "Laptop" }, // on credit, never paid
    { id: "assetC", date: "2026-03-20", cost: 3000, name: "Chair" }, // on credit, paid in May
  ];
  const aparRows = [
    { id: "ap1", kind: "ap", asset_id: "assetB", amount: 3000, paid_date: null },
    { id: "ap2", kind: "ap", asset_id: "assetC", amount: 3000, paid_date: "2026-05-10" },
  ];

  assert.strictEqual(Dep.cashPurchasesThroughMonth(depItems, aparRows, "2026-02"), 0); // before anything
  assert.strictEqual(Dep.cashPurchasesThroughMonth(depItems, aparRows, "2026-03"), -5000); // only the cash buy
  assert.strictEqual(Dep.cashPurchasesThroughMonth(depItems, aparRows, "2026-04"), -5000); // assetC still unpaid
  assert.strictEqual(Dep.cashPurchasesThroughMonth(depItems, aparRows, "2026-05"), -8000); // assetC settled this month
  assert.strictEqual(Dep.cashPurchasesThroughMonth(depItems, aparRows, "2026-12"), -8000); // assetB never paid, stays out
});

test("cashPurchasesThroughMonth: returns 0 for an empty ledger", () => {
  assert.strictEqual(Dep.cashPurchasesThroughMonth([], [], "2026-01"), 0);
});
