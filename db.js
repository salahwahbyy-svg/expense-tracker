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
      created_at INTEGER NOT NULL,
      receipt TEXT DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS incomes (
      id TEXT PRIMARY KEY,
      sync_code TEXT NOT NULL,
      amount REAL NOT NULL,
      category TEXT NOT NULL,
      note TEXT,
      date TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      receipt TEXT DEFAULT ''
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
    `CREATE TABLE IF NOT EXISTS categories (
      sync_code TEXT NOT NULL,
      id TEXT NOT NULL,
      label TEXT NOT NULL,
      emoji TEXT DEFAULT '',
      color TEXT DEFAULT '#9494a3',
      budget REAL DEFAULT 0,
      sort INTEGER DEFAULT 0,
      PRIMARY KEY (sync_code, id)
    )`,
    `CREATE TABLE IF NOT EXISTS dep_categories (
      sync_code TEXT NOT NULL,
      id TEXT NOT NULL,
      label TEXT NOT NULL,
      years INTEGER DEFAULT 5,
      sort INTEGER DEFAULT 0,
      PRIMARY KEY (sync_code, id)
    )`,
    `CREATE TABLE IF NOT EXISTS dep_items (
      id TEXT PRIMARY KEY,
      sync_code TEXT NOT NULL,
      category TEXT NOT NULL,
      name TEXT DEFAULT '',
      cost REAL DEFAULT 0,
      date TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS fin_settings (
      sync_code TEXT PRIMARY KEY,
      exchange_rate REAL DEFAULT 47.5,
      starting_cash REAL DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS idx_expenses_sync_code ON expenses (sync_code)`,
    `CREATE TABLE IF NOT EXISTS bs_categories (
      sync_code TEXT NOT NULL,
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      label TEXT NOT NULL,
      sort INTEGER DEFAULT 0,
      PRIMARY KEY (sync_code, kind, id)
    )`,
    `CREATE TABLE IF NOT EXISTS income_categories (
      sync_code TEXT NOT NULL,
      id TEXT NOT NULL,
      label TEXT NOT NULL,
      emoji TEXT DEFAULT '',
      color TEXT DEFAULT '#9494a3',
      sort INTEGER DEFAULT 0,
      PRIMARY KEY (sync_code, id)
    )`,
    `CREATE TABLE IF NOT EXISTS ap_ar (
      id TEXT PRIMARY KEY,
      sync_code TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT DEFAULT '',
      amount REAL DEFAULT 0,
      due_date TEXT,
      paid_date TEXT,
      linked_id TEXT,
      category TEXT DEFAULT ''
    )`,
    `CREATE INDEX IF NOT EXISTS idx_ap_ar_sync_code ON ap_ar (sync_code)`,
    `CREATE INDEX IF NOT EXISTS idx_incomes_sync_code ON incomes (sync_code)`,
    `CREATE INDEX IF NOT EXISTS idx_dep_items_sync_code ON dep_items (sync_code)`,
    `CREATE INDEX IF NOT EXISTS idx_assets_sync_code ON assets (sync_code)`,
    `CREATE INDEX IF NOT EXISTS idx_liabilities_sync_code ON liabilities (sync_code)`,
    `CREATE INDEX IF NOT EXISTS idx_pnl_income_sync_code ON pnl_income (sync_code)`,
    `CREATE INDEX IF NOT EXISTS idx_cf_items_sync_code ON cf_items (sync_code)`,
  ],
  "write"
).then(() =>
  // Guarded column additions for databases created before these settings
  // existed; "duplicate column" failures are expected and ignored.
  Promise.allSettled([
    client.execute("ALTER TABLE fin_settings ADD COLUMN tax_rate REAL DEFAULT 0"),
    client.execute("ALTER TABLE fin_settings ADD COLUMN cogs_categories TEXT DEFAULT '[]'"),
    client.execute("ALTER TABLE ap_ar ADD COLUMN linked_id TEXT"),
    client.execute("ALTER TABLE expenses ADD COLUMN receipt TEXT DEFAULT ''"),
    client.execute("ALTER TABLE incomes ADD COLUMN receipt TEXT DEFAULT ''"),
    client.execute("ALTER TABLE ap_ar ADD COLUMN category TEXT DEFAULT ''"),
    client.execute("ALTER TABLE categories ADD COLUMN deleted INTEGER DEFAULT 0"),
    client.execute("ALTER TABLE ap_ar ADD COLUMN asset_id TEXT"),
  ]).then(() =>
    // One-time migration away from the Gold/Silver grams×price special case:
    // bake the computed value into `value`, then fold those categories into
    // 'Other'. Idempotent — after the first run nothing matches.
    client.batch(
      [
        "UPDATE assets SET value = grams * price_per_gram WHERE (value IS NULL OR value = 0) AND grams > 0 AND price_per_gram > 0",
        "UPDATE assets SET category = 'Other' WHERE category IN ('Gold','Silver')",
      ],
      "write"
    )
  )
);

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

