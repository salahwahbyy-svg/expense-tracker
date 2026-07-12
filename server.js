const path = require("path");
const express = require("express");
const { customAlphabet } = require("nanoid");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const generateCode = customAlphabet(CODE_ALPHABET, 7);

// Categories are user-defined per sync code (stored in the categories
// table); the server only validates the id shape.
const CATEGORY_ID_RE = /^[a-z0-9-]{1,24}$/;

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
  const { amount, category, note, date, receipt } = req.body;

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) {
    return res.status(400).json({ error: "invalid_amount" });
  }
  if (typeof category !== "string" || !CATEGORY_ID_RE.test(category)) {
    return res.status(400).json({ error: "invalid_category" });
  }
  if (typeof date !== "string" || !DATE_RE.test(date)) {
    return res.status(400).json({ error: "invalid_date" });
  }
  const safeNote = typeof note === "string" ? note.slice(0, 200) : "";
  const safeReceipt = typeof receipt === "string" ? receipt.slice(0, 40) : "";

  const id = generateCode() + Date.now().toString(36);
  const createdAt = Date.now();
  const expense = { id, amount, category, note: safeNote, date, createdAt, receipt: safeReceipt };

  try {
    await db.addExpense(req.syncCode, expense);
    res.status(201).json(expense);
  } catch (err) {
    next(err);
  }
});

app.put("/api/expenses/:id", requireCode, async (req, res, next) => {
  const { amount, category, note, date, receipt } = req.body;

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) {
    return res.status(400).json({ error: "invalid_amount" });
  }
  if (typeof category !== "string" || !CATEGORY_ID_RE.test(category)) {
    return res.status(400).json({ error: "invalid_category" });
  }
  if (typeof date !== "string" || !DATE_RE.test(date)) {
    return res.status(400).json({ error: "invalid_date" });
  }
  const safeNote = typeof note === "string" ? note.slice(0, 200) : "";
  const safeReceipt = typeof receipt === "string" ? receipt.slice(0, 40) : "";
  const expense = { amount, category, note: safeNote, date, receipt: safeReceipt };

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

// ---------- Expense categories ----------

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function sanitizeCategory(body, partial) {
  const out = {};
  const b = body || {};
  if (!partial || "label" in b) {
    if (typeof b.label !== "string" || !b.label.trim()) return null;
    out.label = b.label.trim().slice(0, 24);
  }
  if (!partial || "emoji" in b) {
    out.emoji = typeof b.emoji === "string" ? b.emoji.slice(0, 8) : "";
  }
  if (!partial || "color" in b) {
    out.color = typeof b.color === "string" && COLOR_RE.test(b.color) ? b.color : "#9494a3";
  }
  if (!partial || "budget" in b) {
    out.budget = Math.max(0, num(b.budget));
  }
  return out;
}

app.get("/api/categories", requireCode, async (req, res, next) => {
  try {
    res.json(await db.getCategories(req.syncCode));
  } catch (err) {
    next(err);
  }
});

app.post("/api/categories", requireCode, async (req, res, next) => {
  const fields = sanitizeCategory(req.body, false);
  if (!fields) return res.status(400).json({ error: "invalid_label" });
  const base = fields.label.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 16) || "cat";
  try {
    const existing = new Set((await db.getCategories(req.syncCode)).map((c) => c.id));
    let id = base;
    let n = 2;
    while (existing.has(id)) id = base + n++;
    res.status(201).json(await db.addCategory(req.syncCode, { id, ...fields }));
  } catch (err) {
    next(err);
  }
});

app.put("/api/categories/:id", requireCode, async (req, res, next) => {
  const fields = sanitizeCategory(req.body, true);
  if (!fields) return res.status(400).json({ error: "invalid_label" });
  try {
    const ok = await db.updateCategory(req.syncCode, req.params.id, fields);
    if (!ok) return res.status(404).json({ error: "not_found" });
    res.json({ id: req.params.id, ...fields });
  } catch (err) {
    next(err);
  }
});

