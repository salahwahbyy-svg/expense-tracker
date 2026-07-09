const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const db = require("./db");
const Dep = require("./depreciation");

// Shared palette so both exports match the app's look.
const COLORS = {
  accent: "6C8BFF",
  headerText: "FFFFFF",
  income: "0F9D6C",
  expense: "D92D20",
  dim: "667085",
  stripe: "F4F6FB",
  section: "E9EDFB",
  text: "1D2433",
};

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function monthLabel(month) {
  const [y, m] = month.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

function assetEffectiveValue(a) {
  if (a.category === "Gold" || a.category === "Silver") {
    return (Number(a.grams) || 0) * (Number(a.price_per_gram) || 0);
  }
  return Number(a.value) || 0;
}

// Assemble everything both export formats need for one month.
async function buildStatementData(code, month) {
  const [expenses, categories, income, incomeLog, assets, liabilities, cf, settings, depCats, depItems] = await Promise.all([
    db.getExpenses(code),
    db.getCategories(code),
    db.getPnlIncome(code),
    db.getIncomes(code),
    db.getAssets(code),
    db.getLiabilities(code),
    db.getCfItems(code),
    db.getSettings(code),
    db.getDepCats(code),
    db.getDepItems(code),
  ]);

  const catById = {};
  categories.forEach((c) => (catById[c.id] = c));
  const catLabel = (id) => (catById[id] ? catById[id].label : id);
  const catColor = (id) => (catById[id] ? String(catById[id].color || "#9494a3").slice(1) : "9494a3");

  const monthExpenses = expenses.filter((e) => e.date.slice(0, 7) === month);
  const expTotals = {};
  monthExpenses.forEach((e) => {
    expTotals[e.category] = (expTotals[e.category] || 0) + (Number(e.amount) || 0);
  });
  const totalExpense = Object.values(expTotals).reduce((s, v) => s + v, 0);

  // Manual P&L income lines plus entries from the income log, as one list.
  const monthIncome = [
    ...income.filter((i) => i.month === month),
    ...incomeLog
      .filter((i) => i.date.slice(0, 7) === month)
      .map((i) => ({ name: i.note || i.category, category: i.category, value: i.amount })),
  ];
  const totalIncome = monthIncome.reduce((s, i) => s + (Number(i.value) || 0), 0);

  // Straight-line depreciation via the shared module (same math the app
  // uses for the P&L, Balance Sheet, and Cash Flow). Computed before asset
  // totals because net book value counts toward Total Assets.
  const yearsByCat = {};
  depCats.forEach((c) => (yearsByCat[c.id] = Number(c.years) || 0));
  const depRows = [];
  const fixedRows = [];
  let depreciation = 0;
  let fixedCost = 0;
  let fixedAccum = 0;
  depItems.forEach((it) => {
    const years = yearsByCat[it.category] || 0;
    const cat = depCats.find((c) => c.id === it.category);
    const dep = Dep.forMonth(it, years, month);
    if (dep > 0) {
      depreciation += dep;
      depRows.push({ name: it.name || (cat ? cat.label : it.category), category: cat ? `${cat.label} · ${years}y` : it.category, value: dep });
    }
    const accum = Dep.accumulated(it, years, month);
    fixedCost += Number(it.cost) || 0;
    fixedAccum += accum;
    fixedRows.push({ name: it.name || (cat ? cat.label : it.category), cost: Number(it.cost) || 0, accum, nbv: Dep.netBookValue(it, years, month) });
  });
  const fixedNbv = fixedCost - fixedAccum;
  const assetPurchases = depItems
    .filter((it) => Dep.purchasedInMonth(it, month))
    .map((it) => ({ name: it.name || "item", value: -(Number(it.cost) || 0) }));

  const unanimValue = (Number(settings.unanimValuation) || 0) * (Number(settings.unanimOwnership) || 0) / 100;
  const totalAssets = assets.reduce((s, a) => s + assetEffectiveValue(a), 0) + unanimValue + fixedNbv;
  const totalLiabilities = liabilities.reduce((s, l) => s + (Number(l.value) || 0), 0);

  const cogsSet = new Set(settings.cogsCategories || []);
  const cogs = Object.entries(expTotals).reduce((s, [id, v]) => s + (cogsSet.has(id) ? v : 0), 0);
  const interest = expTotals.interest && !cogsSet.has("interest") ? expTotals.interest : 0;
  const opex = totalExpense - cogs - interest;
  const grossProfit = totalIncome - cogs;
  const ebitda = grossProfit - opex;
  const ebit = ebitda - depreciation;
  const ebt = ebit - interest;
  const taxRate = Number(settings.taxRate) || 0;
  const tax = ebt > 0 ? ebt * (taxRate / 100) : 0;

  const monthCf = cf.filter((c) => c.month === month);
  // Ending cash mirrors the app: starting cash + manual flows + cash net
  // income from the logs − fixed-asset purchases (depreciation cancels out).
  const priorFlows = cf.filter((c) => c.month <= month).reduce((s, c) => s + (Number(c.value) || 0), 0);
  const priorCashIn =
    income.filter((i) => i.month <= month).reduce((s, i) => s + (Number(i.value) || 0), 0) +
    incomeLog.filter((i) => i.date.slice(0, 7) <= month).reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const priorCashOut = expenses.filter((e) => e.date.slice(0, 7) <= month).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const priorPurchases = depItems
    .filter((it) => String(it.date).slice(0, 7) <= month)
    .reduce((s, it) => s + (Number(it.cost) || 0), 0);

  return {
    month,
    settings,
    categories,
    catLabel,
    catColor,
    expTotals,
    totalExpense,
    monthIncome,
    totalIncome,
    assets,
    liabilities,
    unanimValue,
    totalAssets,
    totalLiabilities,
    netWorth: totalAssets - totalLiabilities,
    depRows,
    depreciation,
    fixedRows,
    fixedCost,
    fixedAccum,
    fixedNbv,
    assetPurchases,
    netIncome: totalIncome - totalExpense - depreciation,
    ratios: { cogs, grossProfit, opex, ebitda, depreciation, ebit, interest, ebt, taxRate, tax, netAfterTax: ebt - tax },
    monthCf,
    endingCash: (Number(settings.startingCash) || 0) + priorFlows + priorCashIn - priorCashOut - priorPurchases,
  };
}

// ---------- Excel ----------

const MONEY_FMT = '"E£"#,##0.00';

function styleSheet(ws) {
  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 20;
  ws.getColumn(3).width = 18;
  ws.views = [{ showGridLines: false }];
}

function titleRow(ws, text, sub) {
  const r = ws.addRow([text, "", sub]);
  r.height = 26;
  r.getCell(1).font = { bold: true, size: 15, color: { argb: COLORS.text } };
  r.getCell(3).font = { size: 11, color: { argb: COLORS.dim } };
  ws.addRow([]);
}

function headerRow(ws, cols) {
  const r = ws.addRow(cols);
  r.height = 20;
  r.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.accent } };
    cell.font = { bold: true, color: { argb: COLORS.headerText }, size: 11 };
    cell.alignment = { vertical: "middle" };
  });
  return r;
}

