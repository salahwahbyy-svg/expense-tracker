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
  const INC_CATS_CACHE_PREFIX = "expenses:incomeCats:";

  // Income categories are user-editable and load per sync code; these
  // defaults are only the offline/first-paint fallback (they match the
  // server seed). Ids are the exact strings stored on income entries.
  const DEFAULT_INCOME_CATS = [
    { id: "Salary", label: "Salary", emoji: "💼", color: "#6cf0b8" },
    { id: "Business Income", label: "Business", emoji: "🏪", color: "#5bc0ff" },
    { id: "Investment Income", label: "Investment", emoji: "📈", color: "#c792ff" },
    { id: "Other Income", label: "Other", emoji: "💰", color: "#ffd166" },
  ];

  function incomeCatById(id) {
    return incomeCats.find((c) => c.id === id) || { id, label: id, emoji: "💰", color: "#9494a3" };
  }

  function readIncCatsCache(code) {
    try {
      const cached = JSON.parse(localStorage.getItem(INC_CATS_CACHE_PREFIX + code));
      return Array.isArray(cached) && cached.length > 0 ? cached : null;
    } catch {
      return null;
    }
  }

  async function loadIncCats() {
    try {
      incomeCats = await finApi("inccats");
      localStorage.setItem(INC_CATS_CACHE_PREFIX + syncCode, JSON.stringify(incomeCats));
    } catch {
      incomeCats = readIncCatsCache(syncCode) || DEFAULT_INCOME_CATS;
    }
  }

  function currency(n) {
    const v = Number(n) || 0;
    const sign = v < 0 ? "-" : "";
    return sign + "E£" + Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
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
  let incomeCats = (syncCode && readIncCatsCache(syncCode)) || DEFAULT_INCOME_CATS;

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

  // A deleted category keeps its identity on old expenses; suffix the label
  // so the user can see the category itself is gone.
  function catDisplayLabel(c) {
    return c.deleted ? `${c.label} · deleted` : c.label;
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

  const fin = {
    loaded: false,
    failed: false,
    settings: { exchangeRate: 47.5, startingCash: 0, taxRate: 0, cogsCategories: [] },
    cats: { assetCategories: [], liabilityCategories: [], incomeCategories: [], cfSections: [] },
    assetCats: [],
    liabCats: [],
    assets: [],
    liabilities: [],
    income: [],
    cf: [],
    history: [],
    apar: [],
    depcats: [],
    depitems: [],
    pnlPeriod: "month",
    cfPeriod: "month",
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
  const backupBtn = document.getElementById("backupBtn");
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
      cats.filter((c) => !c.deleted),
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

  // Virtual category for the Spend page: this month's depreciation charge
  // shows alongside real spending so the total reflects asset wear too.
  const DEPRECIATION_CAT = { id: "depreciation", label: "Depreciation", emoji: "🏭", color: "#8f9bb3", budget: 0 };

  function renderTotal(list, dep) {
    const total = list.reduce((sum, e) => sum + e.amount, 0) + (dep || 0);
    monthTotalEl.textContent = currency(total);
  }

  function renderChart(list, dep) {
    const totalsByCat = {};
    let grandTotal = 0;
    list.forEach((e) => {
      totalsByCat[e.category] = (totalsByCat[e.category] || 0) + e.amount;
      grandTotal += e.amount;
    });
    if (dep > 0) {
      totalsByCat[DEPRECIATION_CAT.id] = (totalsByCat[DEPRECIATION_CAT.id] || 0) + dep;
      grandTotal += dep;
    }

    // Show every category with spend this month, plus budgeted ones even
    // at zero spend so budget progress is visible from day one.
    const ids = new Set(Object.keys(totalsByCat));
    cats.forEach((c) => {
      if (!c.deleted && Number(c.budget) > 0) ids.add(c.id);
    });
    const active = [...ids]
      .map((id) => (id === DEPRECIATION_CAT.id && !cats.some((c) => c.id === id) ? DEPRECIATION_CAT : catById(id)))
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
        <span class="bar-label">${escapeHtml(catDisplayLabel(cat))}</span>
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

    const openPayables = fin.apar.filter((x) => x.kind === "ap" && !x.paid_date);

    if (list.length === 0 && openPayables.length === 0) {
      emptyState.style.display = "flex";
      return;
    }
    emptyState.style.display = "none";

    if (openPayables.length > 0) {
      const group = document.createElement("div");
      group.className = "day-group";

      const payTotal = openPayables.reduce((sum, x) => sum + (Number(x.amount) || 0), 0);
      const heading = document.createElement("div");
      heading.className = "day-heading";
      heading.innerHTML = `<span>Unpaid payables</span><span class="day-total">${currency(payTotal)}</span>`;
      group.appendChild(heading);

      openPayables.forEach((x) => {
        const cat = x.category ? catById(x.category) : null;
        const iconHtml = cat
          ? `<div class="expense-icon" style="background:${escAttr(cat.color)}22;color:${escAttr(cat.color)}">${escapeHtml(cat.emoji)}</div>`
          : `<div class="expense-icon" style="background:#9494a322;color:#9494a3">🧾</div>`;
        const item = document.createElement("div");
        item.className = "expense-item";
        item.innerHTML = `
          <div class="swipe-content">
            ${iconHtml}
            <div class="expense-meta">
              <div class="expense-category">${escapeHtml(x.name || "Payable")}</div>
              <div class="expense-note">due ${escapeHtml(x.due_date || "—")}</div>
            </div>
            <div class="expense-amount">${currency(x.amount)}</div>
            <button class="apar-paid list-pay" data-id="${escAttr(x.id)}" title="Mark paid">✓</button>
          </div>
        `;
        item.querySelector(".list-pay").addEventListener("click", (e) => {
          e.stopPropagation();
          aparLifecycle(x.id, "pay");
        });
        // Tap the row (not the ✓) to edit or delete the payable.
        item.querySelector(".swipe-content").addEventListener("click", () => openAparSheet(x));
        group.appendChild(item);
      });

      listEl.appendChild(group);
    }

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
              <div class="expense-category">${escapeHtml(catDisplayLabel(cat))}</div>
              ${e.note ? `<div class="expense-note">${escapeHtml(e.note)}</div>` : ""}
              ${e.receipt ? `<div class="expense-note">🧾 #${escapeHtml(e.receipt)}</div>` : ""}
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
    const dep = depForMonth(monthStr(viewDate));
    renderTotal(list, dep);
    renderChart(list, dep);
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
                  ${e.receipt ? `<div class="expense-note">🧾 #${escapeHtml(e.receipt)}</div>` : ""}
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

    // Open receivables (money expected, not yet collected) get their own
    // section above the day groups, mirroring the payables section on Spend.
    const openReceivables = fin.apar.filter((x) => x.kind === "ar" && !x.paid_date);
    const arTotal = openReceivables.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const arRows = openReceivables
      .map((x) => {
        const cat = x.category ? incomeCatById(x.category) : null;
        const iconHtml = cat
          ? `<div class="expense-icon" style="background:${escAttr(cat.color)}22;color:${escAttr(cat.color)}">${escapeHtml(cat.emoji)}</div>`
          : `<div class="expense-icon" style="background:#9494a322;color:#9494a3">🧾</div>`;
        return `
          <div class="expense-item apar-item" data-id="${escAttr(x.id)}">
            <div class="swipe-content">
              ${iconHtml}
              <div class="expense-meta">
                <div class="expense-category">${escapeHtml(x.name || "Receivable")}</div>
                <div class="expense-note">due ${escapeHtml(x.due_date || "—")}</div>
              </div>
              <div class="expense-amount pos">+${currency(x.amount)}</div>
              <button class="apar-paid list-pay" data-id="${escAttr(x.id)}" title="Mark paid">✓</button>
            </div>
          </div>`;
      })
      .join("");
    const arSection = arRows
      ? `
        <div class="day-group">
          <div class="day-heading"><span>Expected income</span><span class="day-total">${currency(arTotal)}</span></div>
          ${arRows}
        </div>`
      : "";

    return `
      <section class="totals">
        <div class="total-amount pos">${currency(total)}</div>
        <div class="total-sub">earned this month</div>
      </section>
      ${bars ? `<section class="chart-card"><div class="chart-title"><span>By category</span><button id="editIncCatsBtn" class="chart-edit-btn" type="button">✏️ Edit</button></div><div class="bars">${bars}</div></section>` : ""}
      <section class="list-section">
        ${arSection}${listHtml || (arSection ? "" : '<div class="empty-state" style="display:flex;"><div class="empty-emoji">💰</div><div>No income yet this month</div></div>')}
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
    finView.querySelectorAll(".list-pay").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        aparLifecycle(btn.dataset.id, "pay");
      });
    });
    // Tap an expected-income row (not the ✓) to edit or delete it.
    finView.querySelectorAll(".apar-item").forEach((el) => {
      el.addEventListener("click", () => {
        const item = fin.apar.find((x) => x.id === el.dataset.id);
        if (item) openAparSheet(item);
      });
    });
    const editBtn = document.getElementById("editIncCatsBtn");
    if (editBtn) editBtn.addEventListener("click", openIncCatSheet);
  }

  function openIncomeSheet(entry) {
    openFinSheet({
      title: entry ? "Edit income" : "Add income",
      chips: {
        label: "Category",
        options: incomeCats,
        selected: entry ? incomeCats.find((c) => c.id === entry.category) || null : null,
        onEdit: () => {
          closeFinSheet();
          openIncCatSheet();
        },
      },
      fields: [
        { key: "amount", label: "Amount (E£)", type: "num", placeholder: "0", value: entry ? entry.amount : "" },
        { key: "note", label: "Note (optional)", placeholder: "e.g. July salary", value: entry ? entry.note || "" : "" },
        { key: "date", label: "Invoice date", type: "date", value: entry ? entry.date : todayStr() },
      ],
      checkbox: entry ? null : { label: "⏳ Not received yet — expected income (AR)", checked: false },
      onSave: async (cat, values, isAr) => {
        if (!values.amount || values.amount <= 0) throw new Error("invalid_amount");
        if (isAr) {
          await finApi("apar", {
            method: "POST",
            body: JSON.stringify({ kind: "ar", name: values.note, amount: values.amount, due_date: values.date, category: cat.id }),
          });
          await reloadFin("apar");
          return;
        }
        // Optimistic: the entry shows instantly and syncs in the background,
        // so a cold-starting server never blocks the sheet. The receipt input
        // was removed from the sheet; preserve an edited entry's existing
        // receipt value instead of wiping it, new entries just have none.
        const payload = { amount: values.amount, category: cat.id, note: values.note, date: values.date, receipt: entry ? entry.receipt || "" : "" };
        const editingId = entry ? entry.id : null;
        const tempId = "tmp" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const before = editingId ? incomes.find((x) => x.id === editingId) : null;
        if (editingId) {
          incomes = incomes.map((x) => (x.id === editingId ? { ...x, ...payload } : x));
        } else {
          incomes.push({ id: tempId, createdAt: Date.now(), ...payload });
        }
        writeIncomeCache(syncCode, incomes);
        syncIncomeEntry(editingId, tempId, payload, before);
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

  // Background sync for optimistic income saves; rolls back and warns if the
  // server rejects it.
  async function syncIncomeEntry(editingId, tempId, payload, before) {
    try {
      if (editingId) {
        const updated = await apiUpdateIncome(syncCode, editingId, payload);
        incomes = incomes.map((x) => (x.id === editingId ? { ...x, ...updated } : x));
      } else {
        const created = await apiAddIncome(syncCode, payload);
        incomes = incomes.map((x) => (x.id === tempId ? created : x));
      }
      writeIncomeCache(syncCode, incomes);
      setSyncStatus("online");
    } catch {
      if (editingId && before) incomes = incomes.map((x) => (x.id === editingId ? before : x));
      else incomes = incomes.filter((x) => x.id !== tempId);
      writeIncomeCache(syncCode, incomes);
      setSyncStatus("offline");
      alert("Couldn't sync that income — check your connection. The change was undone.");
    }
    renderAll();
  }

  // ================= FINANCIAL STATEMENTS =================

  async function loadFin() {
    if (!syncCode) return;
    try {
      const [cats, settings, assetCats, liabCats, assets, liabilities, income, cf, history, apar, depcats, depitems] = await Promise.all([
        finApi("categories"),
        finApi("settings"),
        finApi("bscats?kind=asset"),
        finApi("bscats?kind=liability"),
        finApi("assets"),
        finApi("liabilities"),
        finApi("income"),
        finApi("cashflow"),
        finApi("networth"),
        finApi("apar"),
        finApi("depcats"),
        finApi("depitems"),
      ]);
      fin.cats = cats;
      fin.settings = settings;
      fin.assetCats = assetCats;
      fin.liabCats = liabCats;
      fin.assets = assets;
      fin.liabilities = liabilities;
      fin.income = income;
      fin.cf = cf;
      fin.history = history;
      fin.apar = apar;
      fin.depcats = depcats;
      fin.depitems = depitems;
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
      else if (name === "apar") fin.apar = data;
      else if (name === "depcats") fin.depcats = data;
      else if (name === "depitems") fin.depitems = data;
    } catch {
      /* keep stale data */
    }
  }

  async function reloadBsCats(kind) {
    try {
      const data = await finApi(`bscats?kind=${kind}`);
      if (kind === "asset") fin.assetCats = data;
      else fin.liabCats = data;
    } catch {
      /* keep stale data */
    }
  }

  function assetEffectiveValue(a) {
    return Number(a.value) || 0;
  }

  // Open AP/AR as of a month: paid items drop off from their paid month.
  // AR is a current asset, AP a current liability.
  function aparOpenTotals(mk) {
    let ar = 0;
    let ap = 0;
    fin.apar.forEach((x) => {
      const paid = x.paid_date ? String(x.paid_date).slice(0, 7) : null;
      if (paid && paid <= mk) return;
      if (x.kind === "ar") ar += Number(x.amount) || 0;
      else ap += Number(x.amount) || 0;
    });
    return { ar, ap };
  }

  function computeNetWorth(mk) {
    const m = mk || monthStr(viewDate);
    const fixed = fixedAssetTotals(m);
    const apar = aparOpenTotals(m);
    const totalAssets = fin.assets.reduce((sum, a) => sum + assetEffectiveValue(a), 0) + fixed.nbv + apar.ar;
    const totalLiabilities = fin.liabilities.reduce((sum, l) => sum + (Number(l.value) || 0), 0) + apar.ap;
    return { totalAssets, totalLiabilities, fixed, apar, netWorth: totalAssets - totalLiabilities };
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

  // ---------- straight-line depreciation ----------
  // All math lives in the shared Depreciation module (depreciation.js) so
  // the P&L expense, Balance Sheet book values, Cash Flow add-back, and the
  // server exports can never disagree. Years come from the item's category.
  function depYearsById(id) {
    const c = fin.depcats.find((c) => c.id === id);
    return c ? Number(c.years) || 0 : 0;
  }

  function depForMonth(mk) {
    return fin.depitems.reduce((s, it) => s + Depreciation.forMonth(it, depYearsById(it.category), mk), 0);
  }

  // Fixed-asset totals for the Balance Sheet as of month `mk`.
  function fixedAssetTotals(mk) {
    let cost = 0;
    let accum = 0;
    fin.depitems.forEach((it) => {
      cost += Number(it.cost) || 0;
      accum += Depreciation.accumulated(it, depYearsById(it.category), mk);
    });
    return { cost, accum, nbv: cost - accum };
  }

  // ---------- reporting periods (P&L / Cash Flow duration filter) ----------
  const PERIOD_OPTIONS = [
    { id: "month", label: "Month" },
    { id: "3m", label: "3 months" },
    { id: "6m", label: "6 months" },
    { id: "year", label: "Year" },
    { id: "12m", label: "12 months" },
    { id: "all", label: "All time" },
  ];

  function monthKeyLabel(mk) {
    return `${MONTH_SHORT[Number(mk.slice(5, 7)) - 1]} ${mk.slice(0, 4)}`;
  }

  // A period is a window of month keys ending at the viewed month ("year" is
  // the viewed calendar year, "all" is everything up to the viewed month).
  function periodRange(id) {
    const end = monthStr(viewDate);
    if (id === "year") {
      const y = viewDate.getFullYear();
      const months = Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`);
      return { id, start: months[0], end: months[11], months, label: String(y) };
    }
    if (id === "all") {
      return { id, start: "0000-01", end, months: null, label: `All time · to ${monthKeyLabel(end)}` };
    }
    const n = { month: 1, "3m": 3, "6m": 6, "12m": 12 }[id] || 1;
    const months = [];
    for (let i = n - 1; i >= 0; i--) {
      months.push(monthStr(new Date(viewDate.getFullYear(), viewDate.getMonth() - i, 1)));
    }
    const label = n === 1 ? monthKeyLabel(end) : `${monthKeyLabel(months[0])} – ${monthKeyLabel(end)}`;
    return { id, start: months[0], end, months, label };
  }

  function inPeriod(r, mk) {
    return mk >= r.start && mk <= r.end;
  }

  // Depreciation charged during the period ("all" = everything accumulated
  // up to the period end).
  function itemDepForRange(it, r) {
    const years = depYearsById(it.category);
    if (!r.months) return Depreciation.accumulated(it, years, r.end);
    return r.months.reduce((s, mk) => s + Depreciation.forMonth(it, years, mk), 0);
  }

  // Cash-flow investing rows for a period: built by running the shared
  // per-month helper (app.js and export.js both use it, so a cash purchase
  // and a payable settlement never land in different months on either side)
  // over every month the period covers. "all" has no fixed month list, so
  // fall back to whichever months actually have a purchase or a settlement.
  function investingRowsForPeriod(r) {
    let months = r.months;
    if (!months) {
      const set = new Set();
      fin.depitems.forEach((it) => set.add(String(it.date).slice(0, 7)));
      fin.apar.forEach((x) => {
        if (x.asset_id && x.paid_date) set.add(String(x.paid_date).slice(0, 7));
      });
      months = Array.from(set)
        .filter((mk) => inPeriod(r, mk))
        .sort();
    }
    return months.flatMap((mk) => Depreciation.cashPurchaseRowsForMonth(fin.depitems, fin.apar, mk));
  }

  function periodSelectHtml(selectId, r) {
    return `
      <div class="toggle-row period-row">
        <select id="${selectId}" class="period-select" aria-label="Period">
          ${PERIOD_OPTIONS.map((p) => `<option value="${p.id}" ${r.id === p.id ? "selected" : ""}>${p.label}</option>`).join("")}
        </select>
        <span class="period-range">${escapeHtml(r.label)}</span>
      </div>`;
  }

  // Ending cash = starting cash + manual flow items + cash net income from
  // the logs − fixed-asset purchases. Depreciation cancels out of cash by
  // construction (net income includes −dep, operating adds +dep back), so
  // only the purchase month moves cash — the correct indirect-method result.
  function endingCashBalance(uptoMonth) {
    const manual = fin.cf
      .filter((c) => c.month <= uptoMonth)
      .reduce((sum, c) => sum + (Number(c.value) || 0), 0);
    const cashIn =
      incomes.filter((i) => i.date.slice(0, 7) <= uptoMonth).reduce((s, i) => s + (Number(i.amount) || 0), 0) +
      fin.income.filter((i) => i.month <= uptoMonth).reduce((s, i) => s + (Number(i.value) || 0), 0);
    const cashOut = expenses.filter((e) => e.date.slice(0, 7) <= uptoMonth).reduce((s, e) => s + (Number(e.amount) || 0), 0);
    // Paid AP/AR need no term of their own: paying creates a linked
    // income/expense entry, so their cash is already inside cashIn/cashOut.
    // Fixed-asset purchases are the exception: a cash-bought asset pulls cash
    // at purchase, but one bought on a payable pulls cash only when that
    // payable is later settled — cashPurchasesThroughMonth (shared with
    // export.js) already returns a negative total covering both cases.
    const purchasesCash = Depreciation.cashPurchasesThroughMonth(fin.depitems, fin.apar, uptoMonth);
    return (Number(fin.settings.startingCash) || 0) + manual + cashIn - cashOut + purchasesCash;
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
    // Clear leftovers from the previous sheet so the typed-input preservation
    // in renderFinSheetFields only kicks in for chip re-renders, not opens.
    finSheetFields.innerHTML = "";
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
    // Selecting a chip re-renders these fields; carry over anything the user
    // already typed (and the checkbox state) so their input isn't lost.
    const prev = {};
    finSheetFields.querySelectorAll("input[id^='finField_']").forEach((el) => (prev[el.id] = el.value));
    const prevCheckEl = document.getElementById("finSheetCheck");
    const prevChecked = prevCheckEl ? prevCheckEl.classList.contains("active") : null;
    let html = "";
    if (cfg.chips) {
      html += `<div class="field"><label>${escapeHtml(cfg.chips.label)}</label><div class="category-grid" id="finChipGrid"></div>${
        cfg.chips.onEdit ? '<button id="finChipEditBtn" type="button" class="link-btn">✏️ Edit categories</button>' : ""
      }</div>`;
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
    if (cfg.checkbox) {
      html += `<div class="field"><button type="button" id="finSheetCheck" class="asset-toggle${cfg.checkbox.checked ? " active" : ""}">${escapeHtml(cfg.checkbox.label)}</button></div>`;
    }
    finSheetFields.innerHTML = html;

    Object.entries(prev).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.value = value;
    });

    if (cfg.checkbox) {
      const check = document.getElementById("finSheetCheck");
      if (prevChecked) check.classList.add("active");
      check.addEventListener("click", (e) => {
        e.target.classList.toggle("active");
      });
    }

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
      if (cfg.chips.onEdit) {
        document.getElementById("finChipEditBtn").addEventListener("click", cfg.chips.onEdit);
      }
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
    const checked = cfg.checkbox ? document.getElementById("finSheetCheck").classList.contains("active") : false;
    finSaveBtn.disabled = true;
    try {
      await cfg.onSave(finSheetChip, values, checked);
      closeFinSheet();
      // renderAll (not renderFin): this sheet can be opened from the Spend
      // page too (payable rows), which renderFin would skip.
      renderAll();
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
      renderAll();
    } catch {
      alert("Couldn't delete — check your connection and try again.");
    }
  });

  // ---------- fin row helpers ----------
  function finRowHtml(row, opts) {
    const fields = opts.fields
      .map((f) => {
        if (f.type === "label") return `<span class="row-amount">${currency(f.value)}</span>`;
        return `<input class="${f.cls}" data-field="${f.key}" type="${f.num ? "number" : f.date ? "date" : "text"}"
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

  // Exports open in an in-app viewer (back + download buttons) instead of
  // navigating — in the installed PWA a plain link would replace the app
  // with the file and leave no way back.
  function exportRowHtml() {
    return `
      <div class="toggle-row">
        <button class="btn-toggle export-link" data-export="xlsx">⬇ Excel</button>
        <button class="btn-toggle export-link" data-export="pdf">⬇ PDF</button>
      </div>`;
  }

  const exportOverlay = document.getElementById("exportOverlay");
  const exportTitle = document.getElementById("exportTitle");
  const exportBody = document.getElementById("exportBody");
  let exportFile = null;
  let exportBlobUrl = null;

  async function openExportViewer(kind) {
    const month = monthStr(viewDate);
    const filename = `Financials_${month}.${kind}`;
    exportTitle.textContent = filename;
    exportBody.innerHTML = '<div class="export-loading">Preparing your file…</div>';
    exportOverlay.classList.add("open");
    exportFile = null;
    if (exportBlobUrl) {
      URL.revokeObjectURL(exportBlobUrl);
      exportBlobUrl = null;
    }
    try {
      const res = await fetch(`/api/export/${kind}?code=${encodeURIComponent(syncCode)}&month=${month}`);
      if (!res.ok) throw new Error("export_failed");
      const blob = await res.blob();
      const type = kind === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      exportFile = new File([blob], filename, { type });
      exportBlobUrl = URL.createObjectURL(exportFile);
      if (kind === "pdf") {
        exportBody.innerHTML = `<iframe class="export-frame" src="${exportBlobUrl}" title="PDF preview"></iframe>`;
      } else {
        exportBody.innerHTML = `
          <div class="export-filecard">
            <div class="export-fileicon">📊</div>
            <div class="export-filename">${escapeHtml(filename)}</div>
            <div class="fin-note">Excel workbook with your Balance Sheet, P&amp;L and Cash Flow for ${escapeHtml(month)}. Tap ⬇ Download to save or share it.</div>
          </div>`;
      }
    } catch {
      exportBody.innerHTML =
        '<div class="export-filecard"><div class="export-fileicon">⚠️</div><div class="fin-note">Couldn\'t prepare the file — check your connection and try again.</div></div>';
    }
  }

  function closeExportViewer() {
    exportOverlay.classList.remove("open");
    exportBody.innerHTML = "";
    if (exportBlobUrl) {
      URL.revokeObjectURL(exportBlobUrl);
      exportBlobUrl = null;
    }
    exportFile = null;
  }

  document.getElementById("exportBackBtn").addEventListener("click", closeExportViewer);
  document.getElementById("exportDownloadBtn").addEventListener("click", async () => {
    if (!exportFile) return;
    // In the installed iPhone app the share sheet is the reliable way to
    // save a file (Save to Files, AirDrop, Mail…); browsers get a normal
    // download instead.
    if (navigator.canShare && navigator.canShare({ files: [exportFile] })) {
      try {
        await navigator.share({ files: [exportFile], title: exportFile.name });
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return; // user closed the sheet
      }
    }
    const a = document.createElement("a");
    a.href = exportBlobUrl;
    a.download = exportFile.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  // The export buttons re-render with every fin view, so one delegated
  // listener covers them all.
  finView.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-export]");
    if (btn) openExportViewer(btn.dataset.export);
  });

  // ---------- OVERVIEW ----------
  function renderOverview() {
    const nw = computeNetWorth();
    const m = monthStr(viewDate);
    const year = viewDate.getFullYear();
    const income = incomeTotalForMonth(m);
    const spent = expenseTotalForMonth(m);
    const netPL = income - spent - depForMonth(m);
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
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Assets</div>
          <div class="stat-value">${currency(nw.totalAssets)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Liabilities</div>
          <div class="stat-value">${currency(nw.totalLiabilities)}</div>
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
    const m = monthStr(viewDate);
    const nw = computeNetWorth(m);

    // Fixed assets stay on the books at cost; accumulated depreciation is a
    // computed contra-asset; only the net book value counts toward totals.
    const fixedRows = fin.depitems
      .map((it) => {
        const years = depYearsById(it.category);
        const accum = Depreciation.accumulated(it, years, m);
        return `
          <div class="fin-row readonly">
            <span class="f-name" style="flex:1.4;font-size:14px;">${escapeHtml(it.name || "Item")}</span>
            <span class="fx-col">${currency(it.cost)}</span>
            <span class="fx-col neg">−${currency(accum)}</span>
            <span class="row-amount">${currency(Depreciation.netBookValue(it, years, m))}</span>
          </div>`;
      })
      .join("");
    const fixedSection = fin.depitems.length
      ? `<div class="fin-section">
          <div class="fin-section-heading"><span>Fixed Assets (net book value)</span><span class="subtotal">${currency(nw.fixed.nbv)}</span></div>
          <div class="fin-note">Cost − accumulated depreciation, as of this month. Items are managed in the P&L Depreciation card.</div>
          ${fixedRows}
          <div class="fin-row readonly">
            <span class="f-name" style="flex:1.4;font-size:13px;color:var(--text-dim);">Total · accum. depreciation</span>
            <span class="fx-col">${currency(nw.fixed.cost)}</span>
            <span class="fx-col neg">−${currency(nw.fixed.accum)}</span>
            <span class="row-amount">${currency(nw.fixed.nbv)}</span>
          </div>
        </div>`
      : "";

    // User-editable categories; items reference the category id (the label
    // can be renamed freely).
    const bsSection = (cat, items, subtotal) => {
      const rows = items
        .map((it) =>
          finRowHtml(it, {
            fields: [
              { key: "name", cls: "f-name", placeholder: "Name" },
              { key: "value", cls: "f-num", num: true, placeholder: "Value" },
            ],
          })
        )
        .join("");
      return `<div class="fin-section"><div class="fin-section-heading"><span>${escapeHtml(cat.label)}</span><span class="subtotal">${currency(subtotal)}</span></div>${rows}</div>`;
    };

    const assetSections = fin.assetCats
      .map((cat) => {
        const items = fin.assets.filter((a) => a.category === cat.id);
        if (items.length === 0) return "";
        return bsSection(cat, items, items.reduce((s, a) => s + assetEffectiveValue(a), 0));
      })
      .join("");

    const liabSections = fin.liabCats
      .map((cat) => {
        const items = fin.liabilities.filter((l) => l.category === cat.id);
        if (items.length === 0) return "";
        return bsSection(cat, items, items.reduce((s, l) => s + (Number(l.value) || 0), 0));
      })
      .join("");

    // Open AP/AR (managed on the Cash flow tab) shown as current items.
    const isOpenAsOf = (x) => !x.paid_date || String(x.paid_date).slice(0, 7) > m;
    const aparRows = (kind, fallback) =>
      fin.apar
        .filter((x) => x.kind === kind && isOpenAsOf(x))
        .map(
          (x) => `
          <div class="fin-row readonly">
            <span class="f-name" style="flex:1.4;font-size:14px;">${escapeHtml(x.name || fallback)}</span>
            <span class="fx-col">due ${escapeHtml(x.due_date || "—")}</span>
            <span class="row-amount">${currency(x.amount)}</span>
          </div>`
        )
        .join("");
    const arSection = nw.apar.ar
      ? `<div class="fin-section">
          <div class="fin-section-heading"><span>Accounts Receivable (current asset)</span><span class="subtotal">${currency(nw.apar.ar)}</span></div>
          <div class="fin-note">Open invoices owed to you — manage them on the Cash tab.</div>
          ${aparRows("ar", "Invoice")}
        </div>`
      : "";
    const apSection = nw.apar.ap
      ? `<div class="fin-section">
          <div class="fin-section-heading"><span>Accounts Payable (current liability)</span><span class="subtotal">${currency(nw.apar.ap)}</span></div>
          <div class="fin-note">Open bills you owe — manage them on the Cash tab.</div>
          ${aparRows("ap", "Bill")}
        </div>`
      : "";

    return `
      ${exportRowHtml()}
      <div class="fin-card" id="assetsCard">
        <div class="fin-card-title">Assets <button class="snapshot-btn" id="editAssetCatsBtn">✏️ Categories</button></div>
        ${assetSections || '<div class="fin-note">No assets yet.</div>'}
        ${fixedSection}
        ${arSection}
        <button class="fin-add-btn" id="addAssetBtn">+ Add Asset</button>
        <div class="fin-totals"><span>Total Assets</span><span class="value">${currency(nw.totalAssets)}</span></div>
      </div>

      <div class="fin-card" id="liabCard">
        <div class="fin-card-title">Liabilities <button class="snapshot-btn" id="editLiabCatsBtn">✏️ Categories</button></div>
        ${liabSections || '<div class="fin-note">No liabilities yet.</div>'}
        ${apSection}
        <button class="fin-add-btn" id="addLiabilityBtn">+ Add Liability</button>
        <div class="fin-totals"><span>Total Liabilities</span><span class="value">${currency(nw.totalLiabilities)}</span></div>
      </div>

      <div class="fin-card">
        <div class="fin-totals" style="border-top:none;margin-top:0;padding-top:0;">
          <span>Net Worth</span>
          <span class="value ${signClass(nw.netWorth)}">${currency(nw.netWorth)}</span>
        </div>
      </div>
    `;
  }

  function wireBalance() {
    wireFinRows(document.getElementById("assetsCard"), "assets", ["value"], "assets");
    wireFinRows(document.getElementById("liabCard"), "liabilities", ["value"], "liabilities");

    document.getElementById("editAssetCatsBtn").addEventListener("click", () => openBsCatSheet("asset"));
    document.getElementById("editLiabCatsBtn").addEventListener("click", () => openBsCatSheet("liability"));

    document.getElementById("addAssetBtn").addEventListener("click", () => {
      openFinSheet({
        title: "Add asset",
        chips: { label: "Category", options: fin.assetCats.map((c) => ({ id: c.id, label: c.label })) },
        fields: [
          { key: "name", label: "Name", placeholder: "e.g. CIB account" },
          { key: "value", label: "Value (E£)", type: "num", placeholder: "0" },
        ],
        onSave: async (cat, values) => {
          await finApi("assets", { method: "POST", body: JSON.stringify({ category: cat.id, ...values }) });
          await reloadFin("assets");
        },
      });
    });

    document.getElementById("addLiabilityBtn").addEventListener("click", () => {
      openFinSheet({
        title: "Add liability",
        chips: { label: "Category", options: fin.liabCats.map((c) => ({ id: c.id, label: c.label })) },
        fields: [
          { key: "name", label: "Name", placeholder: "e.g. Car loan" },
          { key: "value", label: "Value (E£)", type: "num", placeholder: "0" },
        ],
        onSave: async (cat, values) => {
          await finApi("liabilities", { method: "POST", body: JSON.stringify({ category: cat.id, ...values }) });
          await reloadFin("liabilities");
        },
      });
    });
  }

  // ---------- P&L ----------
  function renderPnl() {
    const r = periodRange(fin.pnlPeriod);
    const inRange = (mm) => inPeriod(r, mm);

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

    const incomeSections = incomeCats
      .map((cat) => {
        const items = incomeItems.filter((i) => i.category === cat.id);
        const logAmt = logTotals[cat.id] || 0;
        if (items.length === 0 && logAmt === 0) return "";
        const subtotal = items.reduce((s, i) => s + (Number(i.value) || 0), 0) + logAmt;
        const logRow = logAmt
          ? `<div class="fin-row readonly">
              <span style="font-size:16px;">${escapeHtml(cat.emoji)}</span>
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
        return `<div class="fin-section"><div class="fin-section-heading"><span>${escapeHtml(cat.label)}</span><span class="subtotal">${currency(subtotal)}</span></div>${logRow}${rows}</div>`;
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
          <span class="f-name" style="flex:1.4;font-size:14px;">${escapeHtml(catDisplayLabel(c))}</span>
          <span class="row-amount">${currency(v)}</span>
        </div>`;
      })
      .join("");

    // ---- depreciation (straight-line, per item from its purchase date) ----
    const depPeriod = fin.depitems.reduce((s, it) => s + itemDepForRange(it, r), 0);
    const depSections = fin.depcats
      .map((cat) => {
        const items = fin.depitems.filter((it) => it.category === cat.id);
        if (items.length === 0) return "";
        const subtotal = items.reduce((s, it) => s + itemDepForRange(it, r), 0);
        const rows = items
          .map((it) =>
            finRowHtml(it, {
              fields: [
                { key: "name", cls: "f-name", placeholder: "Item" },
                { key: "cost", cls: "f-num", num: true, placeholder: "Cost" },
                { key: "date", cls: "f-date", date: true },
                { type: "label", value: itemDepForRange(it, r) },
              ],
            })
          )
          .join("");
        return `<div class="fin-section"><div class="fin-section-heading"><span>${escapeHtml(cat.label)} · ${Number(cat.years) || 0} yrs</span><span class="subtotal">${currency(subtotal)}</span></div>${rows}</div>`;
      })
      .join("");

    const netPL = totalIncome - totalExpense - depPeriod;

    // ---- ratios: GP, GP%, EBITDA, EBIT, EBT, net after tax ----
    // Interest (the 'interest' category) sits below EBIT, unless the user
    // explicitly marked it as a direct cost.
    const cogsSet = new Set(fin.settings.cogsCategories || []);
    const cogs = Object.entries(expTotals).reduce((s, [id, v]) => s + (cogsSet.has(id) ? v : 0), 0);
    const interest = cogsSet.has("interest") ? 0 : expTotals.interest || 0;
    const opex = totalExpense - cogs - interest;
    const grossProfit = totalIncome - cogs;
    const ebitda = grossProfit - opex;
    const ebit = ebitda - depPeriod;
    const ebt = ebit - interest;
    const pct = (v) => (totalIncome > 0 ? (v / totalIncome) * 100 : 0);
    const fmtPct = (v) => pct(v).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%";
    const taxRate = Number(fin.settings.taxRate) || 0;
    const tax = ebt > 0 ? ebt * (taxRate / 100) : 0;
    const netAfterTax = ebt - tax;

    return `
      ${exportRowHtml()}
      ${periodSelectHtml("pnlPeriod", r)}

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

      <div class="fin-card" id="depCard">
        <div class="fin-card-title">Depreciation <button class="snapshot-btn" id="editDepCatsBtn">✏️ Categories</button></div>
        <div class="fin-note">Straight-line from each item's purchase date: cost ÷ (years × 12) per month. Amounts shown are this period's share.</div>
        ${depSections || '<div class="fin-note">No depreciable items yet — add furniture, laptops, equipment…</div>'}
        <button class="fin-add-btn" id="addDepItemBtn">+ Add Item</button>
        <div class="fin-totals"><span>Total Depreciation</span><span class="value neg">${currency(depPeriod)}</span></div>
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
        <div class="ratio-row"><span>EBITDA</span><span class="value ${signClass(ebitda)}">${currency(ebitda)} · ${fmtPct(ebitda)}</span></div>
        <div class="ratio-row"><span>Depreciation</span><span class="value">${currency(depPeriod)}</span></div>
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
    document.getElementById("pnlPeriod").addEventListener("change", (e) => { fin.pnlPeriod = e.target.value; renderFin(); });
    wireFinRows(document.getElementById("incomeCard"), "income", ["value"], "income");
    wireFinRows(document.getElementById("depCard"), "depitems", ["cost"], "depitems");

    document.getElementById("editDepCatsBtn").addEventListener("click", openDepCatSheet);
    document.getElementById("addDepItemBtn").addEventListener("click", () => {
      if (fin.depcats.length === 0) {
        openDepCatSheet();
        return;
      }
      openFinSheet({
        title: "Add depreciation item",
        chips: {
          label: "Category",
          options: fin.depcats.map((c) => ({ id: c.id, label: `${c.label} · ${Number(c.years) || 0}y` })),
        },
        fields: [
          { key: "name", label: "Item", placeholder: "e.g. MacBook Pro" },
          { key: "cost", label: "Cost (E£)", type: "num", placeholder: "0" },
          { key: "date", label: "Purchase date", type: "date", value: todayStr() },
        ],
        onSave: async (cat, values) => {
          await finApi("depitems", { method: "POST", body: JSON.stringify({ category: cat.id, ...values }) });
          await reloadFin("depitems");
        },
      });
    });

    document.getElementById("taxRateInput").addEventListener("change", (e) => {
      const v = Math.min(100, Math.max(0, Number(e.target.value) || 0));
      saveFinSettings({ taxRate: v });
    });

    const cogsSet = new Set(fin.settings.cogsCategories || []);
    renderChipGrid(
      document.getElementById("cogsGrid"),
      cats.filter((c) => !c.deleted),
      (cat) => cogsSet.has(cat.id),
      (cat) => {
        if (cogsSet.has(cat.id)) cogsSet.delete(cat.id);
        else cogsSet.add(cat.id);
        saveFinSettings({ cogsCategories: [...cogsSet] });
      }
    );

  }

  // ---------- depreciation category editor ----------
  const DEP_YEARS_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25, 30];
  const depCatSheetOverlay = document.getElementById("depCatSheetOverlay");
  const depCatListEl = document.getElementById("depCatList");

  function openDepCatSheet() {
    renderDepCatRows();
    depCatSheetOverlay.classList.add("open");
  }

  function closeDepCatSheet() {
    depCatSheetOverlay.classList.remove("open");
    renderFin();
    // Refresh the chip grid if the Add Expense sheet is behind in asset mode.
    if (assetMode && sheetOverlay.classList.contains("open")) renderDepCategoryGrid();
  }

  function renderDepCatRows() {
    depCatListEl.innerHTML = "";
    fin.depcats.forEach((cat) => {
      const years = Number(cat.years) || 5;
      const opts = DEP_YEARS_OPTIONS.includes(years) ? DEP_YEARS_OPTIONS : [...DEP_YEARS_OPTIONS, years].sort((a, b) => a - b);
      const row = document.createElement("div");
      row.className = "cat-row";
      row.innerHTML = `
        <input class="cat-label" value="${escAttr(cat.label)}" maxlength="24" aria-label="Name" />
        <select class="dep-years" aria-label="Useful life">
          ${opts.map((y) => `<option value="${y}" ${years === y ? "selected" : ""}>${y} yr${y > 1 ? "s" : ""}</option>`).join("")}
        </select>
        <button class="row-del">✕</button>
      `;

      async function saveDepCat(fields) {
        try {
          await finApi(`depcats/${encodeURIComponent(cat.id)}`, { method: "PUT", body: JSON.stringify(fields) });
          await reloadFin("depcats");
        } catch {
          alert("Couldn't save — check your connection.");
        }
        renderDepCatRows();
      }

      row.querySelector(".cat-label").addEventListener("change", (e) => {
        if (e.target.value.trim()) saveDepCat({ label: e.target.value.trim() });
        else renderDepCatRows();
      });
      row.querySelector(".dep-years").addEventListener("change", (e) => saveDepCat({ years: Number(e.target.value) }));
      row.querySelector(".row-del").addEventListener("click", async () => {
        const count = fin.depitems.filter((it) => it.category === cat.id).length;
        if (!confirm(`Delete "${cat.label}"?${count ? `\n${count} item(s) in it will be removed too.` : ""}`)) return;
        try {
          await finApi(`depcats/${encodeURIComponent(cat.id)}`, { method: "DELETE" });
          await Promise.all([reloadFin("depcats"), reloadFin("depitems")]);
        } catch {
          alert("Couldn't delete — check your connection.");
        }
        renderDepCatRows();
      });

      depCatListEl.appendChild(row);
    });
  }

  document.getElementById("addDepCatBtn").addEventListener("click", async () => {
    try {
      await finApi("depcats", { method: "POST", body: JSON.stringify({ label: "New category", years: 5 }) });
      await reloadFin("depcats");
    } catch {
      alert("Couldn't add — check your connection.");
    }
    renderDepCatRows();
  });
  document.getElementById("depCatCloseBtn").addEventListener("click", closeDepCatSheet);
  depCatSheetOverlay.addEventListener("click", (e) => {
    if (e.target === depCatSheetOverlay) closeDepCatSheet();
  });

  // ---------- balance-sheet category editor (assets & liabilities) ----------
  const bsCatSheetOverlay = document.getElementById("bsCatSheetOverlay");
  const bsCatListEl = document.getElementById("bsCatList");
  const bsCatTitle = document.getElementById("bsCatTitle");
  let bsCatKind = "asset";

  function bsCatsOfKind() {
    return bsCatKind === "asset" ? fin.assetCats : fin.liabCats;
  }

  function bsItemsOfKind() {
    return bsCatKind === "asset" ? fin.assets : fin.liabilities;
  }

  function openBsCatSheet(kind) {
    bsCatKind = kind;
    bsCatTitle.textContent = kind === "asset" ? "Asset categories" : "Liability categories";
    renderBsCatRows();
    bsCatSheetOverlay.classList.add("open");
  }

  function closeBsCatSheet() {
    bsCatSheetOverlay.classList.remove("open");
    renderFin();
  }

  function renderBsCatRows() {
    bsCatListEl.innerHTML = "";
    bsCatsOfKind().forEach((cat) => {
      const row = document.createElement("div");
      row.className = "cat-row";
      row.innerHTML = `
        <input class="cat-label" value="${escAttr(cat.label)}" maxlength="24" aria-label="Name" ${cat.id === "Other" ? "disabled" : ""} />
        ${cat.id === "Other" ? '<span class="cat-lock" title="Permanent">🔒</span>' : '<button class="row-del">✕</button>'}
      `;

      row.querySelector(".cat-label").addEventListener("change", async (e) => {
        const label = e.target.value.trim();
        if (!label) return renderBsCatRows();
        try {
          await finApi(`bscats/${encodeURIComponent(cat.id)}?kind=${bsCatKind}`, { method: "PUT", body: JSON.stringify({ label }) });
          await reloadBsCats(bsCatKind);
        } catch {
          alert("Couldn't save — check your connection.");
        }
        renderBsCatRows();
      });

      const del = row.querySelector(".row-del");
      if (del) {
        del.addEventListener("click", async () => {
          const count = bsItemsOfKind().filter((it) => it.category === cat.id).length;
          if (!confirm(`Delete "${cat.label}"?${count ? `\n${count} item(s) in it will move to Other.` : ""}`)) return;
          try {
            await finApi(`bscats/${encodeURIComponent(cat.id)}?kind=${bsCatKind}`, { method: "DELETE" });
            await Promise.all([reloadBsCats(bsCatKind), reloadFin(bsCatKind === "asset" ? "assets" : "liabilities")]);
          } catch {
            alert("Couldn't delete — check your connection.");
          }
          renderBsCatRows();
        });
      }

      bsCatListEl.appendChild(row);
    });
  }

  document.getElementById("addBsCatBtn").addEventListener("click", async () => {
    try {
      await finApi(`bscats?kind=${bsCatKind}`, { method: "POST", body: JSON.stringify({ label: "New category" }) });
      await reloadBsCats(bsCatKind);
    } catch {
      alert("Couldn't add — check your connection.");
    }
    renderBsCatRows();
  });
  document.getElementById("bsCatCloseBtn").addEventListener("click", closeBsCatSheet);
  bsCatSheetOverlay.addEventListener("click", (e) => {
    if (e.target === bsCatSheetOverlay) closeBsCatSheet();
  });

  // ---------- CASH FLOW ----------
  function renderCashflow() {
    const m = monthStr(viewDate);
    const r = periodRange(fin.cfPeriod);
    const filtered = fin.cf.filter((c) => inPeriod(r, c.month));

    // Indirect method: operating starts from the period's net income (which
    // already includes depreciation as an expense) and adds the non-cash
    // depreciation back; fixed-asset purchases hit investing in full.
    const periodIncome =
      fin.income.filter((i) => inPeriod(r, i.month)).reduce((s, i) => s + (Number(i.value) || 0), 0) +
      incomes.filter((i) => inPeriod(r, i.date.slice(0, 7))).reduce((s, i) => s + (Number(i.amount) || 0), 0);
    const periodSpent = expenses
      .filter((e) => inPeriod(r, e.date.slice(0, 7)))
      .reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const periodDep = fin.depitems.reduce((s, it) => s + itemDepForRange(it, r), 0);
    const netIncome = periodIncome - periodSpent - periodDep;

    const autoRows = {
      operating: [
        { name: "Net Profit / Loss (from P&L)", value: netIncome },
        { name: "Depreciation add-back (non-cash)", value: periodDep },
      ],
      investing: investingRowsForPeriod(r).map((row) => ({ name: `Asset purchase — ${row.name}`, value: row.value })),
      financing: [],
    };

    const sectionDefs = [
      { key: "operating", label: "Operating Activities" },
      { key: "investing", label: "Investing Activities" },
      { key: "financing", label: "Financing Activities" },
    ];

    let netCF = 0;
    const sections = sectionDefs
      .map((def) => {
        const items = filtered.filter((c) => c.section === def.key);
        const autos = autoRows[def.key];
        const subtotal =
          items.reduce((s, c) => s + (Number(c.value) || 0), 0) + autos.reduce((s, a) => s + a.value, 0);
        netCF += subtotal;
        const autoHtml = autos
          .map(
            (a) => `
              <div class="fin-row readonly">
                <span class="f-name" style="flex:1.4;font-size:14px;">${escapeHtml(a.name)}</span>
                <span class="row-amount ${signClass(a.value)}">${currency(a.value)}</span>
              </div>`
          )
          .join("");
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
            ${autoHtml}
            ${rows}
            <button class="fin-add-btn add-cf" data-section="${def.key}">+ Add ${def.label.split(" ")[0]}</button>
          </div>`;
      })
      .join("");

    const cash = endingCashBalance(m);

    return `
      ${exportRowHtml()}
      ${periodSelectHtml("cfPeriod", r)}

      <div class="fin-card" id="cfCard">
        <div class="setting-row">
          <label>Starting Cash (E£)</label>
          <input id="startingCash" type="number" inputmode="decimal" value="${escAttr(fin.settings.startingCash)}" />
        </div>
        <div class="fin-note">Net P&L, the depreciation add-back, and fixed-asset purchases flow in automatically from your logs; add any other cash movements manually.</div>
        ${sections}
        <div class="fin-totals"><span>Net Cash Flow</span><span class="value ${signClass(netCF)}">${currency(netCF)}</span></div>
        <div class="fin-totals" style="border-top:none;padding-top:4px;"><span>Ending Cash Balance</span><span class="value ${signClass(cash)}">${currency(cash)}</span></div>
      </div>
    `;
  }

  // Edit or delete an open payable/receivable from its list row (their only
  // management surface now that the Cash tab card is gone).
  function openAparSheet(item) {
    const isAr = item.kind === "ar";
    const opts = (isAr ? incomeCats : cats).map((c) => ({ id: c.id, label: c.label, emoji: c.emoji }));
    openFinSheet({
      title: isAr ? "Edit expected income" : "Edit payable",
      chips: { label: "Category", options: opts, selected: opts.find((c) => c.id === item.category) || null },
      fields: [
        { key: "name", label: "Description", placeholder: isAr ? "e.g. Client invoice" : "e.g. Supplier bill", value: item.name || "" },
        { key: "amount", label: "Amount (E£)", type: "num", placeholder: "0", value: item.amount },
        { key: "due_date", label: "Due date", type: "date", value: item.due_date || todayStr() },
      ],
      onSave: async (cat, values) => {
        await finApi(`apar/${encodeURIComponent(item.id)}`, {
          method: "PUT",
          body: JSON.stringify({ name: values.name, amount: values.amount, due_date: values.due_date, category: cat.id }),
        });
        await reloadFin("apar");
      },
      onDelete: async () => {
        if (!confirm(`Delete this ${isAr ? "expected income" : "payable"}?\n${currency(item.amount)}${item.name ? " · " + item.name : ""}`)) return false;
        await finApi(`apar/${encodeURIComponent(item.id)}`, { method: "DELETE" });
        await reloadFin("apar");
      },
    });
  }

  // Paying/reopening an AP/AR item also creates/removes the linked income or
  // expense entry server-side, so refresh those logs too before re-rendering.
  // Shared by the ✓ tick on the Spend and Income list pages.
  async function aparLifecycle(id, action) {
    try {
      await finApi(`apar/${encodeURIComponent(id)}/${action}`, { method: "POST" });
      await Promise.all([
        reloadFin("apar"),
        (async () => {
          try {
            incomes = await apiFetchIncomes(syncCode);
            writeIncomeCache(syncCode, incomes);
          } catch {}
        })(),
        (async () => {
          try {
            expenses = await apiFetchExpenses(syncCode);
            writeCache(syncCode, expenses);
          } catch {}
        })(),
      ]);
    } catch {
      alert("Couldn't save — check your connection.");
    }
    renderAll();
  }

  function wireCashflow() {
    document.getElementById("cfPeriod").addEventListener("change", (e) => { fin.cfPeriod = e.target.value; renderFin(); });
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

  // "Asset" mode inside the Add Expense sheet: instead of a spend entry the
  // save creates a fixed asset (depreciation item). The purchase never hits
  // the spend list — only its monthly depreciation slices do, later.
  // "Payable" mode instead creates an open AP item (accounts payable) — the
  // chosen category rides along and is applied to the expense/spend entry
  // created later when the payable is marked paid. The two toggles are
  // independent and combinable: asset+payable together buys a fixed asset
  // on credit (see the saveBtn handler's "both" branch).
  let assetMode = false;
  let payableMode = false;
  let selectedDepCat = null;
  const assetToggle = document.getElementById("assetToggle");
  const assetToggleField = document.getElementById("assetToggleField");
  const payableToggle = document.getElementById("payableToggle");
  const payableToggleField = document.getElementById("payableToggleField");
  const depOptionsField = document.getElementById("depOptionsField");
  const depCategoryGrid = document.getElementById("depCategoryGrid");
  const dateLabel = document.getElementById("dateLabel");
  const dueDateField = document.getElementById("dueDateField");
  const dueDateInput = document.getElementById("dueDateInput");

  function renderDepCategoryGrid() {
    if (fin.depcats.length === 0) {
      depCategoryGrid.innerHTML = '<div class="fin-note">Couldn\'t load depreciation categories — check your connection.</div>';
      return;
    }
    if (!selectedDepCat || !fin.depcats.some((c) => c.id === selectedDepCat)) {
      selectedDepCat = fin.depcats[0].id;
    }
    renderChipGrid(
      depCategoryGrid,
      fin.depcats.map((c) => ({ id: c.id, label: `${c.label} · ${Number(c.years) || 0}y` })),
      (opt) => opt.id === selectedDepCat,
      (opt) => {
        selectedDepCat = opt.id;
        renderDepCategoryGrid();
      }
    );
  }

  function updateAssetModeUI() {
    assetToggle.classList.toggle("active", assetMode);
    payableToggle.classList.toggle("active", payableMode);
    const both = assetMode && payableMode;
    // Payable-only mode keeps the category grid — the chosen category is
    // stored on the payable and applied when it's later marked paid. Asset
    // mode (alone or combined with payable) swaps in the dep-category grid.
    document.getElementById("expenseCategoryField").style.display = assetMode ? "none" : "";
    depOptionsField.style.display = assetMode ? "" : "none";
    // The combined state needs its own due date: the main date field anchors
    // depreciation (invoice/purchase date) and can't double as the due date.
    dueDateField.style.display = both ? "" : "none";
    dateLabel.textContent = assetMode ? "Invoice date" : payableMode ? "Due date" : "Invoice date";
    noteInput.placeholder = assetMode ? "e.g. MacBook Pro" : payableMode ? "e.g. Supplier bill" : "e.g. Coffee with Sam";
    if (assetMode) renderDepCategoryGrid();
  }

  assetToggle.addEventListener("click", () => {
    assetMode = !assetMode;
    updateAssetModeUI();
  });

  payableToggle.addEventListener("click", () => {
    payableMode = !payableMode;
    updateAssetModeUI();
  });

  document.getElementById("editDepCatsFromSheetBtn").addEventListener("click", openDepCatSheet);

  function openSheet(expense) {
    editingExpenseId = expense ? expense.id : null;
    selectedCategory = expense ? expense.category : null;
    amountInput.value = expense ? expense.amount : "";
    noteInput.value = expense ? expense.note || "" : "";
    dateInput.value = expense ? expense.date : todayStr();
    dueDateInput.value = todayStr();
    sheetTitle.textContent = expense ? "Edit expense" : "Add expense";
    deleteExpenseBtn.style.display = expense ? "block" : "none";
    // Existing expenses can't be converted in place — the toggles only show
    // when adding something new.
    assetMode = false;
    payableMode = false;
    assetToggleField.style.display = expense ? "none" : "";
    payableToggleField.style.display = expense ? "none" : "";
    updateAssetModeUI();
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
    const date = dateInput.value || todayStr();
    const note = noteInput.value.trim();

    if (assetMode && payableMode) {
      if (!selectedDepCat) return;
      saveBtn.disabled = true;
      try {
        await finApi("asset-purchase", {
          method: "POST",
          body: JSON.stringify({ category: selectedDepCat, name: note, cost: amount, date, due_date: dueDateInput.value || todayStr() }),
        });
        await Promise.all([reloadFin("depitems"), reloadFin("apar")]);
        closeSheet();
        renderAll();
        setSyncStatus("online");
        alert("Added to Fixed Assets with an open payable.\nDepreciation starts the month after the invoice date; cash leaves when you mark the payable paid.");
      } catch {
        setSyncStatus("offline");
        alert("Couldn't save — check your connection and try again.");
      } finally {
        saveBtn.disabled = false;
      }
      return;
    }

    if (assetMode) {
      if (!selectedDepCat) return;
      saveBtn.disabled = true;
      try {
        await finApi("depitems", { method: "POST", body: JSON.stringify({ category: selectedDepCat, name: note, cost: amount, date }) });
        await reloadFin("depitems");
        closeSheet();
        renderAll();
        setSyncStatus("online");
        alert("Added to Fixed Assets on the Balance Sheet.\nDepreciation starts the month after the purchase date and will show as the 🏭 Depreciation category.");
      } catch {
        setSyncStatus("offline");
        alert("Couldn't save — check your connection and try again.");
      } finally {
        saveBtn.disabled = false;
      }
      return;
    }

    if (payableMode) {
      if (!selectedCategory) return;
      saveBtn.disabled = true;
      try {
        await finApi("apar", {
          method: "POST",
          body: JSON.stringify({ kind: "ap", name: note, amount, due_date: date, category: selectedCategory }),
        });
        await reloadFin("apar");
        closeSheet();
        renderAll();
        setSyncStatus("online");
      } catch {
        setSyncStatus("offline");
        alert("Couldn't save — check your connection and try again.");
      } finally {
        saveBtn.disabled = false;
      }
      return;
    }

    if (!selectedCategory) {
      return;
    }

    // Optimistic: the expense shows instantly and syncs in the background,
    // so a cold-starting server never blocks the sheet. The receipt input was
    // removed from the sheet; preserve an edited expense's existing receipt
    // value instead of wiping it, new entries just have none.
    const editingId = editingExpenseId;
    const prevExpense = editingId ? expenses.find((x) => x.id === editingId) : null;
    const payload = { amount, category: selectedCategory, note, date, receipt: prevExpense ? prevExpense.receipt || "" : "" };
    const tempId = "tmp" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const before = prevExpense;
    if (editingId) {
      expenses = expenses.map((x) => (x.id === editingId ? { ...x, ...payload } : x));
    } else {
      expenses.push({ id: tempId, createdAt: Date.now(), ...payload });
    }
    writeCache(syncCode, expenses);
    closeSheet();
    renderAll();
    syncExpenseEntry(editingId, tempId, payload, before);
  });

  // Background sync for optimistic expense saves; rolls back and warns if
  // the server rejects it.
  async function syncExpenseEntry(editingId, tempId, payload, before) {
    try {
      if (editingId) {
        const updated = await apiUpdateExpense(syncCode, editingId, payload);
        expenses = expenses.map((x) => (x.id === editingId ? { ...x, ...updated } : x));
      } else {
        const created = await apiAddExpense(syncCode, payload);
        expenses = expenses.map((x) => (x.id === tempId ? created : x));
      }
      writeCache(syncCode, expenses);
      setSyncStatus("online");
    } catch {
      if (editingId && before) expenses = expenses.map((x) => (x.id === editingId ? before : x));
      else expenses = expenses.filter((x) => x.id !== tempId);
      writeCache(syncCode, expenses);
      setSyncStatus("offline");
      alert("Couldn't sync that expense — check your connection. The change was undone.");
    }
    renderAll();
  }

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
    cats.filter((c) => !c.deleted).forEach((cat) => {
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
          if (!confirm(`Delete "${cat.label}"?\nIts expenses stay in your history, shown as "${cat.label} · deleted".`)) return;
          try {
            await catsApi(`/${encodeURIComponent(cat.id)}`, { method: "DELETE" });
            await loadCats();
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

  // ---- income category editor sheet ----
  const incCatSheetOverlay = document.getElementById("incCatSheetOverlay");
  const incCatListEl = document.getElementById("incCatList");

  function openIncCatSheet() {
    renderIncCatRows();
    incCatSheetOverlay.classList.add("open");
  }

  function closeIncCatSheet() {
    incCatSheetOverlay.classList.remove("open");
    renderAll();
  }

  function renderIncCatRows() {
    incCatListEl.innerHTML = "";
    incomeCats.forEach((cat) => {
      const row = document.createElement("div");
      row.className = "cat-row";
      row.innerHTML = `
        <button class="cat-color-dot" style="background:${escAttr(cat.color)}" aria-label="Change color"></button>
        <input class="cat-emoji" value="${escAttr(cat.emoji)}" maxlength="4" aria-label="Emoji" />
        <input class="cat-label" value="${escAttr(cat.label)}" maxlength="24" aria-label="Name" />
        ${cat.id === "Other Income" ? '<span class="cat-lock" title="Permanent">🔒</span>' : '<button class="row-del">✕</button>'}
      `;

      async function saveIncCat(fields) {
        try {
          await finApi(`inccats/${encodeURIComponent(cat.id)}`, { method: "PUT", body: JSON.stringify(fields) });
          await loadIncCats();
        } catch {
          alert("Couldn't save — check your connection.");
        }
        renderIncCatRows();
      }

      row.querySelector(".cat-color-dot").addEventListener("click", () => {
        const idx = CAT_PALETTE.indexOf(cat.color);
        saveIncCat({ color: CAT_PALETTE[(idx + 1) % CAT_PALETTE.length] });
      });
      row.querySelector(".cat-emoji").addEventListener("change", (e) => saveIncCat({ emoji: e.target.value }));
      row.querySelector(".cat-label").addEventListener("change", (e) => {
        if (e.target.value.trim()) saveIncCat({ label: e.target.value.trim() });
        else renderIncCatRows();
      });

      const del = row.querySelector(".row-del");
      if (del) {
        del.addEventListener("click", async () => {
          if (!confirm(`Delete "${cat.label}"?\nAny income entries in it will move to Other.`)) return;
          try {
            await finApi(`inccats/${encodeURIComponent(cat.id)}`, { method: "DELETE" });
            await Promise.all([
              loadIncCats(),
              reloadFin("income"),
              (async () => {
                try {
                  incomes = await apiFetchIncomes(syncCode);
                  writeIncomeCache(syncCode, incomes);
                } catch {
                  /* keep cached list */
                }
              })(),
            ]);
          } catch {
            alert("Couldn't delete — check your connection.");
          }
          renderIncCatRows();
        });
      }

      incCatListEl.appendChild(row);
    });
  }

  document.getElementById("addIncCatBtn").addEventListener("click", async () => {
    try {
      await finApi("inccats", {
        method: "POST",
        body: JSON.stringify({ label: "New category", emoji: "🏷️", color: CAT_PALETTE[incomeCats.length % CAT_PALETTE.length] }),
      });
      await loadIncCats();
    } catch {
      alert("Couldn't add — check your connection.");
    }
    renderIncCatRows();
  });
  document.getElementById("incCatCloseBtn").addEventListener("click", closeIncCatSheet);
  incCatSheetOverlay.addEventListener("click", (e) => {
    if (e.target === incCatSheetOverlay) closeIncCatSheet();
  });

  // ---- appearance (light/dark + larger text) ----
  // The saved classes are applied to <html> before first paint by an inline
  // script in index.html; these buttons just toggle and persist them.
  const THEME_KEY = "expenses:theme";
  const BIG_TEXT_KEY = "expenses:bigText";
  const themeToggle = document.getElementById("themeToggle");
  const textSizeToggle = document.getElementById("textSizeToggle");
  const themeColorMeta = document.getElementById("themeColorMeta");

  function syncAppearanceUI() {
    const light = document.documentElement.classList.contains("light");
    themeToggle.textContent = light ? "🌙" : "☀️";
    themeColorMeta.setAttribute("content", light ? "#f4f5f9" : "#0f0f14");
    const level = document.documentElement.classList.contains("big-text-2") ? 2 : document.documentElement.classList.contains("big-text") ? 1 : 0;
    textSizeToggle.classList.toggle("active", level > 0);
    textSizeToggle.textContent = level === 2 ? "Aa++" : level === 1 ? "Aa+" : "Aa";
  }

  themeToggle.addEventListener("click", () => {
    const light = document.documentElement.classList.toggle("light");
    localStorage.setItem(THEME_KEY, light ? "light" : "dark");
    syncAppearanceUI();
  });

  // Cycles normal → +15% → +30% → normal.
  textSizeToggle.addEventListener("click", () => {
    const root = document.documentElement;
    const level = root.classList.contains("big-text-2") ? 0 : root.classList.contains("big-text") ? 2 : 1;
    root.classList.toggle("big-text", level === 1);
    root.classList.toggle("big-text-2", level === 2);
    localStorage.setItem(BIG_TEXT_KEY, String(level));
    syncAppearanceUI();
  });

  syncAppearanceUI();

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

  backupBtn.addEventListener("click", () => {
    if (!syncCode) return;
    window.open("/api/export/json?code=" + encodeURIComponent(syncCode), "_blank");
  });

  document.getElementById("joinCodeBtn").addEventListener("click", async () => {
    const code = joinCodeInput.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{6,16}$/.test(code)) {
      alert("Codes are 6–16 letters/numbers. Check the code and try again.");
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
      loadIncCats(),
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
