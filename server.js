const path = require("path");
const express = require("express");
const { customAlphabet } = require("nanoid");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const generateCode = customAlphabet(CODE_ALPHABET, 7);

const ALLOWED_CATEGORIES = new Set([
  "food",
  "transport",
  "bills",
  "shopping",
  "entertainment",
  "other",
]);

const CODE_RE = /^[A-Z0-9]{4,16}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

app.use(express.json());
app.use(express.static(__dirname));

function requireCode(req, res, next) {
  const code = (req.query.code || (req.body && req.body.code) || "").toString().toUpperCase();
  if (!CODE_RE.test(code)) {
    return res.status(400).json({ error: "invalid_code" });
  }
  req.syncCode = code;
  next();
}

app.post("/api/codes", (req, res) => {
  res.json({ code: generateCode() });
});

app.get("/api/expenses", requireCode, async (req, res, next) => {
  try {
    res.json({ expenses: await db.getExpenses(req.syncCode) });
  } catch (err) {
    next(err);
  }
});

app.post("/api/expenses", requireCode, async (req, res, next) => {
  const { amount, category, note, date } = req.body;

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) {
    return res.status(400).json({ error: "invalid_amount" });
  }
  if (typeof category !== "string" || !ALLOWED_CATEGORIES.has(category)) {
    return res.status(400).json({ error: "invalid_category" });
  }
  if (typeof date !== "string" || !DATE_RE.test(date)) {
    return res.status(400).json({ error: "invalid_date" });
  }
  const safeNote = typeof note === "string" ? note.slice(0, 200) : "";

  const id = generateCode() + Date.now().toString(36);
  const createdAt = Date.now();
  const expense = { id, amount, category, note: safeNote, date, createdAt };

  try {
    await db.addExpense(req.syncCode, expense);
    res.status(201).json(expense);
  } catch (err) {
    next(err);
  }
});

app.put("/api/expenses/:id", requireCode, async (req, res, next) => {
  const { amount, category, note, date } = req.body;

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) {
    return res.status(400).json({ error: "invalid_amount" });
  }
  if (typeof category !== "string" || !ALLOWED_CATEGORIES.has(category)) {
    return res.status(400).json({ error: "invalid_category" });
  }
  if (typeof date !== "string" || !DATE_RE.test(date)) {
    return res.status(400).json({ error: "invalid_date" });
  }
  const safeNote = typeof note === "string" ? note.slice(0, 200) : "";
  const expense = { amount, category, note: safeNote, date };

  try {
    const updated = await db.updateExpense(req.syncCode, req.params.id, expense);
    if (!updated) return res.status(404).json({ error: "not_found" });
    res.json({ id: req.params.id, ...expense });
  } catch (err) {
    next(err);
  }
});

