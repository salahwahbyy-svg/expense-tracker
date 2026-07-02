const { createClient } = require("@libsql/client");

// Falls back to a local SQLite file when no Turso credentials are set
// (e.g. local development), and uses the hosted Turso DB in production.
const client = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:local.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const ready = client.execute(`
  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    sync_code TEXT NOT NULL,
    amount REAL NOT NULL,
    category TEXT NOT NULL,
    note TEXT,
    date TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`);

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
};
