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
  const currency = (n) => "$" + n.toFixed(2);

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

  const syncBadge = document.getElementById("syncBadge");
  const syncDot = document.getElementById("syncDot");
  const syncBadgeLabel = document.getElementById("syncBadgeLabel");
  const syncOverlay = document.getElementById("syncOverlay");
  const codeDisplay = document.getElementById("codeDisplay");
  const copyCodeBtn = document.getElementById("copyCodeBtn");
  const joinCodeInput = document.getElementById("joinCodeInput");

  const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  function setSyncStatus(status) {
    syncDot.className = "sync-dot " + status;
    syncBadgeLabel.textContent =
      status === "online" ? `Synced · ${syncCode}` : status === "offline" ? "Offline · showing cached data" : "Syncing…";
  }

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

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function renderAll() {
    renderMonthLabel();
    const list = expensesForMonth(viewDate);
    renderTotal(list);
    renderChart(list);
    renderList(list);
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
    await loadFromServer();
  });

  async function loadFromServer() {
    setSyncStatus("syncing");
    expenses = readCache(syncCode);
    renderAll();
    try {
      expenses = await apiFetchExpenses(syncCode);
      writeCache(syncCode, expenses);
      renderAll();
      setSyncStatus("online");
    } catch {
      setSyncStatus("offline");
    }
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