function dataRow(ws, cols, { stripe, moneyCol = 3, color } = {}) {
  const r = ws.addRow(cols);
  if (stripe) {
    r.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.stripe } };
    });
  }
  if (color) r.getCell(1).font = { color: { argb: color }, bold: true };
  const m = r.getCell(moneyCol);
  m.numFmt = MONEY_FMT;
  return r;
}

function totalRow(ws, label, value, argb) {
  const r = ws.addRow([label, "", value]);
  r.height = 20;
  r.getCell(1).font = { bold: true, size: 12 };
  const v = r.getCell(3);
  v.numFmt = MONEY_FMT;
  v.font = { bold: true, size: 12, color: { argb: argb || COLORS.text } };
  r.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.section } };
  });
  ws.addRow([]);
  return r;
}

async function buildXlsx(data) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Expenses App";
  const label = monthLabel(data.month);

  // Balance Sheet
  const bs = wb.addWorksheet("Balance Sheet");
  styleSheet(bs);
  titleRow(bs, "Balance Sheet", `As of ${label}`);
  headerRow(bs, ["Asset", "Category", "Value"]);
  data.assets.forEach((a, i) =>
    dataRow(bs, [a.name || a.category, a.category, assetEffectiveValue(a)], { stripe: i % 2 === 0 })
  );
  dataRow(bs, ["Unanim.eg equity", "Business", data.unanimValue], { stripe: data.assets.length % 2 === 0 });
  if (data.fixedRows.length > 0) {
    headerRow(bs, ["Fixed Asset", "Accum. Depreciation", "Net Book Value"]);
    data.fixedRows.forEach((f, i) => {
      const r = dataRow(bs, [`${f.name} (cost ${f.cost.toFixed(2)})`, -f.accum, f.nbv], { stripe: i % 2 === 0 });
      r.getCell(2).numFmt = MONEY_FMT;
    });
    totalRow(bs, "Fixed Assets · Net Book Value", data.fixedNbv, COLORS.income);
  }
  totalRow(bs, "Total Assets", data.totalAssets, COLORS.income);
  headerRow(bs, ["Liability", "Category", "Value"]);
  data.liabilities.forEach((l, i) => dataRow(bs, [l.name || l.category, l.category, Number(l.value) || 0], { stripe: i % 2 === 0 }));
  totalRow(bs, "Total Liabilities", data.totalLiabilities, COLORS.expense);
  totalRow(bs, "NET WORTH", data.netWorth, COLORS.accent);

  // P&L
  const pnl = wb.addWorksheet("P&L");
  styleSheet(pnl);
  titleRow(pnl, "Profit & Loss", label);
  headerRow(pnl, ["Income", "Category", "Value"]);
  data.monthIncome.forEach((p, i) => dataRow(pnl, [p.name || p.category, p.category, Number(p.value) || 0], { stripe: i % 2 === 0 }));
  totalRow(pnl, "Total Income", data.totalIncome, COLORS.income);
  headerRow(pnl, ["Expenses (from expense log)", "", "Value"]);
  Object.entries(data.expTotals)
    .sort((a, b) => b[1] - a[1])
    .forEach(([id, v], i) => dataRow(pnl, [data.catLabel(id), "", v], { stripe: i % 2 === 0, color: data.catColor(id) }));
  totalRow(pnl, "Total Expenses", data.totalExpense, COLORS.expense);
  if (data.depRows.length > 0) {
    headerRow(pnl, ["Depreciation", "Category", "Value"]);
    data.depRows.forEach((d, i) => dataRow(pnl, [d.name, d.category, d.value], { stripe: i % 2 === 0 }));
    totalRow(pnl, "Total Depreciation", data.depreciation, COLORS.expense);
  }
  const r = data.ratios;
  headerRow(pnl, ["Ratios", "", "Value"]);
  const pct = (v) => (data.totalIncome > 0 ? ` (${((v / data.totalIncome) * 100).toFixed(1)}%)` : "");
  dataRow(pnl, ["Cost of Sales (COGS)", "", r.cogs], { stripe: true });
  dataRow(pnl, [`Gross Profit${pct(r.grossProfit)}`, "", r.grossProfit], { color: COLORS.income });
  dataRow(pnl, ["Operating Expenses", "", r.opex], { stripe: true });
  dataRow(pnl, [`EBITDA${pct(r.ebitda)}`, "", r.ebitda], { color: COLORS.accent });
  dataRow(pnl, ["Depreciation", "", r.depreciation], { stripe: true });
  dataRow(pnl, [`EBIT${pct(r.ebit)}`, "", r.ebit], { color: COLORS.accent });
  dataRow(pnl, ["Interest", "", r.interest], { stripe: true });
  dataRow(pnl, ["EBT", "", r.ebt]);
  dataRow(pnl, [`Tax @ ${r.taxRate}%`, "", r.tax], { stripe: true });
  totalRow(pnl, "Net Profit After Tax", r.netAfterTax, r.netAfterTax >= 0 ? COLORS.income : COLORS.expense);

  // Cash Flow
  const cf = wb.addWorksheet("Cash Flow");
  styleSheet(cf);
  titleRow(cf, "Cash Flow Statement", label);
  const cfAutos = {
    operating: [
      { name: "Net Profit / Loss (from P&L)", value: data.netIncome },
      { name: "Depreciation add-back (non-cash)", value: data.depreciation },
    ],
    investing: data.assetPurchases.map((p) => ({ name: `Asset purchase — ${p.name}`, value: p.value })),
    financing: [],
  };
  let netCF = 0;
  ["operating", "investing", "financing"].forEach((sec) => {
    headerRow(cf, [sec[0].toUpperCase() + sec.slice(1) + " Activities", "", "Value"]);
    const items = [...cfAutos[sec], ...data.monthCf.filter((c) => c.section === sec)];
    let sub = 0;
    items.forEach((c, i) => {
      sub += Number(c.value) || 0;
      dataRow(cf, [c.name || "(unnamed)", "", Number(c.value) || 0], { stripe: i % 2 === 0 });
    });
    totalRow(cf, "Subtotal", sub, sub >= 0 ? COLORS.income : COLORS.expense);
    netCF += sub;
  });
  totalRow(cf, "Net Cash Flow", netCF, netCF >= 0 ? COLORS.income : COLORS.expense);
  totalRow(cf, "Ending Cash Balance", data.endingCash, COLORS.accent);

  return wb;
}

