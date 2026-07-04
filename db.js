const { createClient } = require("@libsql/client");

// Falls back to a local SQLite file when no Turso credentials are set
// (e.g. local development), and uses the hosted Turso DB in production.
const client = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:local.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const ready = client.batch(
  [
    `CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      sync_code TEXT NOT NULL,
      amount REAL NOT NULL,
      category TEXT NOT NULL,
      note TEXT,
      date TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      sync_code TEXT NOT NULL,
      category TEXT NOT NULL,
      name TEXT DEFAULT '',
      value REAL DEFAULT 0,
      grams REAL DEFAULT 0,
      price_per_gram REAL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS liabilities (
      id TEXT PRIMARY KEY,
      sync_code TEXT NOT NULL,
      category TEXT NOT NULL,
      name TEXT DEFAULT '',
      value REAL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS pnl_income (
      id TEXT PRIMARY KEY,
      sync_code TEXT NOT NULL,
      category TEXT NOT NULL,
      name TEXT DEFAULT '',
      value REAL DEFAULT 0,
      month TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS cf_items (
      id TEXT PRIMARY KEY,
      sync_code TEXT NOT NULL,
      section TEXT NOT NULL,
      name TEXT DEFAULT '',
      value REAL DEFAULT 0,
      month TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS net_worth_history (
      sync_code TEXT NOT NULL,
      month TEXT NOT NULL,
      value REAL DEFAULT 0,
      PRIMARY KEY (sync_code, month)
    )`,
    `CREATE TABLE IF NOT EXISTS fin_settings (
      sync_code TEXT PRIMARY KEY,
      exchange_rate REAL DEFAULT 47.5,
      starting_cash REAL DEFAULT 0,
      unanim_valuation REAL DEFAULT 0,
      unanim_ownership REAL DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS idx_expenses_sync_code ON expenses (sync_code)`,
    `CREATE INDEX IF NOT EXISTS idx_assets_sync_code ON assets (sync_code)`,
    `CREATE INDEX IF NOT EXISTS idx_liabilities_sync_code ON liabilities (sync_code)`,
    `CREATE INDEX IF NOT EXISTS idx_pnl_income_sync_code ON pnl_income (sync_code)`,
    `CREATE INDEX IF NOT EXISTS idx_cf_items_sync_code ON cf_items (sync_code)`,
  ],
  "write"
);

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

// ---------- generic row helpers ----------
async function getRows(table, code) {
  await ready;
  const result = await client.execute({
    sql: `SELECT * FROM ${table} WHERE sync_code = ? ORDER BY rowid ASC`,
    args: [code],
  });
  return result.rows;
}

async function insertRow(table, code, fields) {
  await ready;
  const id = genId();
  const cols = ["id", "sync_code", ...Object.keys(fields)];
  const vals = [id, code, ...Object.values(fields)];
  const placeholders = cols.map(() => "?").join(",");
  await client.execute({
    sql: `INSERT INTO ${table} (${cols.join(",")}) VALUES (${placeholders})`,
    args: vals,
  });
  const result = await client.execute({ sql: `SELECT * FROM ${table} WHERE id = ?`, args: [id] });
  return result.rows[0];
}

async function updateRow(table, code, id, allowedColumns, fields) {
  await ready;
  const sets = Object.keys(fields).filter((c) => allowedColumns.includes(c));
  if (sets.length === 0) {
    const result = await client.execute({
      sql: `SELECT * FROM ${table} WHERE id = ? AND sync_code = ?`,
      args: [id, code],
    });
    return result.rows[0];
  }
  const setClause = sets.map((c) => `${c} = ?`).join(",");
  const vals = sets.map((c) => fields[c]);
  await client.execute({
    sql: `UPDATE ${table} SET ${setClause} WHERE id = ? AND sync_code = ?`,
    args: [...vals, id, code],
  });
  const result = await client.execute({
    sql: `SELECT * FROM ${table} WHERE id = ? AND sync_code = ?`,
    args: [id, code],
  });
  return result.rows[0];
}

async function deleteRow(table, code, id) {
  await ready;
  const result = await client.execute({
    sql: `DELETE FROM ${table} WHERE id = ? AND sync_code = ?`,
    args: [id, code],
  });
  return result.rowsAffected > 0;
}

