(function () {
  "use strict";

  // Categories are user-editable and load per sync code; these defaults
  // are only the offline/first-paint fallback (they match the server seed).
  const DEFAULT_CATEGORIES = [
    { id: "food", label: "Food", emoji: "🍔", color: "#ff8a5b", budget: 0 },
    { id: "transport", label: "Transport", emoji: "🚗", color: "#5bc0ff", budget: 0 },
    { id: "bills", label: "Bills", emoji: "🧾", color: "#ffd166", budget: 0 },
    { id: "shopping", label: "Shopping", emoji: "🛍️", color: "#c792ff", budget: 0 },
    { id: "entertainment", label: "Fun", emoji: "🎬", color: "#6cf0b8", budget: 0 },
    { id: "business", label: "Business", emoji: "💼", color: "#6c8bff", budget: 0 },
    { id: "interest", label: "Interest", emoji: "🏦", color: "#ff9ecb", budget: 0 },
    { id: "other", label: "Other", emoji: "📦", color: "#9494a3", budget: 0 },
  ];

  const CODE_KEY = "expenses:syncCode";
  const CACHE_PREFIX = "expenses:cache:";
  const CATS_CACHE_PREFIX = "expenses:cats:";
  const INCOME_CACHE_PREFIX = "expenses:incomes:";

  // Income categories are fixed (they match the server's P&L categories);
  // ids are the exact category strings stored on income entries.
  const INCOME_CATS = [
    { id: "Salary", label: "Salary", emoji: "💼", color: "#6cf0b8" },
    { id: "Business Income", label: "Business", emoji: "🏪", color: "#5bc0ff" },
    { id: "Investment Income", label: "Investment", emoji: "📈", color: "#c792ff" },
    { id: "Other Income", label: "Other", emoji: "💰", color: "#ffd166" },
  ];

  function incomeCatById(id) {
    return INCOME_CATS.find((c) => c.id === id) || { id, label: id, emoji: "💰", color: "#9494a3" };
  }

  function currency(n) {
    const v = Number(n) || 0;
    const sign = v < 0 ? "-" : "";
    return sign + "E£" + Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
  }

  function fmtUsd(v, rate) {
    const n = (Number(v) || 0) / (Number(rate) || 1);
    return (n < 0 ? "-" : "") + "$" + Math.abs(Math.round(n)).toLocaleString("en-US");
  }

  function signClass(v) {
    return v > 0 ? "pos" : v < 0 ? "neg" : "";
  }

  // ---- API ----
  async function apiGetNewCode() {
    const res = await fetch("/api/codes", { method: "POST" });
    if (!res.ok) throw new Error("code_request_failed");
    const data = await res.json();
    return data.code;
  }

  async function apiFetchExpenses(code) {
    const res = await fetch(`/api/expenses?code=${encodeURIComponent(code)}`);
    if (!res.ok) throw new Error("fetch_failed");
    const data = await res.json();
    return data.expenses;
  }

  async function apiAddExpense(code, payload) {
    const res = await fetch(`/api/expenses?code=${encodeURIComponent(code)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("add_failed");
    return res.json();
  }

  async function apiUpdateExpense(code, id, payload) {
    const res = await fetch(`/api/expenses/${encodeURIComponent(id)}?code=${encodeURIComponent(code)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("update_failed");
    return res.json();
  }

  async function apiDeleteExpense(code, id) {
    const res = await fetch(`/api/expenses/${encodeURIComponent(id)}?code=${encodeURIComponent(code)}`, {
      method: "DELETE",
    });
    if (!res.ok && res.status !== 404) throw new Error("delete_failed");
  }

  // Income log API — mirrors the expense log endpoints.
  async function apiFetchIncomes(code) {
    const res = await fetch(`/api/incomes?code=${encodeURIComponent(code)}`);
    if (!res.ok) throw new Error("fetch_failed");
    const data = await res.json();
    return data.incomes;
  }

  async function apiAddIncome(code, payload) {
    const res = await fetch(`/api/incomes?code=${encodeURIComponent(code)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("add_failed");
    return res.json();
  }

  async function apiUpdateIncome(code, id, payload) {
    const res = await fetch(`/api/incomes/${encodeURIComponent(id)}?code=${encodeURIComponent(code)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("update_failed");
    return res.json();
  }

  async function apiDeleteIncome(code, id) {
    const res = await fetch(`/api/incomes/${encodeURIComponent(id)}?code=${encodeURIComponent(code)}`, {
      method: "DELETE",
    });
    if (!res.ok && res.status !== 404) throw new Error("delete_failed");
  }

  // Financial-statement API (assets, liabilities, income, cashflow, settings…)
  async function finApi(path, opts) {
    const sep = path.includes("?") ? "&" : "?";
    const res = await fetch(`/api/fin/${path}${sep}code=${encodeURIComponent(syncCode)}`, {
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    if (!res.ok) throw new Error("fin_api_failed");
    if (res.status === 204) return null;
    return res.json();
  }

  // ---- local cache (instant paint + offline fallback) ----
  function readCache(code) {
    try {
      return JSON.parse(localStorage.getItem(CACHE_PREFIX + code)) || [];
    } catch {
      return [];
    }
  }

  function writeCache(code, list) {
    localStorage.setItem(CACHE_PREFIX + code, JSON.stringify(list));
  }

  function readIncomeCache(code) {
    try {
      return JSON.parse(localStorage.getItem(INCOME_CACHE_PREFIX + code)) || [];
    } catch {
      return [];
    }
  }

  function writeIncomeCache(code, list) {
    localStorage.setItem(INCOME_CACHE_PREFIX + code, JSON.stringify(list));
  }

  let syncCode = localStorage.getItem(CODE_KEY) || "";
  let expenses = syncCode ? readCache(syncCode) : [];
  let incomes = syncCode ? readIncomeCache(syncCode) : [];

  // ---- expense categories (dynamic) ----
  function readCatsCache(code) {
    try {
      const cached = JSON.parse(localStorage.getItem(CATS_CACHE_PREFIX + code));
      return Array.isArray(cached) && cached.length > 0 ? cached : null;
    } catch {
      return null;
    }
  }

  let cats = (syncCode && readCatsCache(syncCode)) || DEFAULT_CATEGORIES;

  function catById(id) {
    return cats.find((c) => c.id === id) || { id, label: id, emoji: "📦", color: "#9494a3", budget: 0 };
  }

  async function catsApi(path, opts) {
    const sep = path.includes("?") ? "&" : "?";
    const res = await fetch(`/api/categories${path}${sep}code=${encodeURIComponent(syncCode)}`, {
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    if (!res.ok) throw new Error("cats_api_failed");
    return res.json();
  }

  async function loadCats() {
    try {
      cats = await catsApi("");
      localStorage.setItem(CATS_CACHE_PREFIX + syncCode, JSON.stringify(cats));
    } catch {
      cats = readCatsCache(syncCode) || DEFAULT_CATEGORIES;
    }
  }
  let viewDate = new Date();
  viewDate.setDate(1);
  let selectedCategory = null;
  let activeTab = "expenses";

  const METALS = new Set(["Gold", "Silver"]);
  const isMetal = (cat) => METALS.has(cat);

  const fin = {
    loaded: false,
    failed: false,
    settings: { exchangeRate: 47.5, startingCash: 0, unanimValuation: 0, unanimOwnership: 0, taxRate: 0, cogsCategories: [] },
    cats: { assetCategories: [], liabilityCategories: [], incomeCategories: [], cfSections: [] },
    assets: [],
    liabilities: [],
    income: [],
    cf: [],
    history: [],
    pnlView: "monthly",
    cfView: "monthly",
  };

  const appRoot = document.getElementById("appRoot");
  const monthLabel = document.getElementById("monthLabel");
  const monthTotalEl = document.getElementById("monthTotal");
  const barsEl = document.getElementById("bars");
  const chartCard = document.getElementById("chartCard");
  const listEl = document.getElementById("expenseList");
  const emptyState = document.getElementById("emptyState");
  const sheetOverlay = document.getElementById("sheetOverlay");
  const categoryGrid = document.getElementById("categoryGrid");
  const amountInput = document.getElementById("amountInput");
  const noteInput = document.getElementById("noteInput");
  const dateInput = document.getElementById("dateInput");
  const saveBtn = document.getElementById("saveBtn");
  const finView = document.getElementById("view-fin");
  const expView = document.getElementById("view-expenses");

  const finSheetOverlay = document.getElementById("finSheetOverlay");
  const finSheetTitle = document.getElementById("finSheetTitle");
  const finSheetFields = document.getElementById("finSheetFields");
  const finSaveBtn = document.getElementById("finSaveBtn");

  const syncBadge = document.getElementById("syncBadge");
  const syncDot = document.getElementById("syncDot");
  const syncBadgeLabel = document.getElementById("syncBadgeLabel");
  const syncOverlay = document.getElementById("syncOverlay");
  const codeDisplay = document.getElementById("codeDisplay");
  const copyCodeBtn = document.getElementById("copyCodeBtn");
  const joinCodeInput = document.getElementById("joinCodeInput");

  const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  function monthStr(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }

  function setSyncStatus(status) {
    syncDot.className = "sync-dot " + status;
    syncBadgeLabel.textContent =
      status === "online" ? `Synced · ${syncCode}` : status === "offline" ? "Offline · showing cached data" : "Syncing…";
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function escAttr(str) {
    return escapeHtml(str).replace(/"/g, "&quot;");
  }

  // ================= EXPENSES TAB =================

  function expensesForMonth(d) {
    return expenses.filter((e) => {
      const ed = new Date(e.date + "T00:00:00");
      return ed.getFullYear() === d.getFullYear() && ed.getMonth() === d.getMonth();
    });
  }

  // Shared chip-grid renderer used by the expense sheet, the financial add
  // sheet, and the P&L COGS toggles. Options are either category objects
  // ({id,label,emoji}) or plain strings.
  function renderChipGrid(container, options, isSelected, onSelect) {
    container.innerHTML = "";
    options.forEach((opt) => {
      const label = typeof opt === "string" ? opt : opt.label;
      const emoji = typeof opt === "string" ? "" : opt.emoji;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "category-chip" + (isSelected(opt) ? " selected" : "");
      chip.innerHTML = (emoji ? `<span class="chip-emoji">${emoji}</span>` : "") + `<span>${escapeHtml(label)}</span>`;
      chip.addEventListener("click", () => onSelect(opt));
      container.appendChild(chip);
    });
  }

  function renderCategoryGrid() {
    renderChipGrid(
      categoryGrid,
      cats,
      (cat) => selectedCategory === cat.id,
      (cat) => {
        selectedCategory = cat.id;
        renderCategoryGrid();
      }
    );
  }

  function renderMonthLabel() {
    monthLabel.textContent = `${MONTH_NAMES[viewDate.getMonth()]} ${viewDate.getFullYear()}`;
  }

  function renderTotal(list) {
    const total = list.reduce((sum, e) => sum + e.amount, 0);
    monthTotalEl.textContent = currency(total);
  }

  function renderChart(list) {
    const totalsByCat = {};
    let grandTotal = 0;
    list.forEach((e) => {
      totalsByCat[e.category] = (totalsByCat[e.category] || 0) + e.amount;
      grandTotal += e.amount;
    });

    // Show every category with spend this month, plus budgeted ones even
    // at zero spend so budget progress is visible from day one.
    const ids = new Set(Object.keys(totalsByCat));
    cats.forEach((c) => {
      if (Number(c.budget) > 0) ids.add(c.id);
    });
    const active = [...ids].map(catById)
      .sort((a, b) => (totalsByCat[b.id] || 0) - (totalsByCat[a.id] || 0));

    if (active.length === 0) {
      chartCard.classList.add("hidden");
      return;
    }
    chartCard.classList.remove("hidden");

    barsEl.innerHTML = "";
    active.forEach((cat) => {
      const amount = totalsByCat[cat.id] || 0;
      const budget = Number(cat.budget) || 0;
      let pct, amountHtml, over = false;
      if (budget > 0) {
        pct = Math.min(100, (amount / budget) * 100);
        over = amount > budget;
        amountHtml = `${currency(amount)} <span class="bar-budget">/ ${currency(budget)}</span>`;
      } else {
        pct = grandTotal > 0 ? (amount / grandTotal) * 100 : 0;
        amountHtml = currency(amount);
      }
      const fill = over ? "var(--danger)" : cat.color;
      const row = document.createElement("div");
      row.className = "bar-row";
      row.innerHTML = `
        <span class="bar-dot" style="background:${cat.color}"></span>
        <span class="bar-label">${escapeHtml(cat.label)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${pct}%;background:${fill}"></span></span>
        <span class="bar-amount ${over ? "neg" : ""}">${amountHtml}</span>
      `;
      barsEl.appendChild(row);
    });
  }

  function formatDayHeading(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const sameDay = (a, b) => a.toDateString() === b.toDateString();
    if (sameDay(d, today)) return "Today";
    if (sameDay(d, yesterday)) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  }

  let touchState = null;

  function renderList(list) {
    listEl.innerHTML = "";

    if (list.length === 0) {
      emptyState.style.display = "flex";
      return;
    }
    emptyState.style.display = "none";

    const sorted = [...list].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));
    const groups = new Map();
    sorted.forEach((e) => {
      if (!groups.has(e.date)) groups.set(e.date, []);
      groups.get(e.date).push(e);
    });

    groups.forEach((items, date) => {
      const group = document.createElement("div");
      group.className = "day-group";

      const dayTotal = items.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
      const heading = document.createElement("div");
      heading.className = "day-heading";
      heading.innerHTML = `<span>${escapeHtml(formatDayHeading(date))}</span><span class="day-total">${currency(dayTotal)}</span>`;
      group.appendChild(heading);

      items.forEach((e) => {
        const cat = catById(e.category);
        const item = document.createElement("div");
        item.className = "expense-item";
        item.dataset.id = e.id;
        item.innerHTML = `
          <button class="delete-btn">Delete</button>
          <div class="swipe-content">
            <div class="expense-icon" style="background:${escAttr(cat.color)}22;color:${escAttr(cat.color)}">${escapeHtml(cat.emoji)}</div>
            <div class="expense-meta">
              <div class="expense-category">${escapeHtml(cat.label)}</div>
              ${e.note ? `<div class="expense-note">${escapeHtml(e.note)}</div>` : ""}
            </div>
            <div class="expense-amount">${currency(e.amount)}</div>
          </div>
        `;

        async function performDelete() {
          const prev = expenses;
          expenses = expenses.filter((x) => x.id !== e.id);
          writeCache(syncCode, expenses);
          renderAll();
          try {
            await apiDeleteExpense(syncCode, e.id);
          } catch {
            expenses = prev;
            writeCache(syncCode, expenses);
            renderAll();
            setSyncStatus("offline");
            alert("Couldn't delete — check your connection and try again.");
          }
        }

        const content = item.querySelector(".swipe-content");
        content.addEventListener("touchstart", (ev) => {
          touchState = { id: e.id, startX: ev.touches[0].clientX };
        }, { passive: true });

        content.addEventListener("touchmove", (ev) => {
          if (!touchState || touchState.id !== e.id) return;
          const dx = ev.touches[0].clientX - touchState.startX;
          if (dx < -20) item.classList.add("swiped");
          else if (dx > 20) item.classList.remove("swiped");
        }, { passive: true });

        // Tap an expense to edit it; delete lives inside the edit sheet
        // (and the swipe-to-delete shortcut still works).
        content.addEventListener("click", () => {
          if (item.classList.contains("swiped")) {
            item.classList.remove("swiped");
            return;
          }
          openSheet(e);
        });

        item.querySelector(".delete-btn").addEventListener("click", performDelete);

        group.appendChild(item);
      });

      listEl.appendChild(group);
    });
  }

  function renderExpensesTab() {
    const list = expensesForMonth(viewDate);
    renderTotal(list);
    renderChart(list);
    renderList(list);
  }

  // ================= INCOME TAB =================

  function incomesForMonth(d) {
    return incomes.filter((e) => {
      const ed = new Date(e.date + "T00:00:00");
      return ed.getFullYear() === d.getFullYear() && ed.getMonth() === d.getMonth();
    });
  }

  function renderIncome() {
    const list = incomesForMonth(viewDate);
    const total = list.reduce((s, e) => s + (Number(e.amount) || 0), 0);

    const totalsByCat = {};
    list.forEach((e) => {
      totalsByCat[e.category] = (totalsByCat[e.category] || 0) + (Number(e.amount) || 0);
    });
    const bars = Object.entries(totalsByCat)
      .sort((a, b) => b[1] - a[1])
      .map(([id, v]) => {
        const cat = incomeCatById(id);
        const pct = total > 0 ? (v / total) * 100 : 0;
        return `
          <div class="bar-row">
            <span class="bar-dot" style="background:${escAttr(cat.color)}"></span>
            <span class="bar-label">${escapeHtml(cat.label)}</span>
            <span class="bar-track"><span class="bar-fill" style="width:${pct}%;background:${escAttr(cat.color)}"></span></span>
            <span class="bar-amount">${currency(v)}</span>
          </div>`;
      })
      .join("");

    const sorted = [...list].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));
    const groups = new Map();
    sorted.forEach((e) => {
      if (!groups.has(e.date)) groups.set(e.date, []);
      groups.get(e.date).push(e);
    });
    let listHtml = "";
    groups.forEach((items, date) => {
      const dayTotal = items.reduce((s, e) => s + (Number(e.amount) || 0), 0);
      const rows = items
        .map((e) => {
          const cat = incomeCatById(e.category);
          return `
            <div class="expense-item income-item" data-id="${escAttr(e.id)}">
              <div class="swipe-content">
                <div class="expense-icon" style="background:${escAttr(cat.color)}22;color:${escAttr(cat.color)}">${escapeHtml(cat.emoji)}</div>
                <div class="expense-meta">
                  <div class="expense-category">${escapeHtml(cat.label)}</div>
                  ${e.note ? `<div class="expense-note">${escapeHtml(e.note)}</div>` : ""}
                </div>
                <div class="expense-amount pos">+${currency(e.amount)}</div>
              </div>
            </div>`;
        })
        .join("");
      listHtml += `
        <div class="day-group">
          <div class="day-heading"><span>${escapeHtml(formatDayHeading(date))}</span><span class="day-total">${currency(dayTotal)}</span></div>
          ${rows}
        </div>`;
    });

    return `
      <section class="totals">
        <div class="total-amount pos">${currency(total)}</div>
        <div class="total-sub">earned this month</div>
      </section>
      ${bars ? `<section class="chart-card"><div class="chart-title"><span>By category</span></div><div class="bars">${bars}</div></section>` : ""}
      <section class="list-section">
        ${listHtml || '<div class="empty-state" style="display:flex;"><div class="empty-emoji">💰</div><div>No income yet this month</div></div>'}
      </section>
    `;
  }

  function wireIncome() {
    finView.querySelectorAll(".income-item").forEach((el) => {
      el.addEventListener("click", () => {
        const entry = incomes.find((x) => x.id === el.dataset.id);
        if (entry) openIncomeSheet(entry);
      });
    });
  }

  function openIncomeSheet(entry) {
    openFinSheet({
      title: entry ? "Edit income" : "Add income",
      chips: { label: "Category", options: INCOME_CATS, selected: entry ? incomeCatById(entry.category) : null },
      fields: [
        { key: "amount", label: "Amount (E£)", type: "num", placeholder: "0", value: entry ? entry.amount : "" },
        { key: "note", label: "Note (optional)", placeholder: "e.g. July salary", value: entry ? entry.note || "" : "" },
        { key: "date", label: "Date", type: "date", value: entry ? entry.date : todayStr() },
      ],
      onSave: async (cat, values) => {
        if (!values.amount || values.amount <= 0) throw new Error("invalid_amount");
        const payload = { amount: values.amount, category: cat.id, note: values.note, date: values.date };
        if (entry) {
          const updated = await apiUpdateIncome(syncCode, entry.id, payload);
          incomes = incomes.map((x) => (x.id === entry.id ? { ...x, ...updated } : x));
        } else {
          const created = await apiAddIncome(syncCode, payload);
          incomes.push(created);
        }
        writeIncomeCache(syncCode, incomes);
      },
      onDelete: entry
        ? async () => {
            const label = `${currency(entry.amount)}${entry.note ? " · " + entry.note : ""}`;
            if (!confirm(`Delete this income?\n${label}`)) return false;
            await apiDeleteIncome(syncCode, entry.id);
            incomes = incomes.filter((x) => x.id !== entry.id);
            writeIncomeCache(syncCode, incomes);
          }
        : null,
    });
  }

  // ================= FINANCIAL STATEMENTS =================

  async function loadFin() {
    if (!syncCode) return;
    try {
      const [cats, settings, assets, liabilities, income, cf, history] = await Promise.all([
        finApi("categories"),
        finApi("settings"),
        finApi("assets"),
        finApi("liabilities"),
        finApi("income"),
        finApi("cashflow"),
        finApi("networth"),
      ]);
      fin.cats = cats;
      fin.settings = settings;
      fin.assets = assets;
      fin.liabilities = liabilities;
      fin.income = income;
      fin.cf = cf;
      fin.history = history;
      fin.loaded = true;
      fin.failed = false;
    } catch {
      fin.failed = true;
    }
  }

  async function reloadFin(name) {
    try {
      const data = await finApi(name);
      if (name === "assets") fin.assets = data;
      else if (name === "liabilities") fin.liabilities = data;
      else if (name === "income") fin.income = data;
      else if (name === "cashflow") fin.cf = data;
    } catch {
      /* keep stale data */
    }
  }

  function assetEffectiveValue(a) {
    if (isMetal(a.category)) {
      return (Number(a.grams) || 0) * (Number(a.price_per_gram) || 0);
    }
    return Number(a.value) || 0;
  }

  function computeNetWorth() {
    const s = fin.settings;
    const unanimValue = (Number(s.unanimValuation) || 0) * (Number(s.unanimOwnership) || 0) / 100;
    const totalAssets = fin.assets.reduce((sum, a) => sum + assetEffectiveValue(a), 0) + unanimValue;
    const totalLiabilities = fin.liabilities.reduce((sum, l) => sum + (Number(l.value) || 0), 0);
    return { totalAssets, totalLiabilities, unanimValue, netWorth: totalAssets - totalLiabilities };
  }

  // Expense log rolled up by month — this is what feeds the P&L expense side.
  function expenseTotalForMonth(m) {
    return expenses
      .filter((e) => e.date.slice(0, 7) === m)
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  }

  function expenseTotalsByCategory(filterFn) {
    const totals = {};
    expenses.filter(filterFn).forEach((e) => {
      totals[e.category] = (totals[e.category] || 0) + (Number(e.amount) || 0);
    });
    return totals;
  }

  function incomeTotalForMonth(m) {
    const manual = fin.income
      .filter((i) => i.month === m)
      .reduce((sum, i) => sum + (Number(i.value) || 0), 0);
    const logged = incomes
      .filter((i) => i.date.slice(0, 7) === m)
      .reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
    return manual + logged;
  }

  function endingCashBalance(uptoMonth) {
    const flows = fin.cf
      .filter((c) => c.month <= uptoMonth)
      .reduce((sum, c) => sum + (Number(c.value) || 0), 0);
    return (Number(fin.settings.startingCash) || 0) + flows;
  }

  // Re-render the fin view without destroying an input the user is still
  // typing in: if focus is inside the view, wait for it to leave first.
  function scheduleFinRender() {
    const active = document.activeElement;
    if (active && active.tagName === "INPUT" && finView.contains(active)) {
      active.addEventListener("blur", () => renderFin(), { once: true });
    } else {
      renderFin();
    }
  }

  async function saveFinSettings(partial) {
    Object.assign(fin.settings, partial);
    scheduleFinRender();
    try {
      fin.settings = await finApi("settings", { method: "PUT", body: JSON.stringify(partial) });
    } catch {
      /* keep optimistic value */
    }
  }

  // ---------- fin add-item sheet ----------
  let finSheetConfig = null;
  let finSheetChip = null;

  function openFinSheet(config) {
    finSheetConfig = config;
    finSheetChip = config.chips ? config.chips.selected || config.chips.options[0] : null;
    finSheetTitle.textContent = config.title;
    renderFinSheetFields();
    finDeleteBtn.style.display = config.onDelete ? "block" : "none";
    finSheetOverlay.classList.add("open");
  }

  function closeFinSheet() {
    finSheetOverlay.classList.remove("open");
    finSheetConfig = null;
  }

  function renderFinSheetFields() {
    const cfg = finSheetConfig;
    let html = "";
    if (cfg.chips) {
      html += `<div class="field"><label>${escapeHtml(cfg.chips.label)}</label><div class="category-grid" id="finChipGrid"></div></div>`;
    }
    const fields = typeof cfg.fields === "function" ? cfg.fields(finSheetChip) : cfg.fields;
    fields.forEach((f) => {
      const type = f.type === "num" ? "number" : f.type === "date" ? "date" : "text";
      const extra = f.type === "num" ? 'inputmode="decimal" step="0.01"' : f.type === "date" ? "" : 'maxlength="60"';
      html += `
        <div class="field">
          <label>${escapeHtml(f.label)}</label>
          <input id="finField_${f.key}" type="${type}" ${extra}
            value="${escAttr(f.value ?? "")}" placeholder="${escAttr(f.placeholder || "")}" />
        </div>`;
    });
    finSheetFields.innerHTML = html;

    if (cfg.chips) {
      renderChipGrid(
        document.getElementById("finChipGrid"),
        cfg.chips.options,
        (opt) => opt === finSheetChip,
        (opt) => {
          finSheetChip = opt;
          renderFinSheetFields();
        }
      );
    }
  }

  finSaveBtn.addEventListener("click", async () => {
    if (!finSheetConfig) return;
    const cfg = finSheetConfig;
    const fields = typeof cfg.fields === "function" ? cfg.fields(finSheetChip) : cfg.fields;
    const values = {};
    for (const f of fields) {
      const el = document.getElementById("finField_" + f.key);
      values[f.key] = f.type === "num" ? Number(el.value) || 0 : f.type === "date" ? el.value || todayStr() : el.value.trim();
    }
    finSaveBtn.disabled = true;
    try {
      await cfg.onSave(finSheetChip, values);
      closeFinSheet();
      renderFin();
    } catch {
      alert("Couldn't save — check your connection and try again.");
    } finally {
      finSaveBtn.disabled = false;
    }
  });

  document.getElementById("finCancelBtn").addEventListener("click", closeFinSheet);
  finSheetOverlay.addEventListener("click", (e) => {
    if (e.target === finSheetOverlay) closeFinSheet();
  });

  const finDeleteBtn = document.getElementById("finDeleteBtn");
  finDeleteBtn.addEventListener("click", async () => {
    if (!finSheetConfig || !finSheetConfig.onDelete) return;
    try {
      // onDelete returns false when the user cancels its confirm dialog.
      if ((await finSheetConfig.onDelete()) === false) return;
      closeFinSheet();
      renderFin();
    } catch {
      alert("Couldn't delete — check your connection and try again.");
    }
  });

  // ---------- fin row helpers ----------
  function finRowHtml(row, opts) {
    const fields = opts.fields
      .map((f) => {
        if (f.type === "label") return `<span class="row-amount">${currency(f.value)}</span>`;
        return `<input class="${f.cls}" data-field="${f.key}" type="${f.num ? "number" : "text"}"
          ${f.num ? 'inputmode="decimal" step="0.01"' : ""}
          value="${escAttr(row[f.key] ?? "")}" placeholder="${escAttr(f.placeholder || "")}" />`;
      })
      .join("");
    return `<div class="fin-row" data-id="${escAttr(row.id)}">${fields}<button class="row-del">✕</button></div>`;
  }

  function wireFinRows(container, entity, numericFields, reloadName) {
    container.querySelectorAll(".fin-row[data-id]").forEach((rowEl) => {
      const id = rowEl.dataset.id;
      rowEl.querySelectorAll("input[data-field]").forEach((input) => {
        input.addEventListener("change", async () => {
          const field = input.dataset.field;
          const value = numericFields.includes(field) ? Number(input.value) || 0 : input.value;
          try {
            await finApi(`${entity}/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ [field]: value }) });
            await reloadFin(reloadName);
          } catch {
            alert("Couldn't save the change — check your connection.");
          }
          scheduleFinRender();
        });
      });
      const delBtn = rowEl.querySelector(".row-del");
      if (delBtn) {
        delBtn.addEventListener("click", async () => {
          if (!confirm("Delete this item?")) return;
          try {
            await finApi(`${entity}/${encodeURIComponent(id)}`, { method: "DELETE" });
            await reloadFin(reloadName);
          } catch {
            alert("Couldn't delete — check your connection.");
          }
          renderFin();
        });
      }
    });
  }

  function exportRowHtml() {
    const q = `code=${encodeURIComponent(syncCode)}&month=${monthStr(viewDate)}`;
    return `
      <div class="toggle-row">
        <a class="btn-toggle export-link" href="/api/export/xlsx?${q}">⬇ Excel</a>
        <a class="btn-toggle export-link" href="/api/export/pdf?${q}">⬇ PDF</a>
      </div>`;
  }

  // ---------- OVERVIEW ----------
  function renderOverview() {
    const nw = computeNetWorth();
    const m = monthStr(viewDate);
    const year = viewDate.getFullYear();
    const rate = fin.settings.exchangeRate;
    const income = incomeTotalForMonth(m);
    const spent = expenseTotalForMonth(m);
    const netPL = income - spent;
    const cash = endingCashBalance(m);

    // 12-month income vs expense bars
    let maxBar = 1;
    const months = [];
    for (let i = 0; i < 12; i++) {
      const key = year + "-" + String(i + 1).padStart(2, "0");
      const inc = incomeTotalForMonth(key);
      const exp = expenseTotalForMonth(key);
      maxBar = Math.max(maxBar, inc, exp);
      months.push({ label: MONTH_SHORT[i], inc, exp });
    }
    const barH = 110;
    const bars = months
      .map((mo, i) => {
        const x = i * 29;
        const incH = (mo.inc / maxBar) * barH;
        const expH = (mo.exp / maxBar) * barH;
        return `
          <rect x="${x}" y="${barH - incH}" width="10" height="${incH}" fill="#6cf0b8" rx="2"></rect>
          <rect x="${x + 11}" y="${barH - expH}" width="10" height="${expH}" fill="#ff6b6b" rx="2"></rect>
          <text x="${x + 10}" y="${barH + 14}" font-size="8" fill="#9494a3" text-anchor="middle">${mo.label}</text>`;
      })
      .join("");

    // net worth trend
    const history = [...fin.history].sort((a, b) => (a.month < b.month ? -1 : 1));
    let trendHtml = `<div class="fin-note">No snapshots yet. Tap "+ Snapshot" to record this month's net worth and build your trend over time.</div>`;
    if (history.length > 0) {
      const vals = history.map((h) => Number(h.value) || 0);
      const minV = Math.min(...vals, 0);
      const maxV = Math.max(...vals, 1);
      const range = maxV - minV || 1;
      const w = 340;
      const h = 100;
      const step = history.length > 1 ? w / (history.length - 1) : 0;
      const dots = history.map((pt, i) => {
        const x = history.length > 1 ? i * step : w / 2;
        const y = h - ((Number(pt.value) - minV) / range) * h;
        return { x, y, month: pt.month, value: Number(pt.value) };
      });
      const points = dots.map((d) => `${d.x},${d.y}`).join(" ");
      trendHtml = `
        <svg width="100%" height="110" viewBox="0 0 340 110" style="overflow:visible;">
          <polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="2.5"></polyline>
          ${dots.map((d) => `<circle cx="${d.x}" cy="${d.y}" r="3.5" fill="var(--accent)"></circle>`).join("")}
        </svg>
        <div class="chip-list">
          ${dots.map((d) => `<span class="chip-item">${escapeHtml(d.month)}: ${currency(d.value)}</span>`).join("")}
        </div>`;
    }

    return `
      <div class="stat-grid">
        <div class="stat-card wide">
          <div class="stat-label">Net Worth</div>
          <div class="stat-value ${signClass(nw.netWorth)}">${currency(nw.netWorth)}</div>
          <div class="stat-sub">${fmtUsd(nw.netWorth, rate)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Assets</div>
          <div class="stat-value">${currency(nw.totalAssets)}</div>
          <div class="stat-sub">${fmtUsd(nw.totalAssets, rate)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Liabilities</div>
          <div class="stat-value">${currency(nw.totalLiabilities)}</div>
          <div class="stat-sub">${fmtUsd(nw.totalLiabilities, rate)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Net P&L · ${MONTH_SHORT[viewDate.getMonth()]}</div>
          <div class="stat-value ${signClass(netPL)}">${currency(netPL)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Ending Cash</div>
          <div class="stat-value ${signClass(cash)}">${currency(cash)}</div>
        </div>
      </div>

      <div class="fin-card">
        <div class="setting-row">
          <label>Exchange rate — 1 USD =</label>
          <input id="rateInput" type="number" inputmode="decimal" step="0.01" value="${escAttr(fin.settings.exchangeRate)}" />
        </div>
      </div>

      <div class="fin-card">
        <div class="fin-card-title">Income vs Expense · ${year}</div>
        <svg width="100%" height="128" viewBox="0 0 348 128" style="overflow:visible;">${bars}</svg>
        <div class="fin-note"><span style="color:var(--entertainment)">■</span> Income &nbsp; <span style="color:var(--danger)">■</span> Expenses (from your income &amp; expense logs)</div>
      </div>

      <div class="fin-card">
        <div class="fin-card-title">Net Worth Trend <button class="snapshot-btn" id="snapshotBtn">+ Snapshot</button></div>
        ${trendHtml}
      </div>
    `;
  }

  function wireOverview() {
    document.getElementById("rateInput").addEventListener("change", (e) => {
      saveFinSettings({ exchangeRate: Number(e.target.value) || 47.5 });
    });
    document.getElementById("snapshotBtn").addEventListener("click", async () => {
      const nw = computeNetWorth();
      try {
        fin.history = await finApi("networth/snapshot", {
          method: "POST",
          body: JSON.stringify({ month: monthStr(viewDate), value: nw.netWorth }),
        });
      } catch {
        alert("Couldn't save snapshot — check your connection.");
      }
      renderFin();
    });
  }

  // ---------- BALANCE SHEET ----------
  function renderBalance() {
    const nw = computeNetWorth();
    const rate = fin.settings.exchangeRate;

    const assetSections = fin.cats.assetCategories
      .map((cat) => {
        const items = fin.assets.filter((a) => a.category === cat);
        if (items.length === 0) return "";
        const subtotal = items.reduce((s, a) => s + assetEffectiveValue(a), 0);
        const rows = items
          .map((a) =>
            finRowHtml(a, {
              fields: isMetal(cat)
                ? [
                    { key: "name", cls: "f-name", placeholder: "Name" },
                    { key: "grams", cls: "f-num", num: true, placeholder: "Grams" },
                    { key: "price_per_gram", cls: "f-num", num: true, placeholder: "E£/g" },
                    { type: "label", value: assetEffectiveValue(a) },
                  ]
                : [
                    { key: "name", cls: "f-name", placeholder: "Name" },
                    { key: "value", cls: "f-num", num: true, placeholder: "Value" },
                  ],
            })
          )
          .join("");
        return `<div class="fin-section"><div class="fin-section-heading"><span>${escapeHtml(cat)}</span><span class="subtotal">${currency(subtotal)}</span></div>${rows}</div>`;
      })
      .join("");

    const liabSections = fin.cats.liabilityCategories
      .map((cat) => {
        const items = fin.liabilities.filter((l) => l.category === cat);
        if (items.length === 0) return "";
        const subtotal = items.reduce((s, l) => s + (Number(l.value) || 0), 0);
        const rows = items
          .map((l) =>
            finRowHtml(l, {
              fields: [
                { key: "name", cls: "f-name", placeholder: "Name" },
                { key: "value", cls: "f-num", num: true, placeholder: "Value" },
              ],
            })
          )
          .join("");
        return `<div class="fin-section"><div class="fin-section-heading"><span>${escapeHtml(cat)}</span><span class="subtotal">${currency(subtotal)}</span></div>${rows}</div>`;
      })
      .join("");

    return `
      ${exportRowHtml()}
      <div class="fin-card" id="assetsCard">
        <div class="fin-card-title">Assets</div>
        ${assetSections || '<div class="fin-note">No assets yet.</div>'}
        <div class="fin-section">
          <div class="fin-section-heading"><span>Business — Unanim.eg</span><span class="subtotal">${currency(nw.unanimValue)}</span></div>
          <div class="setting-row">
            <label>Valuation (E£)</label>
            <input id="unanimValuation" type="number" inputmode="decimal" value="${escAttr(fin.settings.unanimValuation)}" />
          </div>
          <div class="setting-row">
            <label>Ownership %</label>
            <input id="unanimOwnership" type="number" inputmode="decimal" value="${escAttr(fin.settings.unanimOwnership)}" />
          </div>
          <div class="fin-note">Equity value = valuation × ownership% → ${currency(nw.unanimValue)} (${fmtUsd(nw.unanimValue, rate)})</div>
        </div>
        <button class="fin-add-btn" id="addAssetBtn">+ Add Asset</button>
        <div class="fin-totals"><span>Total Assets</span><span class="value">${currency(nw.totalAssets)}</span></div>
      </div>

      <div class="fin-card" id="liabCard">
        <div class="fin-card-title">Liabilities</div>
        ${liabSections || '<div class="fin-note">No liabilities yet.</div>'}
        <button class="fin-add-btn" id="addLiabilityBtn">+ Add Liability</button>
        <div class="fin-totals"><span>Total Liabilities</span><span class="value">${currency(nw.totalLiabilities)}</span></div>
      </div>

      <div class="fin-card">
        <div class="fin-totals" style="border-top:none;margin-top:0;padding-top:0;">
          <span>Net Worth</span>
          <span class="value ${signClass(nw.netWorth)}">${currency(nw.netWorth)} · ${fmtUsd(nw.netWorth, rate)}</span>
        </div>
      </div>
    `;
  }

  function wireBalance() {
    wireFinRows(document.getElementById("assetsCard"), "assets", ["value", "grams", "price_per_gram"], "assets");
    wireFinRows(document.getElementById("liabCard"), "liabilities", ["value"], "liabilities");

    document.getElementById("unanimValuation").addEventListener("change", (e) => {
      saveFinSettings({ unanimValuation: Number(e.target.value) || 0 });
    });
    document.getElementById("unanimOwnership").addEventListener("change", (e) => {
      saveFinSettings({ unanimOwnership: Number(e.target.value) || 0 });
    });

    document.getElementById("addAssetBtn").addEventListener("click", () => {
      openFinSheet({
        title: "Add asset",
        chips: { label: "Category", options: fin.cats.assetCategories },
        fields: (cat) =>
          isMetal(cat)
            ? [
                { key: "name", label: "Name", placeholder: "e.g. 21k gold" },
                { key: "grams", label: "Grams", type: "num", placeholder: "0" },
                { key: "price_per_gram", label: "Price per gram (E£)", type: "num", placeholder: "0" },
              ]
            : [
                { key: "name", label: "Name", placeholder: "e.g. CIB account" },
                { key: "value", label: "Value (E£)", type: "num", placeholder: "0" },
              ],
        onSave: async (cat, values) => {
          await finApi("assets", { method: "POST", body: JSON.stringify({ category: cat, ...values }) });
          await reloadFin("assets");
        },
      });
    });

    document.getElementById("addLiabilityBtn").addEventListener("click", () => {
      openFinSheet({
        title: "Add liability",
        chips: { label: "Category", options: fin.cats.liabilityCategories },
        fields: [
          { key: "name", label: "Name", placeholder: "e.g. Car loan" },
          { key: "value", label: "Value (E£)", type: "num", placeholder: "0" },
        ],
        onSave: async (cat, values) => {
          await finApi("liabilities", { method: "POST", body: JSON.stringify({ category: cat, ...values }) });
          await reloadFin("liabilities");
        },
      });
    });
  }

  // ---------- P&L ----------
  function renderPnl() {
    const m = monthStr(viewDate);
    const year = String(viewDate.getFullYear());
    const monthly = fin.pnlView === "monthly";
    const inRange = (mm) => (monthly ? mm === m : mm.slice(0, 4) === year);

    // Income = the income log (entered on the Income tab) plus any manual
    // line items from before the Income tab existed (still editable here).
    const incomeItems = fin.income.filter((i) => inRange(i.month));
    const logTotals = {};
    incomes
      .filter((i) => inRange(i.date.slice(0, 7)))
      .forEach((i) => {
        logTotals[i.category] = (logTotals[i.category] || 0) + (Number(i.amount) || 0);
      });
    const manualTotal = incomeItems.reduce((s, i) => s + (Number(i.value) || 0), 0);
    const logTotal = Object.values(logTotals).reduce((s, v) => s + v, 0);
    const totalIncome = manualTotal + logTotal;

    const incomeSections = fin.cats.incomeCategories
      .map((cat) => {
        const items = incomeItems.filter((i) => i.category === cat);
        const logAmt = logTotals[cat] || 0;
        if (items.length === 0 && logAmt === 0) return "";
        const subtotal = items.reduce((s, i) => s + (Number(i.value) || 0), 0) + logAmt;
        const logRow = logAmt
          ? `<div class="fin-row readonly">
              <span style="font-size:16px;">${escapeHtml(incomeCatById(cat).emoji)}</span>
              <span class="f-name" style="flex:1.4;font-size:14px;">From income log</span>
              <span class="row-amount">${currency(logAmt)}</span>
            </div>`
          : "";
        const rows = items
          .map((i) =>
            finRowHtml(i, {
              fields: [
                { key: "name", cls: "f-name", placeholder: "Description" },
                { key: "value", cls: "f-num", num: true, placeholder: "Value" },
              ],
            })
          )
          .join("");
        return `<div class="fin-section"><div class="fin-section-heading"><span>${escapeHtml(cat)}</span><span class="subtotal">${currency(subtotal)}</span></div>${logRow}${rows}</div>`;
      })
      .join("");

    // Expense side auto-computed from the expense log
    const expTotals = expenseTotalsByCategory((e) => inRange(e.date.slice(0, 7)));
    const totalExpense = Object.values(expTotals).reduce((s, v) => s + v, 0);
    const expenseRows = Object.entries(expTotals)
      .sort((a, b) => b[1] - a[1])
      .map(([id, v]) => {
        const c = catById(id);
        return `
        <div class="fin-row readonly">
          <span style="font-size:16px;">${escapeHtml(c.emoji)}</span>
          <span class="f-name" style="flex:1.4;font-size:14px;">${escapeHtml(c.label)}</span>
          <span class="row-amount">${currency(v)}</span>
        </div>`;
      })
      .join("");

    const netPL = totalIncome - totalExpense;

    // ---- ratios: GP, GP%, EBIT, EBT, net after tax ----
    // Interest (the 'interest' category) sits below EBIT, unless the user
    // explicitly marked it as a direct cost.
    const cogsSet = new Set(fin.settings.cogsCategories || []);
    const cogs = Object.entries(expTotals).reduce((s, [id, v]) => s + (cogsSet.has(id) ? v : 0), 0);
    const interest = cogsSet.has("interest") ? 0 : expTotals.interest || 0;
    const opex = totalExpense - cogs - interest;
    const grossProfit = totalIncome - cogs;
    const ebit = grossProfit - opex;
    const ebt = ebit - interest;
    const pct = (v) => (totalIncome > 0 ? (v / totalIncome) * 100 : 0);
    const fmtPct = (v) => pct(v).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%";
    const taxRate = Number(fin.settings.taxRate) || 0;
    const tax = ebt > 0 ? ebt * (taxRate / 100) : 0;
    const netAfterTax = ebt - tax;

    return `
      ${exportRowHtml()}
      <div class="toggle-row">
        <button class="btn-toggle ${monthly ? "active" : ""}" id="pnlMonthly">Monthly</button>
        <button class="btn-toggle ${!monthly ? "active" : ""}" id="pnlYearly">Yearly</button>
      </div>

      <div class="fin-card" id="incomeCard">
        <div class="fin-card-title">Income</div>
        <div class="fin-note">Filled automatically from your income log — add income in the Income tab.</div>
        ${incomeSections || '<div class="fin-note">No income entries for this period.</div>'}
        <div class="fin-totals"><span>Total Income</span><span class="value pos">${currency(totalIncome)}</span></div>
      </div>

      <div class="fin-card">
        <div class="fin-card-title">Expenses</div>
        <div class="fin-note">Filled automatically from your expense log — add expenses in the Spend tab.</div>
        ${expenseRows || '<div class="fin-note">No expenses for this period.</div>'}
        <div class="fin-totals"><span>Total Expenses</span><span class="value neg">${currency(totalExpense)}</span></div>
      </div>

      <div class="fin-card">
        <div class="fin-totals" style="border-top:none;margin-top:0;padding-top:0;">
          <span>Net Profit / Loss</span>
          <span class="value ${signClass(netPL)}">${currency(netPL)}</span>
        </div>
      </div>

      <div class="fin-card">
        <div class="fin-card-title">Ratios</div>
        <div class="ratio-row"><span>Cost of Sales (COGS)</span><span class="value">${currency(cogs)}</span></div>
        <div class="ratio-row"><span>Gross Profit</span><span class="value ${signClass(grossProfit)}">${currency(grossProfit)} · ${fmtPct(grossProfit)}</span></div>
        <div class="ratio-row"><span>Operating Expenses</span><span class="value">${currency(opex)}</span></div>
        <div class="ratio-row"><span>EBIT</span><span class="value ${signClass(ebit)}">${currency(ebit)} · ${fmtPct(ebit)}</span></div>
        <div class="ratio-row"><span>Interest</span><span class="value">${currency(interest)}</span></div>
        <div class="ratio-row"><span>EBT</span><span class="value ${signClass(ebt)}">${currency(ebt)} · ${fmtPct(ebt)}</span></div>
        <div class="setting-row" style="margin-top:10px;">
          <label>Tax rate %</label>
          <input id="taxRateInput" type="number" inputmode="decimal" step="0.1" min="0" max="100" value="${escAttr(taxRate)}" />
        </div>
        <div class="ratio-row"><span>Tax on EBT</span><span class="value">${currency(tax)}</span></div>
        <div class="fin-totals"><span>Net Profit After Tax</span><span class="value ${signClass(netAfterTax)}">${currency(netAfterTax)}</span></div>
        <div class="fin-note" style="margin-top:12px;">Which expense categories count as direct costs (COGS)? Tap to toggle — the rest count as operating expenses.</div>
        <div class="category-grid" id="cogsGrid"></div>
      </div>
    `;
  }

  function wirePnl() {
    document.getElementById("pnlMonthly").addEventListener("click", () => { fin.pnlView = "monthly"; renderFin(); });
    document.getElementById("pnlYearly").addEventListener("click", () => { fin.pnlView = "yearly"; renderFin(); });
    wireFinRows(document.getElementById("incomeCard"), "income", ["value"], "income");

    document.getElementById("taxRateInput").addEventListener("change", (e) => {
      const v = Math.min(100, Math.max(0, Number(e.target.value) || 0));
      saveFinSettings({ taxRate: v });
    });

    const cogsSet = new Set(fin.settings.cogsCategories || []);
    renderChipGrid(
      document.getElementById("cogsGrid"),
      cats,
      (cat) => cogsSet.has(cat.id),
      (cat) => {
        if (cogsSet.has(cat.id)) cogsSet.delete(cat.id);
        else cogsSet.add(cat.id);
        saveFinSettings({ cogsCategories: [...cogsSet] });
      }
    );

  }

  // ---------- CASH FLOW ----------
  function renderCashflow() {
    const m = monthStr(viewDate);
    const year = String(viewDate.getFullYear());
    const monthly = fin.cfView === "monthly";
    const inRange = (c) => (monthly ? c.month === m : c.month.slice(0, 4) === year);
    const filtered = fin.cf.filter(inRange);

    const sectionDefs = [
      { key: "operating", label: "Operating Activities" },
      { key: "investing", label: "Investing Activities" },
      { key: "financing", label: "Financing Activities" },
    ];

    let netCF = 0;
    const sections = sectionDefs
      .map((def) => {
        const items = filtered.filter((c) => c.section === def.key);
        const subtotal = items.reduce((s, c) => s + (Number(c.value) || 0), 0);
        netCF += subtotal;
        const rows = items
          .map((c) =>
            finRowHtml(c, {
              fields: [
                { key: "name", cls: "f-name", placeholder: "Description" },
                { key: "value", cls: "f-num", num: true, placeholder: "+/- Value" },
              ],
            })
          )
          .join("");
        return `
          <div class="fin-section">
            <div class="fin-section-heading"><span>${def.label}</span><span class="subtotal ${signClass(subtotal)}">${currency(subtotal)}</span></div>
            ${rows}
            <button class="fin-add-btn add-cf" data-section="${def.key}">+ Add ${def.label.split(" ")[0]}</button>
          </div>`;
      })
      .join("");

    const cash = endingCashBalance(m);

    return `
      ${exportRowHtml()}
      <div class="toggle-row">
        <button class="btn-toggle ${monthly ? "active" : ""}" id="cfMonthly">Monthly</button>
        <button class="btn-toggle ${!monthly ? "active" : ""}" id="cfYearly">Yearly</button>
      </div>

      <div class="fin-card" id="cfCard">
        <div class="setting-row">
          <label>Starting Cash (E£)</label>
          <input id="startingCash" type="number" inputmode="decimal" value="${escAttr(fin.settings.startingCash)}" />
        </div>
        ${sections}
        <div class="fin-totals"><span>Net Cash Flow</span><span class="value ${signClass(netCF)}">${currency(netCF)}</span></div>
        <div class="fin-totals" style="border-top:none;padding-top:4px;"><span>Ending Cash Balance</span><span class="value ${signClass(cash)}">${currency(cash)}</span></div>
      </div>
    `;
  }

  function wireCashflow() {
    document.getElementById("cfMonthly").addEventListener("click", () => { fin.cfView = "monthly"; renderFin(); });
    document.getElementById("cfYearly").addEventListener("click", () => { fin.cfView = "yearly"; renderFin(); });
    wireFinRows(document.getElementById("cfCard"), "cashflow", ["value"], "cashflow");

    document.getElementById("startingCash").addEventListener("change", (e) => {
      saveFinSettings({ startingCash: Number(e.target.value) || 0 });
    });

    document.querySelectorAll(".add-cf").forEach((btn) => {
      btn.addEventListener("click", () => {
        const section = btn.dataset.section;
        openFinSheet({
          title: `Add ${section} item`,
          fields: [
            { key: "name", label: "Description", placeholder: "e.g. Rent received" },
            { key: "value", label: "Amount (E£, negative = cash out)", type: "num", placeholder: "0" },
          ],
          onSave: async (_chip, values) => {
            await finApi("cashflow", {
              method: "POST",
              body: JSON.stringify({ section, month: monthStr(viewDate), ...values }),
            });
            await reloadFin("cashflow");
          },
        });
      });
    });
  }

  // ---------- fin render dispatcher ----------
  function renderFin() {
    if (activeTab === "expenses") return;
    // The income log lives outside the fin statements data, so it renders
    // even before (or without) fin data loading.
    if (activeTab === "income") {
      finView.innerHTML = renderIncome();
      wireIncome();
      return;
    }
    if (!fin.loaded) {
      if (fin.failed) {
        finView.innerHTML =
          '<div class="fin-card"><div class="fin-note">Couldn\'t load your financial data — check your connection.</div><button class="fin-add-btn" id="finRetryBtn">Retry</button></div>';
        document.getElementById("finRetryBtn").addEventListener("click", async () => {
          fin.failed = false;
          renderFin();
          await loadFin();
          renderFin();
        });
      } else {
        finView.innerHTML = '<div class="fin-card"><div class="fin-note">Loading…</div></div>';
      }
      return;
    }
    if (activeTab === "overview") {
      finView.innerHTML = renderOverview();
      wireOverview();
    } else if (activeTab === "balance") {
      finView.innerHTML = renderBalance();
      wireBalance();
    } else if (activeTab === "pnl") {
      finView.innerHTML = renderPnl();
      wirePnl();
    } else if (activeTab === "cashflow") {
      finView.innerHTML = renderCashflow();
      wireCashflow();
    }
  }

  // ================= TABS =================

  document.querySelectorAll(".tabbar .tab").forEach((tab) => {
    tab.addEventListener("click", async () => {
      activeTab = tab.dataset.tab;
      appRoot.dataset.tab = activeTab;
      document.querySelectorAll(".tabbar .tab").forEach((t) => t.classList.toggle("active", t === tab));
      expView.classList.toggle("active", activeTab === "expenses");
      finView.classList.toggle("active", activeTab !== "expenses");
      if (activeTab !== "expenses" && !fin.loaded) {
        fin.failed = false;
        renderFin();
        await loadFin();
      }
      renderAll();
    });
  });

  // ================= SHARED =================

  function renderAll() {
    renderMonthLabel();
    if (activeTab === "expenses") renderExpensesTab();
    else renderFin();
  }

  document.getElementById("prevMonth").addEventListener("click", () => {
    viewDate.setMonth(viewDate.getMonth() - 1);
    renderAll();
  });

  document.getElementById("nextMonth").addEventListener("click", () => {
    viewDate.setMonth(viewDate.getMonth() + 1);
    renderAll();
  });

  function todayStr() {
    const d = new Date();
    const off = d.getTimezoneOffset();
    const local = new Date(d.getTime() - off * 60000);
    return local.toISOString().slice(0, 10);
  }

  let editingExpenseId = null;
  const sheetTitle = document.getElementById("sheetTitle");
  const deleteExpenseBtn = document.getElementById("deleteExpenseBtn");

  function openSheet(expense) {
    editingExpenseId = expense ? expense.id : null;
    selectedCategory = expense ? expense.category : null;
    amountInput.value = expense ? expense.amount : "";
    noteInput.value = expense ? expense.note || "" : "";
    dateInput.value = expense ? expense.date : todayStr();
    sheetTitle.textContent = expense ? "Edit expense" : "Add expense";
    deleteExpenseBtn.style.display = expense ? "block" : "none";
    renderCategoryGrid();
    sheetOverlay.classList.add("open");
    if (!expense) setTimeout(() => amountInput.focus(), 200);
  }

  function closeSheet() {
    sheetOverlay.classList.remove("open");
  }

  deleteExpenseBtn.addEventListener("click", async () => {
    if (!editingExpenseId) return;
    const target = expenses.find((x) => x.id === editingExpenseId);
    const label = target ? `${currency(target.amount)}${target.note ? " · " + target.note : ""}` : "";
    if (!confirm(`Delete this expense?\n${label}`)) return;
    const prev = expenses;
    expenses = expenses.filter((x) => x.id !== editingExpenseId);
    writeCache(syncCode, expenses);
    closeSheet();
    renderAll();
    try {
      await apiDeleteExpense(syncCode, editingExpenseId);
    } catch {
      expenses = prev;
      writeCache(syncCode, expenses);
      renderAll();
      setSyncStatus("offline");
      alert("Couldn't delete — check your connection and try again.");
    }
  });

  document.getElementById("fab").addEventListener("click", () => {
    if (activeTab === "income") openIncomeSheet();
    else openSheet();
  });
  document.getElementById("cancelBtn").addEventListener("click", closeSheet);
  sheetOverlay.addEventListener("click", (e) => {
    if (e.target === sheetOverlay) closeSheet();
  });

  saveBtn.addEventListener("click", async () => {
    const amount = parseFloat(amountInput.value);
    if (!amount || amount <= 0) {
      amountInput.focus();
      return;
    }
    if (!selectedCategory) {
      return;
    }
    const date = dateInput.value || todayStr();
    const note = noteInput.value.trim();

    saveBtn.disabled = true;
    try {
      const payload = { amount, category: selectedCategory, note, date };
      if (editingExpenseId) {
        const updated = await apiUpdateExpense(syncCode, editingExpenseId, payload);
        expenses = expenses.map((x) => (x.id === editingExpenseId ? { ...x, ...updated } : x));
      } else {
        const created = await apiAddExpense(syncCode, payload);
        expenses.push(created);
      }
      writeCache(syncCode, expenses);
      closeSheet();
      renderAll();
      setSyncStatus("online");
    } catch {
      setSyncStatus("offline");
      alert("Couldn't save — check your connection and try again.");
    } finally {
      saveBtn.disabled = false;
    }
  });

  // ---- category editor sheet ----
  const CAT_PALETTE = ["#ff8a5b", "#5bc0ff", "#ffd166", "#c792ff", "#6cf0b8", "#6c8bff", "#ff9ecb", "#ff6b6b", "#9ee37d", "#f4a261", "#9494a3"];
  const catSheetOverlay = document.getElementById("catSheetOverlay");
  const catListEl = document.getElementById("catList");

  function openCatSheet() {
    closeSheet();
    renderCatRows();
    catSheetOverlay.classList.add("open");
  }

  function closeCatSheet() {
    catSheetOverlay.classList.remove("open");
    renderAll();
  }

  function renderCatRows() {
    catListEl.innerHTML = "";
    cats.forEach((cat) => {
      const row = document.createElement("div");
      row.className = "cat-row";
      row.innerHTML = `
        <button class="cat-color-dot" style="background:${escAttr(cat.color)}" aria-label="Change color"></button>
        <input class="cat-emoji" value="${escAttr(cat.emoji)}" maxlength="4" aria-label="Emoji" />
        <input class="cat-label" value="${escAttr(cat.label)}" maxlength="24" aria-label="Name" />
        <input class="cat-budget" type="number" inputmode="decimal" min="0" placeholder="Budget" value="${Number(cat.budget) > 0 ? escAttr(cat.budget) : ""}" aria-label="Monthly budget" />
        ${cat.id === "other" ? '<span class="cat-lock" title="Permanent">🔒</span>' : '<button class="row-del">✕</button>'}
      `;

      async function saveCat(fields) {
        try {
          await catsApi(`/${encodeURIComponent(cat.id)}`, { method: "PUT", body: JSON.stringify(fields) });
          await loadCats();
        } catch {
          alert("Couldn't save — check your connection.");
        }
        renderCatRows();
      }

      row.querySelector(".cat-color-dot").addEventListener("click", () => {
        const idx = CAT_PALETTE.indexOf(cat.color);
        saveCat({ color: CAT_PALETTE[(idx + 1) % CAT_PALETTE.length] });
      });
      row.querySelector(".cat-emoji").addEventListener("change", (e) => saveCat({ emoji: e.target.value }));
      row.querySelector(".cat-label").addEventListener("change", (e) => {
        if (e.target.value.trim()) saveCat({ label: e.target.value.trim() });
        else renderCatRows();
      });
      row.querySelector(".cat-budget").addEventListener("change", (e) => {
        saveCat({ budget: Math.max(0, Number(e.target.value) || 0) });
      });

      const del = row.querySelector(".row-del");
      if (del) {
        del.addEventListener("click", async () => {
          if (!confirm(`Delete "${cat.label}"?\nAny expenses in it will move to Other.`)) return;
          try {
            await catsApi(`/${encodeURIComponent(cat.id)}`, { method: "DELETE" });
            await Promise.all([
              loadCats(),
              (async () => {
                try {
                  expenses = await apiFetchExpenses(syncCode);
                  writeCache(syncCode, expenses);
                } catch {
                  /* keep cached list */
                }
              })(),
            ]);
          } catch {
            alert("Couldn't delete — check your connection.");
          }
          renderCatRows();
        });
      }

      catListEl.appendChild(row);
    });
  }

  document.getElementById("addCatBtn").addEventListener("click", async () => {
    try {
      await catsApi("", {
        method: "POST",
        body: JSON.stringify({ label: "New category", emoji: "🏷️", color: CAT_PALETTE[cats.length % CAT_PALETTE.length], budget: 0 }),
      });
      await loadCats();
    } catch {
      alert("Couldn't add — check your connection.");
    }
    renderCatRows();
  });

  document.getElementById("catCloseBtn").addEventListener("click", closeCatSheet);
  catSheetOverlay.addEventListener("click", (e) => {
    if (e.target === catSheetOverlay) closeCatSheet();
  });
  document.getElementById("editCatsBtn").addEventListener("click", openCatSheet);
  document.getElementById("editCatsChartBtn").addEventListener("click", openCatSheet);

  // ---- sync sheet ----
  function openSyncSheet() {
    codeDisplay.textContent = syncCode || "------";
    joinCodeInput.value = "";
    syncOverlay.classList.add("open");
  }
  function closeSyncSheet() {
    syncOverlay.classList.remove("open");
  }

  syncBadge.addEventListener("click", openSyncSheet);
  document.getElementById("syncCloseBtn").addEventListener("click", closeSyncSheet);
  syncOverlay.addEventListener("click", (e) => {
    if (e.target === syncOverlay) closeSyncSheet();
  });

  copyCodeBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(syncCode);
      copyCodeBtn.textContent = "Copied!";
      setTimeout(() => (copyCodeBtn.textContent = "Copy code"), 1500);
    } catch {
      /* clipboard unavailable */
    }
  });

  document.getElementById("joinCodeBtn").addEventListener("click", async () => {
    const code = joinCodeInput.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,16}$/.test(code)) {
      joinCodeInput.focus();
      return;
    }
    syncCode = code;
    localStorage.setItem(CODE_KEY, syncCode);
    closeSyncSheet();
    fin.loaded = false;
    fin.failed = false;
    cats = readCatsCache(syncCode) || DEFAULT_CATEGORIES;
    await loadFromServer();
  });

  async function loadFromServer() {
    setSyncStatus("syncing");
    expenses = readCache(syncCode);
    incomes = readIncomeCache(syncCode);
    renderAll();
    // Expenses, incomes, categories and financial data are independent — parallel.
    await Promise.all([
      (async () => {
        try {
          expenses = await apiFetchExpenses(syncCode);
          writeCache(syncCode, expenses);
          setSyncStatus("online");
        } catch {
          setSyncStatus("offline");
        }
      })(),
      (async () => {
        try {
          incomes = await apiFetchIncomes(syncCode);
          writeIncomeCache(syncCode, incomes);
        } catch {
          /* keep cached list */
        }
      })(),
      loadCats(),
      loadFin(),
    ]);
    renderAll();
  }

  async function init() {
    if (!syncCode) {
      setSyncStatus("syncing");
      try {
        syncCode = await apiGetNewCode();
        localStorage.setItem(CODE_KEY, syncCode);
      } catch {
        setSyncStatus("offline");
        return;
      }
    }
    await loadFromServer();
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  init();
})();