app.delete("/api/expenses/:id", requireCode, async (req, res, next) => {
  try {
    const deleted = await db.deleteExpense(req.syncCode, req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: "not_found" });
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---------- Financial statements ----------

const ASSET_CATEGORIES = ["Cash", "Bank Accounts", "Gold", "Silver", "Property", "Stocks"];
const LIABILITY_CATEGORIES = ["Loans", "Credit Card", "Payables"];
const INCOME_CATEGORIES = ["Salary", "Business Income", "Investment Income", "Other Income"];
const CF_SECTIONS = ["operating", "investing", "financing"];
const MONTH_RE = /^\d{4}-\d{2}$/;

app.get("/api/fin/categories", (req, res) => {
  res.json({
    assetCategories: ASSET_CATEGORIES,
    liabilityCategories: LIABILITY_CATEGORIES,
    incomeCategories: INCOME_CATEGORIES,
    cfSections: CF_SECTIONS,
  });
});

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function safeName(v) {
  return typeof v === "string" ? v.slice(0, 100) : "";
}

// Generic CRUD route factory for the statement tables. Each entity defines
// how to sanitize an incoming body; months and enum fields are validated.
function finCrud(name, { get, add, update, remove, sanitize }) {
  app.get(`/api/fin/${name}`, requireCode, async (req, res, next) => {
    try {
      res.json(await get(req.syncCode));
    } catch (err) {
      next(err);
    }
  });

  app.post(`/api/fin/${name}`, requireCode, async (req, res, next) => {
    try {
      const fields = sanitize(req.body || {});
      if (!fields) return res.status(400).json({ error: "invalid_fields" });
      res.status(201).json(await add(req.syncCode, fields));
    } catch (err) {
      next(err);
    }
  });

  app.put(`/api/fin/${name}/:id`, requireCode, async (req, res, next) => {
    try {
      const fields = sanitize(req.body || {}, true);
      if (!fields) return res.status(400).json({ error: "invalid_fields" });
      const row = await update(req.syncCode, req.params.id, fields);
      if (!row) return res.status(404).json({ error: "not_found" });
      res.json(row);
    } catch (err) {
      next(err);
    }
  });

  app.delete(`/api/fin/${name}/:id`, requireCode, async (req, res, next) => {
    try {
      const deleted = await remove(req.syncCode, req.params.id);
      if (!deleted) return res.status(404).json({ error: "not_found" });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });
}

// For partial updates only include keys present in the body; for creates
// fill defaults. Returns null when a provided enum value is invalid.
function pick(body, partial, spec) {
  const out = {};
  for (const [key, rule] of Object.entries(spec)) {
    if (partial && !(key in body)) continue;
    const raw = body[key];
    if (rule === "num") out[key] = num(raw);
    else if (rule === "name") out[key] = safeName(raw);
    else if (rule === "month") {
      if (typeof raw !== "string" || !MONTH_RE.test(raw)) {
        if (partial) return null;
        out[key] = new Date().toISOString().slice(0, 7);
      } else out[key] = raw;
    } else if (Array.isArray(rule)) {
      if (typeof raw !== "string" || !rule.includes(raw)) {
        if (partial) return null;
        out[key] = rule[0];
      } else out[key] = raw;
    }
  }
  return out;
}

finCrud("assets", {
  get: db.getAssets,
  add: db.addAsset,
  update: db.updateAsset,
  remove: db.deleteAsset,
  sanitize: (b, partial) =>
    pick(b, partial, { category: ASSET_CATEGORIES, name: "name", value: "num", grams: "num", price_per_gram: "num" }),
});

finCrud("liabilities", {
  get: db.getLiabilities,
  add: db.addLiability,
  update: db.updateLiability,
  remove: db.deleteLiability,
  sanitize: (b, partial) => pick(b, partial, { category: LIABILITY_CATEGORIES, name: "name", value: "num" }),
});

finCrud("income", {
  get: db.getPnlIncome,
  add: db.addPnlIncome,
  update: db.updatePnlIncome,
  remove: db.deletePnlIncome,
  sanitize: (b, partial) => pick(b, partial, { category: INCOME_CATEGORIES, name: "name", value: "num", month: "month" }),
});

finCrud("cashflow", {
  get: db.getCfItems,
  add: db.addCfItem,
  update: db.updateCfItem,
  remove: db.deleteCfItem,
  sanitize: (b, partial) => pick(b, partial, { section: CF_SECTIONS, name: "name", value: "num", month: "month" }),
});

app.get("/api/fin/networth", requireCode, async (req, res, next) => {
  try {
    res.json(await db.getNetWorthHistory(req.syncCode));
  } catch (err) {
    next(err);
  }
});

app.post("/api/fin/networth/snapshot", requireCode, async (req, res, next) => {
  const { month, value } = req.body || {};
  if (typeof month !== "string" || !MONTH_RE.test(month)) {
    return res.status(400).json({ error: "invalid_month" });
  }
  try {
    res.json(await db.snapshotNetWorth(req.syncCode, month, num(value)));
  } catch (err) {
    next(err);
  }
});

app.get("/api/fin/settings", requireCode, async (req, res, next) => {
  try {
    res.json(await db.getSettings(req.syncCode));
  } catch (err) {
    next(err);
  }
});

app.put("/api/fin/settings", requireCode, async (req, res, next) => {
  const allowedNums = ["exchangeRate", "startingCash", "unanimValuation", "unanimOwnership", "taxRate"];
  const partial = {};
  for (const key of allowedNums) {
    if (key in (req.body || {})) partial[key] = num(req.body[key]);
  }
  if (Array.isArray((req.body || {}).cogsCategories)) {
    partial.cogsCategories = req.body.cogsCategories.filter(
      (c) => typeof c === "string" && ALLOWED_CATEGORIES.has(c)
    );
  }
  try {
    res.json(await db.saveSettings(req.syncCode, partial));
  } catch (err) {
    next(err);
  }
});

app.get("/healthz", (req, res) => res.send("ok"));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Expenses server listening on port ${PORT}`);
});