// ---------- PDF ----------

function pdfMoney(v) {
  const n = Number(v) || 0;
  return (n < 0 ? "-" : "") + "E£" + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function pdfSectionHeader(doc, text) {
  const y = doc.y;
  doc.roundedRect(40, y, 515, 22, 4).fill("#" + COLORS.accent);
  doc.fill("#" + COLORS.headerText).fontSize(11).font("Helvetica-Bold").text(text, 50, y + 6);
  doc.moveDown(0.6);
  doc.fill("#" + COLORS.text).font("Helvetica");
}

function pdfLine(doc, label, value, { color, bold, stripe } = {}) {
  const y = doc.y;
  if (stripe) {
    doc.rect(40, y - 2, 515, 17).fill("#" + COLORS.stripe);
    doc.fill("#" + COLORS.text);
  }
  doc.fontSize(10).font(bold ? "Helvetica-Bold" : "Helvetica");
  doc.fill(color ? "#" + color : "#" + COLORS.text);
  doc.text(label, 50, y, { continued: false, width: 350 });
  doc.text(pdfMoney(value), 400, y, { width: 145, align: "right" });
  doc.fill("#" + COLORS.text);
  doc.moveDown(0.35);
}

function buildPdf(doc, data) {
  const label = monthLabel(data.month);

  doc.fontSize(18).font("Helvetica-Bold").fill("#" + COLORS.text).text("Financial Statements", 40, 40);
  doc.fontSize(11).font("Helvetica").fill("#" + COLORS.dim).text(`Period: ${label}`);
  doc.moveDown(1);

  pdfSectionHeader(doc, "Balance Sheet");
  data.assets.forEach((a, i) => pdfLine(doc, `${a.name || a.category}  (${a.category})`, assetEffectiveValue(a), { stripe: i % 2 === 0 }));
  pdfLine(doc, "Unanim.eg equity", data.unanimValue);
  if (data.fixedRows.length > 0) {
    data.fixedRows.forEach((f, i) =>
      pdfLine(doc, `Fixed asset: ${f.name}  (cost ${pdfMoney(f.cost)} − accum. dep ${pdfMoney(f.accum)})`, f.nbv, { stripe: i % 2 === 0 })
    );
    pdfLine(doc, "Fixed Assets · Net Book Value", data.fixedNbv, { color: COLORS.income, bold: true });
  }
  pdfLine(doc, "Total Assets", data.totalAssets, { color: COLORS.income, bold: true });
  data.liabilities.forEach((l, i) => pdfLine(doc, `${l.name || l.category}  (${l.category})`, Number(l.value) || 0, { stripe: i % 2 === 0 }));
  pdfLine(doc, "Total Liabilities", data.totalLiabilities, { color: COLORS.expense, bold: true });
  pdfLine(doc, "NET WORTH", data.netWorth, { color: COLORS.accent, bold: true });
  doc.moveDown(0.8);

  pdfSectionHeader(doc, "Profit & Loss");
  data.monthIncome.forEach((p, i) => pdfLine(doc, `${p.name || p.category}  (${p.category})`, Number(p.value) || 0, { stripe: i % 2 === 0 }));
  pdfLine(doc, "Total Income", data.totalIncome, { color: COLORS.income, bold: true });
  Object.entries(data.expTotals)
    .sort((a, b) => b[1] - a[1])
    .forEach(([id, v], i) => pdfLine(doc, data.catLabel(id), v, { stripe: i % 2 === 0 }));
  pdfLine(doc, "Total Expenses", data.totalExpense, { color: COLORS.expense, bold: true });
  if (data.depRows.length > 0) {
    data.depRows.forEach((d, i) => pdfLine(doc, `Depreciation: ${d.name}  (${d.category})`, d.value, { stripe: i % 2 === 0 }));
    pdfLine(doc, "Total Depreciation", data.depreciation, { color: COLORS.expense, bold: true });
  }
  doc.moveDown(0.8);

  const r = data.ratios;
  const pct = (v) => (data.totalIncome > 0 ? ` (${((v / data.totalIncome) * 100).toFixed(1)}%)` : "");
  pdfSectionHeader(doc, "Ratios");
  pdfLine(doc, "Cost of Sales (COGS)", r.cogs, { stripe: true });
  pdfLine(doc, `Gross Profit${pct(r.grossProfit)}`, r.grossProfit, { color: COLORS.income, bold: true });
  pdfLine(doc, "Operating Expenses", r.opex, { stripe: true });
  pdfLine(doc, `EBITDA${pct(r.ebitda)}`, r.ebitda, { color: COLORS.accent, bold: true });
  pdfLine(doc, "Depreciation", r.depreciation, { stripe: true });
  pdfLine(doc, `EBIT${pct(r.ebit)}`, r.ebit, { color: COLORS.accent, bold: true });
  pdfLine(doc, "Interest", r.interest, { stripe: true });
  pdfLine(doc, "EBT", r.ebt);
  pdfLine(doc, `Tax @ ${r.taxRate}%`, r.tax, { stripe: true });
  pdfLine(doc, "Net Profit After Tax", r.netAfterTax, { color: r.netAfterTax >= 0 ? COLORS.income : COLORS.expense, bold: true });
  doc.moveDown(0.8);

  pdfSectionHeader(doc, "Cash Flow");
  const pdfCfAutos = {
    operating: [
      { name: "Net Profit / Loss (from P&L)", value: data.netIncome },
      { name: "Depreciation add-back (non-cash)", value: data.depreciation },
    ],
    investing: data.assetPurchases.map((p) => ({ name: `Asset purchase — ${p.name}`, value: p.value })),
    financing: [],
  };
  let netCF = 0;
  ["operating", "investing", "financing"].forEach((sec) => {
    const items = [...pdfCfAutos[sec], ...data.monthCf.filter((c) => c.section === sec)];
    let sub = 0;
    items.forEach((c, i) => {
      sub += Number(c.value) || 0;
      pdfLine(doc, `${sec}: ${c.name || "(unnamed)"}`, Number(c.value) || 0, { stripe: i % 2 === 0 });
    });
    pdfLine(doc, `${sec[0].toUpperCase() + sec.slice(1)} subtotal`, sub, { bold: true });
    netCF += sub;
  });
  pdfLine(doc, "Net Cash Flow", netCF, { color: netCF >= 0 ? COLORS.income : COLORS.expense, bold: true });
  pdfLine(doc, "Ending Cash Balance", data.endingCash, { color: COLORS.accent, bold: true });
}

module.exports = { buildStatementData, buildXlsx, buildPdf, PDFDocument };
