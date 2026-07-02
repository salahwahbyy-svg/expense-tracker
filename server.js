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

app.get("/healthz", (req, res) => res.send("ok"));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Expenses server listening on port ${PORT}`);
});