// Seeded per sync code; ids equal the category strings income entries have
// always stored, so existing rows keep working. 'Other Income' is permanent
// and is the reassignment target when a category with entries is deleted.
const DEFAULT_INCOME_CATEGORIES = [
  { id: "Salary", label: "Salary", emoji: "💼", color: "#6cf0b8" },
  { id: "Business Income", label: "Business", emoji: "🏪", color: "#5bc0ff" },
  { id: "Investment Income", label: "Investment", emoji: "📈", color: "#c792ff" },
  { id: "Other Income", label: "Other", emoji: "💰", color: "#ffd166" },
];

// Seeded per sync code and kind; ids equal the labels the app has always
// stored on items, so existing rows keep working. 'Other' is permanent and
// is the reassignment target when a category with items is deleted.
const DEFAULT_BS_CATEGORIES = {
  asset: ["Cash", "Bank Accounts", "Property", "Stocks", "Other"],
  liability: ["Loans", "Credit Card", "Payables", "Other"],
};

// Which item table each balance-sheet category kind governs.
const BS_ITEM_TABLES = { asset: "assets", liability: "liabilities" };

// Seeded for every new sync code; label + straight-line useful life.
const DEFAULT_DEP_CATEGORIES = [
  { id: "furniture", label: "Furniture", years: 7 },
  { id: "computers", label: "Computers & Laptops", years: 5 },
  { id: "vehicles", label: "Vehicles", years: 5 },
  { id: "equipment", label: "Equipment", years: 10 },
];

// Seeded for every new sync code; 'other' is permanent and is the
// reassignment target when a category with expenses is deleted.
const DEFAULT_CATEGORIES = [
  { id: "food", label: "Food", emoji: "🍔", color: "#ff8a5b" },
  { id: "transport", label: "Transport", emoji: "🚗", color: "#5bc0ff" },
  { id: "bills", label: "Bills", emoji: "🧾", color: "#ffd166" },
  { id: "shopping", label: "Shopping", emoji: "🛍️", color: "#c792ff" },
  { id: "entertainment", label: "Fun", emoji: "🎬", color: "#6cf0b8" },
  { id: "business", label: "Business", emoji: "💼", color: "#6c8bff" },
  { id: "interest", label: "Interest", emoji: "🏦", color: "#ff9ecb" },
  { id: "other", label: "Other", emoji: "📦", color: "#9494a3" },
];

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

