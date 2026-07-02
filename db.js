const fs = require("fs");
const path = require("path");

const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, "data.json");

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveData(data) {
  const tmpPath = DATA_PATH + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(data));
  fs.renameSync(tmpPath, DATA_PATH);
}

module.exports = {
  getExpenses(code) {
    const data = loadData();
    return (data[code] || []).slice().sort((a, b) => b.createdAt - a.createdAt);
  },

  addExpense(code, expense) {
    const data = loadData();
    if (!data[code]) data[code] = [];
    data[code].push(expense);
    saveData(data);
  },

  deleteExpense(code, id) {
    const data = loadData();
    if (!data[code]) return false;
    const before = data[code].length;
    data[code] = data[code].filter((e) => e.id !== id);
    saveData(data);
    return data[code].length < before;
  },
};