module.exports = {
  async getExpenses(code) {
    await ready;
    const result = await client.execute({
      sql: "SELECT id, amount, category, note, date, created_at as createdAt FROM expenses WHERE sync_code = ? ORDER BY created_at DESC",
      args: [code],
    });
    return result.rows.map((r) => ({
      id: r.id,
      amount: r.amount,
      category: r.category,
      note: r.note,
      date: r.date,
      createdAt: Number(r.createdAt),
    }));
  },

  async addExpense(code, expense) {
    await ready;
    await client.execute({
      sql: "INSERT INTO expenses (id, sync_code, amount, category, note, date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [expense.id, code, expense.amount, expense.category, expense.note, expense.date, expense.createdAt],
    });
  },

  async deleteExpense(code, id) {
    await ready;
    const result = await client.execute({
      sql: "DELETE FROM expenses WHERE id = ? AND sync_code = ?",
      args: [id, code],
    });
    return result.rowsAffected > 0;
  },

  // ---------- assets ----------
  getAssets: (code) => getRows("assets", code),
  addAsset: (code, f) => insertRow("assets", code, { category: f.category, name: f.name || "", value: f.value || 0, grams: f.grams || 0, price_per_gram: f.price_per_gram || 0 }),
  updateAsset: (code, id, f) => updateRow("assets", code, id, ["category", "name", "value", "grams", "price_per_gram"], f),
  deleteAsset: (code, id) => deleteRow("assets", code, id),

  // ---------- liabilities ----------
  getLiabilities: (code) => getRows("liabilities", code),
  addLiability: (code, f) => insertRow("liabilities", code, { category: f.category, name: f.name || "", value: f.value || 0 }),
  updateLiability: (code, id, f) => updateRow("liabilities", code, id, ["category", "name", "value"], f),
  deleteLiability: (code, id) => deleteRow("liabilities", code, id),

  // ---------- P&L income (expenses come from the expenses table itself) ----------
  getPnlIncome: (code) => getRows("pnl_income", code),
  addPnlIncome: (code, f) => insertRow("pnl_income", code, { category: f.category, name: f.name || "", value: f.value || 0, month: f.month }),
  updatePnlIncome: (code, id, f) => updateRow("pnl_income", code, id, ["category", "name", "value", "month"], f),
  deletePnlIncome: (code, id) => deleteRow("pnl_income", code, id),

  // ---------- cash flow ----------
  getCfItems: (code) => getRows("cf_items", code),
  addCfItem: (code, f) => insertRow("cf_items", code, { section: f.section, name: f.name || "", value: f.value || 0, month: f.month }),
  updateCfItem: (code, id, f) => updateRow("cf_items", code, id, ["section", "name", "value", "month"], f),
  deleteCfItem: (code, id) => deleteRow("cf_items", code, id),

  // ---------- net worth history ----------
  async getNetWorthHistory(code) {
    await ready;
    const result = await client.execute({
      sql: "SELECT month, value FROM net_worth_history WHERE sync_code = ? ORDER BY month ASC",
      args: [code],
    });
    return result.rows;
  },
  async snapshotNetWorth(code, month, value) {
    await ready;
    await client.execute({
      sql: "INSERT INTO net_worth_history (sync_code, month, value) VALUES (?, ?, ?) ON CONFLICT(sync_code, month) DO UPDATE SET value = excluded.value",
      args: [code, month, value],
    });
    return module.exports.getNetWorthHistory(code);
  },

  // ---------- settings ----------
  async getSettings(code) {
    await ready;
    const result = await client.execute({
      sql: "SELECT exchange_rate, starting_cash, unanim_valuation, unanim_ownership FROM fin_settings WHERE sync_code = ?",
      args: [code],
    });
    const row = result.rows[0];
    return {
      exchangeRate: row ? row.exchange_rate : 47.5,
      startingCash: row ? row.starting_cash : 0,
      unanimValuation: row ? row.unanim_valuation : 0,
      unanimOwnership: row ? row.unanim_ownership : 0,
    };
  },
  async saveSettings(code, partial) {
    await ready;
    const current = await module.exports.getSettings(code);
    const merged = { ...current, ...partial };
    await client.execute({
      sql: `INSERT INTO fin_settings (sync_code, exchange_rate, starting_cash, unanim_valuation, unanim_ownership)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(sync_code) DO UPDATE SET
              exchange_rate = excluded.exchange_rate,
              starting_cash = excluded.starting_cash,
              unanim_valuation = excluded.unanim_valuation,
              unanim_ownership = excluded.unanim_ownership`,
      args: [code, merged.exchangeRate, merged.startingCash, merged.unanimValuation, merged.unanimOwnership],
    });
    return merged;
  },
};