// Expenses and incomes are the same shape (a dated log of amounts), so both
// use this helper bound to their own table.
function datedLog(table) {
  return {
    async get(code) {
      await ready;
      const result = await client.execute({
        sql: `SELECT id, amount, category, note, date, created_at as createdAt, receipt FROM ${table} WHERE sync_code = ? ORDER BY created_at DESC`,
        args: [code],
      });
      return result.rows.map((r) => ({
        id: r.id,
        amount: r.amount,
        category: r.category,
        note: r.note,
        date: r.date,
        createdAt: Number(r.createdAt),
        receipt: r.receipt || "",
      }));
    },

    async add(code, entry) {
      await ready;
      await client.execute({
        sql: `INSERT INTO ${table} (id, sync_code, amount, category, note, date, created_at, receipt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [entry.id, code, entry.amount, entry.category, entry.note, entry.date, entry.createdAt, entry.receipt || ""],
      });
    },

    async update(code, id, entry) {
      await ready;
      const result = await client.execute({
        sql: `UPDATE ${table} SET amount = ?, category = ?, note = ?, date = ?, receipt = ? WHERE id = ? AND sync_code = ?`,
        args: [entry.amount, entry.category, entry.note, entry.date, entry.receipt || "", id, code],
      });
      return result.rowsAffected > 0;
    },

    async remove(code, id) {
      await ready;
      const result = await client.execute({
        sql: `DELETE FROM ${table} WHERE id = ? AND sync_code = ?`,
        args: [id, code],
      });
      return result.rowsAffected > 0;
    },
  };
}

const expensesLog = datedLog("expenses");
const incomesLog = datedLog("incomes");

module.exports = {
  getExpenses: expensesLog.get,
  addExpense: expensesLog.add,
  updateExpense: expensesLog.update,
  deleteExpense: expensesLog.remove,

  getIncomes: incomesLog.get,
  addIncome: incomesLog.add,
  updateIncome: incomesLog.update,
  deleteIncome: incomesLog.remove,

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

  // ---------- expense categories ----------
  async getCategories(code) {
    await ready;
    let result = await client.execute({
      sql: "SELECT id, label, emoji, color, budget, deleted FROM categories WHERE sync_code = ? ORDER BY sort ASC, rowid ASC",
      args: [code],
    });
    if (result.rows.length === 0) {
      await client.batch(
        DEFAULT_CATEGORIES.map((c, i) => ({
          sql: "INSERT OR IGNORE INTO categories (sync_code, id, label, emoji, color, budget, sort) VALUES (?, ?, ?, ?, ?, 0, ?)",
          args: [code, c.id, c.label, c.emoji, c.color, i],
        })),
        "write"
      );
      result = await client.execute({
        sql: "SELECT id, label, emoji, color, budget, deleted FROM categories WHERE sync_code = ? ORDER BY sort ASC, rowid ASC",
        args: [code],
      });
    }
    return result.rows;
  },

  async addCategory(code, cat) {
    await ready;
    await client.execute({
      sql: "INSERT INTO categories (sync_code, id, label, emoji, color, budget, sort) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [code, cat.id, cat.label, cat.emoji, cat.color, cat.budget || 0, Date.now()],
    });
    return cat;
  },

  async updateCategory(code, id, fields) {
    await ready;
    const allowed = ["label", "emoji", "color", "budget"];
    const sets = Object.keys(fields).filter((k) => allowed.includes(k));
    if (sets.length === 0) return true;
    const setClause = sets.map((k) => `${k} = ?`).join(",");
    const result = await client.execute({
      sql: `UPDATE categories SET ${setClause} WHERE sync_code = ? AND id = ? AND deleted = 0`,
      args: [...sets.map((k) => fields[k]), code, id],
    });
    return result.rowsAffected > 0;
  },

  // Deleting a category no longer moves expenses — they keep their category
  // id and the client shows them as "<label> · deleted". The category row is
  // just tombstoned so it disappears from pickers/editors. Returns how many
  // expenses are still attributed to it, or null if not found.
  async deleteCategory(code, id) {
    await ready;
    const del = await client.execute({
      sql: "UPDATE categories SET deleted = 1 WHERE sync_code = ? AND id = ? AND deleted = 0",
      args: [code, id],
    });
    if (del.rowsAffected === 0) return null;
    return module.exports.countExpensesInCategory(code, id);
  },

  async countExpensesInCategory(code, id) {
    await ready;
    const result = await client.execute({
      sql: "SELECT COUNT(*) AS n FROM expenses WHERE sync_code = ? AND category = ?",
      args: [code, id],
    });
    return Number(result.rows[0].n);
  },

  // ---------- income categories ----------
  async getIncCats(code) {
    await ready;
    let result = await client.execute({
      sql: "SELECT id, label, emoji, color FROM income_categories WHERE sync_code = ? ORDER BY sort ASC, rowid ASC",
      args: [code],
    });
    if (result.rows.length === 0) {
      await client.batch(
        DEFAULT_INCOME_CATEGORIES.map((c, i) => ({
          sql: "INSERT OR IGNORE INTO income_categories (sync_code, id, label, emoji, color, sort) VALUES (?, ?, ?, ?, ?, ?)",
          args: [code, c.id, c.label, c.emoji, c.color, i],
        })),
        "write"
      );
      result = await client.execute({
        sql: "SELECT id, label, emoji, color FROM income_categories WHERE sync_code = ? ORDER BY sort ASC, rowid ASC",
        args: [code],
      });
    }
    return result.rows;
  },

  async addIncCat(code, cat) {
    await ready;
    await client.execute({
      sql: "INSERT INTO income_categories (sync_code, id, label, emoji, color, sort) VALUES (?, ?, ?, ?, ?, ?)",
      args: [code, cat.id, cat.label, cat.emoji, cat.color, Date.now()],
    });
    return cat;
  },

  async updateIncCat(code, id, fields) {
    await ready;
    const allowed = ["label", "emoji", "color"];
    const sets = Object.keys(fields).filter((k) => allowed.includes(k));
    if (sets.length === 0) return true;
    const result = await client.execute({
      sql: `UPDATE income_categories SET ${sets.map((k) => `${k} = ?`).join(",")} WHERE sync_code = ? AND id = ?`,
      args: [...sets.map((k) => fields[k]), code, id],
    });
    return result.rowsAffected > 0;
  },

  // Entries in a deleted income category (both the income log and legacy
  // manual P&L lines) move to the permanent 'Other Income'. Returns how many
  // entries moved, or null if the category wasn't found.
  async deleteIncCat(code, id) {
    await ready;
    const del = await client.execute({
      sql: "DELETE FROM income_categories WHERE sync_code = ? AND id = ?",
      args: [code, id],
    });
    if (del.rowsAffected === 0) return null;
    const moved = await client.batch(
      [
        { sql: "UPDATE incomes SET category = 'Other Income' WHERE sync_code = ? AND category = ?", args: [code, id] },
        { sql: "UPDATE pnl_income SET category = 'Other Income' WHERE sync_code = ? AND category = ?", args: [code, id] },
      ],
      "write"
    );
    return moved.reduce((s, r) => s + r.rowsAffected, 0);
  },

  // ---------- balance-sheet categories (assets & liabilities) ----------
  async getBsCats(code, kind) {
    await ready;
    let result = await client.execute({
      sql: "SELECT id, label FROM bs_categories WHERE sync_code = ? AND kind = ? ORDER BY sort ASC, rowid ASC",
      args: [code, kind],
    });
    if (result.rows.length === 0) {
      await client.batch(
        DEFAULT_BS_CATEGORIES[kind].map((label, i) => ({
          sql: "INSERT OR IGNORE INTO bs_categories (sync_code, kind, id, label, sort) VALUES (?, ?, ?, ?, ?)",
          args: [code, kind, label, label, i],
        })),
        "write"
      );
      result = await client.execute({
        sql: "SELECT id, label FROM bs_categories WHERE sync_code = ? AND kind = ? ORDER BY sort ASC, rowid ASC",
        args: [code, kind],
      });
    }
    return result.rows;
  },

  async addBsCat(code, kind, cat) {
    await ready;
    await client.execute({
      sql: "INSERT INTO bs_categories (sync_code, kind, id, label, sort) VALUES (?, ?, ?, ?, ?)",
      args: [code, kind, cat.id, cat.label, Date.now()],
    });
    return cat;
  },

  async updateBsCat(code, kind, id, label) {
    await ready;
    const result = await client.execute({
      sql: "UPDATE bs_categories SET label = ? WHERE sync_code = ? AND kind = ? AND id = ?",
      args: [label, code, kind, id],
    });
    return result.rowsAffected > 0;
  },

  // Items in a deleted category move to the permanent 'Other' so nothing is
  // lost. Returns how many items moved, or null if the category wasn't found.
  async deleteBsCat(code, kind, id) {
    await ready;
    const del = await client.execute({
      sql: "DELETE FROM bs_categories WHERE sync_code = ? AND kind = ? AND id = ?",
      args: [code, kind, id],
    });
    if (del.rowsAffected === 0) return null;
    const moved = await client.execute({
      sql: `UPDATE ${BS_ITEM_TABLES[kind]} SET category = 'Other' WHERE sync_code = ? AND category = ?`,
      args: [code, id],
    });
    return moved.rowsAffected;
  },

  // ---------- accounts payable / receivable ----------
  getApar: (code) => getRows("ap_ar", code),
  addApar: (code, f) => insertRow("ap_ar", code, { kind: f.kind, name: f.name || "", amount: f.amount || 0, due_date: f.due_date, category: f.category || "" }),
  updateApar: (code, id, f) => updateRow("ap_ar", code, id, ["name", "amount", "due_date", "paid_date", "linked_id", "category"], f),
  deleteApar: (code, id) => deleteRow("ap_ar", code, id),
  async getAparById(code, id) {
    await ready;
    const result = await client.execute({
      sql: "SELECT * FROM ap_ar WHERE id = ? AND sync_code = ?",
      args: [id, code],
    });
    return result.rows[0] || null;
  },

  // Paying an AP/AR item writes the linked income/expense entry and marks
  // the item paid in a single batch, so a crash between the two writes
  // can't leave one without the other.
  async payApar(code, id, kind, entry, date) {
    await ready;
    const table = kind === "ar" ? "incomes" : "expenses";
    await client.batch(
      [
        {
          sql: `INSERT INTO ${table} (id, sync_code, amount, category, note, date, created_at, receipt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [entry.id, code, entry.amount, entry.category, entry.note, entry.date, entry.createdAt, entry.receipt || ""],
        },
        {
          sql: "UPDATE ap_ar SET paid_date = ?, linked_id = ? WHERE id = ? AND sync_code = ?",
          args: [date, entry.id, id, code],
        },
      ],
      "write"
    );
    const result = await client.execute({
      sql: "SELECT * FROM ap_ar WHERE id = ? AND sync_code = ?",
      args: [id, code],
    });
    return result.rows[0];
  },

  // Buying a fixed asset on credit: one dep_items row (drives depreciation)
  // and one linked ap_ar row (the open liability) land together in a single
  // batch so the asset can never exist without its payable or vice versa.
  async addAssetPurchase(code, { category, name, cost, date, due_date }) {
    await ready;
    const assetId = genId();
    const aparId = genId();
    await client.batch(
      [
        {
          sql: "INSERT INTO dep_items (id, sync_code, category, name, cost, date) VALUES (?, ?, ?, ?, ?, ?)",
          args: [assetId, code, category, name || "", cost || 0, date],
        },
        {
          sql: "INSERT INTO ap_ar (id, sync_code, kind, name, amount, due_date, category, asset_id) VALUES (?, ?, 'ap', ?, ?, ?, '', ?)",
          args: [aparId, code, name || "", cost || 0, due_date, assetId],
        },
      ],
      "write"
    );
    const [assetResult, aparResult] = await Promise.all([
      client.execute({ sql: "SELECT * FROM dep_items WHERE id = ?", args: [assetId] }),
      client.execute({ sql: "SELECT * FROM ap_ar WHERE id = ?", args: [aparId] }),
    ]);
    return { asset: assetResult.rows[0], payable: aparResult.rows[0] };
  },

  // Reopening an AP/AR item deletes its linked entry and clears paid_date in
  // a single batch, for the same crash-consistency reason as payApar.
  async unpayApar(code, row) {
    await ready;
    const statements = [];
    if (row.linked_id) {
      const table = row.kind === "ar" ? "incomes" : "expenses";
      statements.push({
        sql: `DELETE FROM ${table} WHERE id = ? AND sync_code = ?`,
        args: [row.linked_id, code],
      });
    }
    statements.push({
      sql: "UPDATE ap_ar SET paid_date = NULL, linked_id = NULL WHERE id = ? AND sync_code = ?",
      args: [row.id, code],
    });
    await client.batch(statements, "write");
    const result = await client.execute({
      sql: "SELECT * FROM ap_ar WHERE id = ? AND sync_code = ?",
      args: [row.id, code],
    });
    return result.rows[0];
  },

  // ---------- depreciation ----------
  async getDepCats(code) {
    await ready;
    let result = await client.execute({
      sql: "SELECT id, label, years FROM dep_categories WHERE sync_code = ? ORDER BY sort ASC, rowid ASC",
      args: [code],
    });
    if (result.rows.length === 0) {
      await client.batch(
        DEFAULT_DEP_CATEGORIES.map((c, i) => ({
          sql: "INSERT OR IGNORE INTO dep_categories (sync_code, id, label, years, sort) VALUES (?, ?, ?, ?, ?)",
          args: [code, c.id, c.label, c.years, i],
        })),
        "write"
      );
      result = await client.execute({
        sql: "SELECT id, label, years FROM dep_categories WHERE sync_code = ? ORDER BY sort ASC, rowid ASC",
        args: [code],
      });
    }
    return result.rows;
  },

  async addDepCat(code, cat) {
    await ready;
    await client.execute({
      sql: "INSERT INTO dep_categories (sync_code, id, label, years, sort) VALUES (?, ?, ?, ?, ?)",
      args: [code, cat.id, cat.label, cat.years, Date.now()],
    });
    return cat;
  },

  async updateDepCat(code, id, fields) {
    await ready;
    const allowed = ["label", "years"];
    const sets = Object.keys(fields).filter((k) => allowed.includes(k));
    if (sets.length === 0) return true;
    const setClause = sets.map((k) => `${k} = ?`).join(",");
    const result = await client.execute({
      sql: `UPDATE dep_categories SET ${setClause} WHERE sync_code = ? AND id = ?`,
      args: [...sets.map((k) => fields[k]), code, id],
    });
    return result.rowsAffected > 0;
  },

  // Deleting a depreciation category removes its items too (they can't be
  // depreciated without a useful life). Returns how many items were removed,
  // or null if the category wasn't found.
  async deleteDepCat(code, id) {
    await ready;
    const del = await client.execute({
      sql: "DELETE FROM dep_categories WHERE sync_code = ? AND id = ?",
      args: [code, id],
    });
    if (del.rowsAffected === 0) return null;
    const items = await client.execute({
      sql: "DELETE FROM dep_items WHERE sync_code = ? AND category = ?",
      args: [code, id],
    });
    return items.rowsAffected;
  },

  getDepItems: (code) => getRows("dep_items", code),
  addDepItem: (code, f) => insertRow("dep_items", code, { category: f.category, name: f.name || "", cost: f.cost || 0, date: f.date }),
  updateDepItem: (code, id, f) => updateRow("dep_items", code, id, ["category", "name", "cost", "date"], f),
  deleteDepItem: (code, id) => deleteRow("dep_items", code, id),

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
      sql: "SELECT exchange_rate, starting_cash, tax_rate, cogs_categories FROM fin_settings WHERE sync_code = ?",
      args: [code],
    });
    const row = result.rows[0];
    let cogsCategories = [];
    try {
      cogsCategories = row ? JSON.parse(row.cogs_categories) || [] : [];
    } catch {
      /* corrupted value -> default */
    }
    return {
      exchangeRate: row ? row.exchange_rate : 47.5,
      startingCash: row ? row.starting_cash : 0,
      taxRate: row ? row.tax_rate : 0,
      cogsCategories,
    };
  },
  async saveSettings(code, partial) {
    await ready;
    const current = await module.exports.getSettings(code);
    const merged = { ...current, ...partial };
    await client.execute({
      sql: `INSERT INTO fin_settings (sync_code, exchange_rate, starting_cash, tax_rate, cogs_categories)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(sync_code) DO UPDATE SET
              exchange_rate = excluded.exchange_rate,
              starting_cash = excluded.starting_cash,
              tax_rate = excluded.tax_rate,
              cogs_categories = excluded.cogs_categories`,
      args: [
        code,
        merged.exchangeRate,
        merged.startingCash,
        merged.taxRate,
        JSON.stringify(merged.cogsCategories || []),
      ],
    });
    return merged;
  },
};