app.delete("/api/categories/:id", requireCode, async (req, res, next) => {
  if (req.params.id === "other") {
    return res.status(400).json({ error: "cannot_delete_other" });
  }
  try {
    const moved = await db.deleteCategory(req.syncCode, req.params.id);
    if (moved === null) return res.status(404).json({ error: "not_found" });
    res.json({ moved });
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

// ---------- Income log ----------
// Mirrors the expense log; entries feed the P&L income side automatically.

function sanitizeIncomeEntry(body) {
  const { amount, category, note, date, receipt } = body || {};
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) {
    return { error: "invalid_amount" };
  }
  // Income categories are user-defined (income_categories table); only the
  // shape is checked here.
  if (typeof category !== "string" || !category.trim() || category.length > 40) {
    return { error: "invalid_category" };
  }
  if (typeof date !== "string" || !DATE_RE.test(date)) {
    return { error: "invalid_date" };
  }
  return {
    amount,
    category,
    note: typeof note === "string" ? note.slice(0, 200) : "",
    date,
    receipt: typeof receipt === "string" ? receipt.slice(0, 40) : "",
  };
}

app.get("/api/incomes", requireCode, async (req, res, next) => {
  try {
    res.json({ incomes: await db.getIncomes(req.syncCode) });
  } catch (err) {
    next(err);
  }
});

app.post("/api/incomes", requireCode, async (req, res, next) => {
  const entry = sanitizeIncomeEntry(req.body);
  if (entry.error) return res.status(400).json({ error: entry.error });
  entry.id = generateCode() + Date.now().toString(36);
  entry.createdAt = Date.now();
  try {
    await db.addIncome(req.syncCode, entry);
    res.status(201).json(entry);
  } catch (err) {
    next(err);
  }
});

app.put("/api/incomes/:id", requireCode, async (req, res, next) => {
  const entry = sanitizeIncomeEntry(req.body);
  if (entry.error) return res.status(400).json({ error: entry.error });
  try {
    const updated = await db.updateIncome(req.syncCode, req.params.id, entry);
    if (!updated) return res.status(404).json({ error: "not_found" });
    res.json({ id: req.params.id, ...entry });
  } catch (err) {
    next(err);
  }
});

app.delete("/api/incomes/:id", requireCode, async (req, res, next) => {
  try {
    const deleted = await db.deleteIncome(req.syncCode, req.params.id);
    if (!deleted) return res.status(404).json({ error: "not_found" });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
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

// Balance-sheet categories are user-defined (bs_categories table); the
// server only checks the shape of the id here.
function sanitizeBsItem(b, partial) {
  const out = pick(b, partial, { name: "name", value: "num" });
  if (!out) return null;
  if (!partial || "category" in b) {
    if (typeof b.category !== "string" || !b.category.trim() || b.category.length > 40) return null;
    out.category = b.category.trim();
  }
  return out;
}

finCrud("assets", {
  get: db.getAssets,
  add: db.addAsset,
  update: db.updateAsset,
  remove: db.deleteAsset,
  sanitize: sanitizeBsItem,
});

finCrud("liabilities", {
  get: db.getLiabilities,
  add: db.addLiability,
  update: db.updateLiability,
  remove: db.deleteLiability,
  sanitize: sanitizeBsItem,
});

// ---------- Balance-sheet category management ----------

const BS_KINDS = ["asset", "liability"];

function bsKind(req) {
  const kind = ((req.query.kind || (req.body && req.body.kind) || "") + "").toLowerCase();
  return BS_KINDS.includes(kind) ? kind : null;
}

app.get("/api/fin/bscats", requireCode, async (req, res, next) => {
  const kind = bsKind(req);
  if (!kind) return res.status(400).json({ error: "invalid_kind" });
  try {
    res.json(await db.getBsCats(req.syncCode, kind));
  } catch (err) {
    next(err);
  }
});

app.post("/api/fin/bscats", requireCode, async (req, res, next) => {
  const kind = bsKind(req);
  if (!kind) return res.status(400).json({ error: "invalid_kind" });
  const b = req.body || {};
  if (typeof b.label !== "string" || !b.label.trim()) return res.status(400).json({ error: "invalid_label" });
  const label = b.label.trim().slice(0, 24);
  try {
    const existing = new Set((await db.getBsCats(req.syncCode, kind)).map((c) => c.id));
    let id = label;
    let n = 2;
    while (existing.has(id)) id = `${label} ${n++}`;
    res.status(201).json(await db.addBsCat(req.syncCode, kind, { id, label }));
  } catch (err) {
    next(err);
  }
});

app.put("/api/fin/bscats/:id", requireCode, async (req, res, next) => {
  const kind = bsKind(req);
  if (!kind) return res.status(400).json({ error: "invalid_kind" });
  if (req.params.id === "Other") return res.status(400).json({ error: "cannot_edit_other" });
  const b = req.body || {};
  if (typeof b.label !== "string" || !b.label.trim()) return res.status(400).json({ error: "invalid_label" });
  try {
    const ok = await db.updateBsCat(req.syncCode, kind, req.params.id, b.label.trim().slice(0, 24));
    if (!ok) return res.status(404).json({ error: "not_found" });
    res.json({ id: req.params.id, label: b.label.trim().slice(0, 24) });
  } catch (err) {
    next(err);
  }
});

app.delete("/api/fin/bscats/:id", requireCode, async (req, res, next) => {
  const kind = bsKind(req);
  if (!kind) return res.status(400).json({ error: "invalid_kind" });
  if (req.params.id === "Other") return res.status(400).json({ error: "cannot_delete_other" });
  try {
    const moved = await db.deleteBsCat(req.syncCode, kind, req.params.id);
    if (moved === null) return res.status(404).json({ error: "not_found" });
    res.json({ moved });
  } catch (err) {
    next(err);
  }
});

// ---------- Accounts payable / receivable ----------
// Open items sit on the Balance Sheet (AR = current asset, AP = current
// liability); setting paid_date moves the cash on the Cash Flow statement.

finCrud("apar", {
  get: db.getApar,
  add: db.addApar,
  update: db.updateApar,
  remove: db.deleteApar,
  sanitize: (b, partial) => {
    const out = pick(b, partial, { name: "name", amount: "num" });
    if (!out) return null;
    if (!partial) {
      if (b.kind !== "ap" && b.kind !== "ar") return null;
      out.kind = b.kind;
    }
    if (!partial || "due_date" in b) {
      if (typeof b.due_date !== "string" || !DATE_RE.test(b.due_date)) {
        if (partial) return null;
        out.due_date = new Date().toISOString().slice(0, 10);
      } else out.due_date = b.due_date;
    }
    if (!partial || "category" in b) {
      if (b.category === undefined || b.category === null) {
        out.category = "";
      } else if (typeof b.category === "string" && b.category.trim().length <= 40) {
        out.category = b.category.trim();
      } else {
        return null;
      }
    }
    // paid_date is deliberately not settable here — paying goes through
    // /pay and /unpay so the linked income/expense entry stays in sync.
    return out;
  },
});

// Marking an AR paid records the revenue as a Business Income entry on the
// income log; paying an AP records a Business expense on the expense log.
// The cash then flows through net income exactly once, and the linked entry
// is removed again if the item is reopened.
app.post("/api/fin/apar/:id/pay", requireCode, async (req, res, next) => {
  try {
    const row = await db.getAparById(req.syncCode, req.params.id);
    if (!row) return res.status(404).json({ error: "not_found" });
    if (row.paid_date) return res.status(400).json({ error: "already_paid" });
    const bodyDate = (req.body || {}).date;
    const date = typeof bodyDate === "string" && DATE_RE.test(bodyDate) ? bodyDate : new Date().toISOString().slice(0, 10);
    const entry = {
      id: generateCode() + Date.now().toString(36),
      amount: Number(row.amount) || 0,
      note: row.name || (row.kind === "ar" ? "Invoice collected" : "Bill paid"),
      date,
      createdAt: Date.now(),
    };
    const rowCategory = typeof row.category === "string" ? row.category.trim() : "";
    if (row.kind === "ar") {
      // Prefer the item's stored category; otherwise prefer the Business
      // Income category, falling back to the permanent Other Income if the
      // user renamed/deleted it.
      let category = rowCategory;
      if (!category) {
        const incCats = await db.getIncCats(req.syncCode);
        category = incCats.some((c) => c.id === "Business Income") ? "Business Income" : "Other Income";
      }
      await db.addIncome(req.syncCode, { ...entry, category });
    } else {
      await db.addExpense(req.syncCode, { ...entry, category: rowCategory || "business" });
    }
    const updated = await db.updateApar(req.syncCode, req.params.id, { paid_date: date, linked_id: entry.id });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

app.post("/api/fin/apar/:id/unpay", requireCode, async (req, res, next) => {
  try {
    const row = await db.getAparById(req.syncCode, req.params.id);
    if (!row) return res.status(404).json({ error: "not_found" });
    if (!row.paid_date) return res.status(400).json({ error: "not_paid" });
    if (row.linked_id) {
      if (row.kind === "ar") await db.deleteIncome(req.syncCode, row.linked_id);
      else await db.deleteExpense(req.syncCode, row.linked_id);
    }
    const updated = await db.updateApar(req.syncCode, req.params.id, { paid_date: null, linked_id: null });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

finCrud("income", {
  get: db.getPnlIncome,
  add: db.addPnlIncome,
  update: db.updatePnlIncome,
  remove: db.deletePnlIncome,
  sanitize: (b, partial) => {
    const out = pick(b, partial, { name: "name", value: "num", month: "month" });
    if (!out) return null;
    if (!partial || "category" in b) {
      if (typeof b.category !== "string" || !b.category.trim() || b.category.length > 40) return null;
      out.category = b.category.trim();
    }
    return out;
  },
});

// ---------- Income category management ----------

app.get("/api/fin/inccats", requireCode, async (req, res, next) => {
  try {
    res.json(await db.getIncCats(req.syncCode));
  } catch (err) {
    next(err);
  }
});

app.post("/api/fin/inccats", requireCode, async (req, res, next) => {
  const b = req.body || {};
  if (typeof b.label !== "string" || !b.label.trim()) return res.status(400).json({ error: "invalid_label" });
  const label = b.label.trim().slice(0, 24);
  const emoji = typeof b.emoji === "string" ? b.emoji.slice(0, 8) : "";
  const color = typeof b.color === "string" && COLOR_RE.test(b.color) ? b.color : "#9494a3";
  try {
    const existing = new Set((await db.getIncCats(req.syncCode)).map((c) => c.id));
    let id = label;
    let n = 2;
    while (existing.has(id)) id = `${label} ${n++}`;
    res.status(201).json(await db.addIncCat(req.syncCode, { id, label, emoji, color }));
  } catch (err) {
    next(err);
  }
});

app.put("/api/fin/inccats/:id", requireCode, async (req, res, next) => {
  const b = req.body || {};
  const fields = {};
  if ("label" in b) {
    if (typeof b.label !== "string" || !b.label.trim()) return res.status(400).json({ error: "invalid_label" });
    fields.label = b.label.trim().slice(0, 24);
  }
  if ("emoji" in b) fields.emoji = typeof b.emoji === "string" ? b.emoji.slice(0, 8) : "";
  if ("color" in b) {
    if (typeof b.color !== "string" || !COLOR_RE.test(b.color)) return res.status(400).json({ error: "invalid_color" });
    fields.color = b.color;
  }
  try {
    const ok = await db.updateIncCat(req.syncCode, req.params.id, fields);
    if (!ok) return res.status(404).json({ error: "not_found" });
    res.json({ id: req.params.id, ...fields });
  } catch (err) {
    next(err);
  }
});

app.delete("/api/fin/inccats/:id", requireCode, async (req, res, next) => {
  if (req.params.id === "Other Income") return res.status(400).json({ error: "cannot_delete_other" });
  try {
    const moved = await db.deleteIncCat(req.syncCode, req.params.id);
    if (moved === null) return res.status(404).json({ error: "not_found" });
    res.json({ moved });
  } catch (err) {
    next(err);
  }
});

// ---------- Depreciation ----------
// Categories carry the straight-line useful life (years); items reference a
// category and depreciate from their purchase date automatically.

const DEP_YEARS_MIN = 1;
const DEP_YEARS_MAX = 50;

function sanitizeDepYears(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= DEP_YEARS_MIN && n <= DEP_YEARS_MAX ? n : null;
}

app.get("/api/fin/depcats", requireCode, async (req, res, next) => {
  try {
    res.json(await db.getDepCats(req.syncCode));
  } catch (err) {
    next(err);
  }
});

app.post("/api/fin/depcats", requireCode, async (req, res, next) => {
  const b = req.body || {};
  if (typeof b.label !== "string" || !b.label.trim()) return res.status(400).json({ error: "invalid_label" });
  const years = sanitizeDepYears(b.years);
  if (!years) return res.status(400).json({ error: "invalid_years" });
  const label = b.label.trim().slice(0, 24);
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 16) || "cat";
  try {
    const existing = new Set((await db.getDepCats(req.syncCode)).map((c) => c.id));
    let id = base;
    let n = 2;
    while (existing.has(id)) id = base + n++;
    res.status(201).json(await db.addDepCat(req.syncCode, { id, label, years }));
  } catch (err) {
    next(err);
  }
});

app.put("/api/fin/depcats/:id", requireCode, async (req, res, next) => {
  const b = req.body || {};
  const fields = {};
  if ("label" in b) {
    if (typeof b.label !== "string" || !b.label.trim()) return res.status(400).json({ error: "invalid_label" });
    fields.label = b.label.trim().slice(0, 24);
  }
  if ("years" in b) {
    const years = sanitizeDepYears(b.years);
    if (!years) return res.status(400).json({ error: "invalid_years" });
    fields.years = years;
  }
  try {
    const ok = await db.updateDepCat(req.syncCode, req.params.id, fields);
    if (!ok) return res.status(404).json({ error: "not_found" });
    res.json({ id: req.params.id, ...fields });
  } catch (err) {
    next(err);
  }
});

app.delete("/api/fin/depcats/:id", requireCode, async (req, res, next) => {
  try {
    const removedItems = await db.deleteDepCat(req.syncCode, req.params.id);
    if (removedItems === null) return res.status(404).json({ error: "not_found" });
    res.json({ removedItems });
  } catch (err) {
    next(err);
  }
});

finCrud("depitems", {
  get: db.getDepItems,
  add: db.addDepItem,
  update: db.updateDepItem,
  remove: db.deleteDepItem,
  sanitize: (b, partial) => {
    const out = pick(b, partial, { name: "name", cost: "num" });
    if (!out) return null;
    if (!partial || "category" in b) {
      if (typeof b.category !== "string" || !CATEGORY_ID_RE.test(b.category)) return null;
      out.category = b.category;
    }
    if (!partial || "date" in b) {
      if (typeof b.date !== "string" || !DATE_RE.test(b.date)) {
        if (partial) return null;
        out.date = new Date().toISOString().slice(0, 10);
      } else out.date = b.date;
    }
    return out;
  },
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
  const allowedNums = ["exchangeRate", "startingCash", "taxRate"];
  const partial = {};
  for (const key of allowedNums) {
    if (key in (req.body || {})) partial[key] = num(req.body[key]);
  }
  if (Array.isArray((req.body || {}).cogsCategories)) {
    partial.cogsCategories = req.body.cogsCategories.filter(
      (c) => typeof c === "string" && CATEGORY_ID_RE.test(c)
    );
  }
  try {
    res.json(await db.saveSettings(req.syncCode, partial));
  } catch (err) {
    next(err);
  }
});

// ---------- Exports ----------

// exceljs/pdfkit add over a second to server boot, so the export module is
// loaded on first use instead of at startup (require caches it after that).
function exportMonth(req) {
  const m = (req.query.month || "").toString();
  return MONTH_RE.test(m) ? m : new Date().toISOString().slice(0, 7);
}

app.get("/api/export/xlsx", requireCode, async (req, res, next) => {
  try {
    const { buildStatementData, buildXlsx } = require("./export");
    const month = exportMonth(req);
    const data = await buildStatementData(req.syncCode, month);
    const wb = await buildXlsx(data);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Financials_${month}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

app.get("/api/export/pdf", requireCode, async (req, res, next) => {
  try {
    const { buildStatementData, buildPdf, PDFDocument } = require("./export");
    const month = exportMonth(req);
    const data = await buildStatementData(req.syncCode, month);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Financials_${month}.pdf"`);
    const doc = new PDFDocument({ margin: 40 });
    doc.pipe(res);
    buildPdf(doc, data);
    doc.end();
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
