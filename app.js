(function () {
  "use strict";

  const CATEGORIES = [
    { id: "food", label: "Food", emoji: "🍔", color: "var(--food)" },
    { id: "transport", label: "Transport", emoji: "🚗", color: "var(--transport)" },
    { id: "bills", label: "Bills", emoji: "🧾", color: "var(--bills)" },
    { id: "shopping", label: "Shopping", emoji: "🛍️", color: "var(--shopping)" },
    { id: "entertainment", label: "Fun", emoji: "🎬", color: "var(--entertainment)" },
    { id: "other", label: "Other", emoji: "📦", color: "var(--other)" },
  ];

  const CODE_KEY = "expenses:syncCode";
  const CACHE_PREFIX = "expenses:cache:";

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

  async function apiDeleteExpense(code, id) {
    const res = await fetch(`/api/expenses/${encodeURIComponent(id)}?code=${encodeURIComponent(code)}`, {
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

  let syncCode = localStorage.getItem(CODE_KEY) || "";
  let expenses = syncCode ? readCache(syncCode) : [];
  let viewDate = new Date();
  viewDate.setDate(1);
  let selectedCategory = null;
  let activeTab = "expenses";

  const fin = {
    loaded: false,
    failed: false,
    settings: { exchangeRate: 47.5, startingCash: 0, unanimValuation: 0, unanimOwnership: 0 },
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

  function renderCategoryGrid() {
    categoryGrid.innerHTML = "";
    CATEGORIES.forEach((cat) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "category-chip" + (selectedCategory === cat.id ? " selected" : "");
      chip.innerHTML = `<span class="chip-emoji">${cat.emoji}</span><span>${cat.label}</span>`;
      chip.addEventListener("click", () => {
        selectedCategory = cat.id;
        renderCategoryGrid();
      });
      categoryGrid.appendChild(chip);
    });
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

    const active = CATEGORIES.filter((c) => totalsByCat[c.id] > 0)
      .sort((a, b) => totalsByCat[b.id] - totalsByCat[a.id]);

    if (active.length === 0) {
      chartCard.classList.add("hidden");
      return;
    }
    chartCard.classList.remove("hidden");

    barsEl.innerHTML = "";
    active.forEach((cat) => {
      const amount = totalsByCat[cat.id];
      const pct = grandTotal > 0 ? (amount / grandTotal) * 100 : 0;
      const row = document.createElement("div");
      row.className = "bar-row";
      row.innerHTML = `
        <span class="bar-dot" style="background:${cat.color}"></span>
        <span class="bar-label">${cat.label}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${pct}%;background:${cat.color}"></span></span>
        <span class="bar-amount">${currency(amount)}</span>
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

      const heading = document.createElement("div");
      heading.className = "day-heading";
      heading.textContent = formatDayHeading(date);
      group.appendChild(heading);

      items.forEach((e) => {
        const cat = CATEGORIES.find((c) => c.id === e.category) || CATEGORIES[CATEGORIES.length - 1];
        const item = document.createElement("div");
        item.className = "expense-item";
        item.dataset.id = e.id;
        item.innerHTML = `
          <button class="delete-btn">Delete</button>
          <div class="swipe-content">
            <div class="expense-icon" style="background:${cat.color}22;color:${cat.color}">${cat.emoji}</div>
            <div class="expense-meta">
              <div class="expense-category">${cat.label}</div>
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

        // Tap an expense to delete it (with confirmation), no swipe required.
        content.addEventListener("click", () => {
          if (item.classList.contains("swiped")) {
            item.classList.remove("swiped");
            return;
          }
          const label = `${currency(e.amount)} · ${cat.label}${e.note ? " · " + e.note : ""}`;
          if (confirm(`Delete this expense?\n${label}`)) {
            performDelete();
          }
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
      const data = await finApi(name === "income" ? "income" : name);
      if (name === "assets") fin.assets = data;
      else if (name === "liabilities") fin.liabilities = data;
      else if (name === "income") fin.income = data;
      else if (name === "cashflow") fin.cf = data;
    } catch {
      /* keep stale data */
    }
  }

  function assetEffectiveValue(a) {
    if (a.category === "Gold" || a.category === "Silver") {
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
    return fin.income
      .filter((i) => i.month === m)
      .reduce((sum, i) => sum + (Number(i.value) || 0), 0);
  }

  function endingCashBalance(uptoMonth) {
    const flows = fin.cf
      .filter((c) => c.month <= uptoMonth)
      .reduce((sum, c) => sum + (Number(c.value) || 0), 0);
    return (Number(fin.settings.startingCash) || 0) + flows;
  }

  async function saveFinSettings(partial) {
    Object.assign(fin.settings, partial);
    renderFin();
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
    finSheetChip = config.chips ? config.chips.options[0] : null;
    finSheetTitle.textContent = config.title;
    renderFinSheetFields();
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
      html += `<div class="field"><label>${escapeHtml(cfg.chips.label)}</label><div class="category-grid" id="finChipGrid">`;
      html += cfg.chips.options
        .map((opt) => `<button type="button" class="category-chip ${opt === finSheetChip ? "selected" : ""}" data-chip="${escAttr(opt)}"><span>${escapeHtml(opt)}</span></button>`)
        .join("");
      html += `</div></div>`;
    }
    const fields = typeof cfg.fields === "function" ? cfg.fields(finSheetChip) : cfg.fields;
    fields.forEach((f) => {
      html += `
        <div class="field">
          <label>${escapeHtml(f.label)}</label>
          <input id="finField_${f.key}" type="${f.type === "num" ? "number" : "text"}"
            ${f.type === "num" ? 'inputmode="decimal" step="0.01"' : `maxlength="60"`}
            placeholder="${escAttr(f.placeholder || "")}" />
        </div>`;
    });
    finSheetFields.innerHTML = html;

    const grid = document.getElementById("finChipGrid");
    if (grid) {
      grid.querySelectorAll(".category-chip").forEach((chip) => {
        chip.addEventListener("click", () => {
          finSheetChip = chip.dataset.chip;
          renderFinSheetFields();
        });
      });
    }
  }

  finSaveBtn.addEventListener("click", async () => {
    if (!finSheetConfig) return;
    const cfg = finSheetConfig;
    const fields = typeof cfg.fields === "function" ? cfg.fields(finSheetChip) : cfg.fields;
    const values = {};
    for (const f of fields) {
      const el = document.getElementById("finField_" + f.key);
      values[f.key] = f.type === "num" ? Number(el.value) || 0 : el.value.trim();
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
          renderFin();
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
        <div class="fin-note"><span style="color:var(--entertainment)">■</span> Income &nbsp; <span style="color:var(--danger)">■</span> Expenses (from your expense log)</div>
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
        const isMetal = cat === "Gold" || cat === "Silver";
        const subtotal = items.reduce((s, a) => s + assetEffectiveValue(a), 0);
        const rows = items
          .map((a) =>
            finRowHtml(a, {
              fields: isMetal
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
          cat === "Gold" || cat === "Silver"
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

    const incomeItems = fin.income.filter((i) => inRange(i.month));
    const totalIncome = incomeItems.reduce((s, i) => s + (Number(i.value) || 0), 0);

    const incomeSections = fin.cats.incomeCategories
      .map((cat) => {
        const items = incomeItems.filter((i) => i.category === cat);
        if (items.length === 0) return "";
        const subtotal = items.reduce((s, i) => s + (Number(i.value) || 0), 0);
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
        return `<div class="fin-section"><div class="fin-section-heading"><span>${escapeHtml(cat)}</span><span class="subtotal">${currency(subtotal)}</span></div>${rows}</div>`;
      })
      .join("");

    // Expense side auto-computed from the expense log
    const expTotals = expenseTotalsByCategory((e) => inRange(e.date.slice(0, 7)));
    const totalExpense = Object.values(expTotals).reduce((s, v) => s + v, 0);
    const expenseRows = CATEGORIES.filter((c) => expTotals[c.id] > 0)
      .sort((a, b) => expTotals[b.id] - expTotals[a.id])
      .map(
        (c) => `
        <div class="fin-row readonly">
          <span style="font-size:16px;">${c.emoji}</span>
          <span class="f-name" style="flex:1.4;font-size:14px;">${c.label}</span>
          <span class="row-amount">${currency(expTotals[c.id])}</span>
        </div>`
      )
      .join("");

    const netPL = totalIncome - totalExpense;

    return `
      <div class="toggle-row">
        <button class="btn-toggle ${monthly ? "active" : ""}" id="pnlMonthly">Monthly</button>
        <button class="btn-toggle ${!monthly ? "active" : ""}" id="pnlYearly">Yearly</button>
      </div>

      <div class="fin-card" id="incomeCard">
        <div class="fin-card-title">Income</div>
        ${incomeSections || '<div class="fin-note">No income entries for this period.</div>'}
        <button class="fin-add-btn" id="addIncomeBtn">+ Add Income</button>
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
    `;
  }

  function wirePnl() {
    document.getElementById("pnlMonthly").addEventListener("click", () => { fin.pnlView = "monthly"; renderFin(); });
    document.getElementById("pnlYearly").addEventListener("click", () => { fin.pnlView = "yearly"; renderFin(); });
    wireFinRows(document.getElementById("incomeCard"), "income", ["value"], "income");

    document.getElementById("addIncomeBtn").addEventListener("click", () => {
      openFinSheet({
        title: "Add income",
        chips: { label: "Category", options: fin.cats.incomeCategories },
        fields: [
          { key: "name", label: "Description", placeholder: "e.g. July salary" },
          { key: "value", label: "Amount (E£)", type: "num", placeholder: "0" },
        ],
        onSave: async (cat, values) => {
          await finApi("income", {
            method: "POST",
            body: JSON.stringify({ category: cat, month: monthStr(viewDate), ...values }),
          });
          await reloadFin("income");
        },
      });
    });
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
    if (!fin.loaded) {
      finView.innerHTML = fin.failed
        ? '<div class="fin-card"><div class="fin-note">Couldn\'t load your financial data — check your connection and try again.</div></div>'
        : '<div class="fin-card"><div class="fin-note">Loading…</div></div>';
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
      if (activeTab !== "expenses" && !fin.loaded && !fin.failed) {
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

  function openSheet() {
    selectedCategory = null;
    amountInput.value = "";
    noteInput.value = "";
    dateInput.value = todayStr();
    renderCategoryGrid();
    sheetOverlay.classList.add("open");
    setTimeout(() => amountInput.focus(), 200);
  }

  function closeSheet() {
    sheetOverlay.classList.remove("open");
  }

  document.getElementById("fab").addEventListener("click", openSheet);
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
      const created = await apiAddExpense(syncCode, { amount, category: selectedCategory, note, date });
      expenses.push(created);
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
    await loadFromServer();
  });

  async function loadFromServer() {
    setSyncStatus("syncing");
    expenses = readCache(syncCode);
    renderAll();
    try {
      expenses = await apiFetchExpenses(syncCode);
      writeCache(syncCode, expenses);
      setSyncStatus("online");
    } catch {
      setSyncStatus("offline");
    }
    await loadFin();
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
