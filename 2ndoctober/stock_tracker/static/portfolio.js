// Portfolio page: holdings table with live prices, live intraday chart and
// long-term closing-price chart for the selected stock.

const state = {
  holdings: [],
  quotes: {},
  selected: safeStorage("selected") || null,
  longRange: { range: "1y", interval: "1d" },
  intraday: null,          // { symbol, loadedAt }
};

const liveChart = lineChart(document.getElementById("live-chart"), {
  plugins: {
    tooltip: { callbacks: { label: (c) => "Price " + money(c.parsed.y, quoteOf(state.selected)?.currency) } },
  },
});
const longChart = lineChart(document.getElementById("long-chart"), {
  plugins: {
    tooltip: {
      callbacks: {
        title: (items) => dateOf(longChart.$times[items[0].dataIndex]),
        label: (c) => "Close " + money(c.parsed.y, quoteOf(state.selected)?.currency),
      },
    },
  },
});

function quoteOf(symbol) {
  return state.quotes[symbol];
}

// ---------- holdings table + tiles ----------
function renderTable() {
  const body = document.getElementById("holdings");
  if (!state.holdings.length) {
    body.innerHTML = `<tr><td colspan="9" class="muted">No stocks yet – add one below.</td></tr>`;
    return;
  }
  body.innerHTML = state.holdings.map((h) => {
    const q = quoteOf(h.symbol) || {};
    const cur = q.currency;
    const invested = h.quantity * h.buyPrice;
    const value = q.price != null ? h.quantity * q.price : null;
    const pl = value != null ? value - invested : null;
    const dayPct = q.price != null && q.previousClose ? (q.price / q.previousClose - 1) * 100 : null;
    const name = q.error ? `<span class="down">${escapeHtml(q.error)}</span>` : escapeHtml(q.name || "");
    return `
      <tr data-symbol="${escapeHtml(h.symbol)}" class="${h.symbol === state.selected ? "selected" : ""}">
        <td><strong>${escapeHtml(h.symbol)}</strong><div class="name">${name}</div></td>
        <td>${h.quantity}</td>
        <td>${money(h.buyPrice, cur)}</td>
        <td class="price" data-price="${q.price ?? ""}">${money(q.price, cur)}</td>
        <td class="${trendClass(dayPct)}">${arrow(dayPct)}${pct(dayPct)}</td>
        <td>${money(invested, cur)}</td>
        <td>${money(value, cur)}</td>
        <td class="${trendClass(pl)}">${signedMoney(pl, cur)}<div class="name">${pct(pl != null && invested ? (pl / invested) * 100 : null)}</div></td>
        <td><button class="icon" title="Remove ${escapeHtml(h.symbol)}" data-remove="${escapeHtml(h.symbol)}">✕</button></td>
      </tr>`;
  }).join("");
}

// Flash the price cell green/red when the price ticks.
function flashPrices(previous) {
  document.querySelectorAll("#holdings tr[data-symbol]").forEach((row) => {
    const sym = row.dataset.symbol;
    const before = previous[sym]?.price, now = quoteOf(sym)?.price;
    if (before == null || now == null || before === now) return;
    row.querySelector("td.price").classList.add(now > before ? "flash-up" : "flash-down");
  });
}

function renderTiles() {
  // Group totals by currency – adding dollars to rupees would be meaningless.
  const totals = {};
  for (const h of state.holdings) {
    const q = quoteOf(h.symbol);
    if (!q || q.price == null) continue;
    const t = (totals[q.currency] ??= { invested: 0, value: 0, day: 0, prev: 0 });
    t.invested += h.quantity * h.buyPrice;
    t.value += h.quantity * q.price;
    if (q.previousClose) {
      t.day += h.quantity * (q.price - q.previousClose);
      t.prev += h.quantity * q.previousClose;
    }
  }
  const curs = Object.keys(totals);
  if (!curs.length) {
    document.getElementById("tiles").innerHTML = "";
    return;
  }
  const tile = (label, fn) => `
    <div class="tile"><div class="label">${label}</div>
      ${curs.map((c) => fn(totals[c], c)).join("")}
    </div>`;
  document.getElementById("tiles").innerHTML =
    tile("Invested", (t, c) => `<div class="value">${money(t.invested, c)}</div>`) +
    tile("Current value", (t, c) => `<div class="value">${money(t.value, c)}</div>`) +
    tile("Total profit / loss", (t, c) => {
      const pl = t.value - t.invested;
      return `<div class="value ${trendClass(pl)}">${signedMoney(pl, c)}</div>
              <div class="sub ${trendClass(pl)}">${arrow(pl)}${pct((pl / t.invested) * 100)}</div>`;
    }) +
    tile("Today's change", (t, c) => `<div class="value ${trendClass(t.day)}">${signedMoney(t.day, c)}</div>
              <div class="sub ${trendClass(t.day)}">${arrow(t.day)}${pct(t.prev ? (t.day / t.prev) * 100 : null)}</div>`);
}

// ---------- charts ----------
async function loadIntraday() {
  const symbol = state.selected;
  if (!symbol) return;
  try {
    const h = await api.history(symbol, "1d", "1m");
    if (symbol !== state.selected) return;
    liveChart.data.labels = h.t.map(timeOf);
    liveChart.data.datasets[0].data = h.close;
    liveChart.$times = h.t.slice();
    liveChart.options.plugins.refLine.lines = [{ value: h.previousClose, label: "Prev. close " + money(h.previousClose, h.currency) }];
    liveChart.update();
    state.intraday = { symbol, loadedAt: Date.now() };
  } catch (e) {
    document.getElementById("live-meta").textContent = e.message;
  }
}

// Push the newest live price into the intraday chart without refetching it.
function tickIntraday() {
  const q = quoteOf(state.selected);
  if (!q || q.price == null || state.intraday?.symbol !== state.selected) return;
  const times = liveChart.$times || [];
  const data = liveChart.data.datasets[0].data;
  const minute = Math.floor(q.time / 60000);
  const lastMinute = times.length ? Math.floor(times[times.length - 1] / 60000) : -1;
  if (minute === lastMinute) {
    data[data.length - 1] = q.price;            // same minute: move the last point
  } else if (minute > lastMinute) {
    times.push(q.time);                          // new minute: add a point
    liveChart.data.labels.push(timeOf(q.time));
    data.push(q.price);
  }
  liveChart.update();
  const dayPct = q.previousClose ? (q.price / q.previousClose - 1) * 100 : null;
  document.getElementById("live-meta").innerHTML =
    `<strong>${money(q.price, q.currency)}</strong> <span class="${trendClass(dayPct)}">${arrow(dayPct)}${pct(dayPct)}</span> · ${timeOf(q.time)}`;
}

async function loadLongTerm() {
  const symbol = state.selected;
  if (!symbol) return;
  const { range, interval } = state.longRange;
  try {
    const h = await api.history(symbol, range, interval);
    if (symbol !== state.selected) return;
    // Short ranges show "12 Mar", long ones "Mar 2024"; the tooltip always gets the full date.
    const long = ["5y", "max"].includes(range);
    longChart.$times = h.t;
    longChart.data.labels = h.t.map((t) => (long ? monthOf(t) : dateOf(t, false)));
    longChart.data.datasets[0].data = h.close;
    const holding = state.holdings.find((x) => x.symbol === symbol);
    longChart.options.plugins.refLine.lines = holding
      ? [{ value: holding.buyPrice, label: "Your buy " + money(holding.buyPrice, h.currency) }] : [];
    longChart.update();
    const first = h.close[0], last = h.close[h.close.length - 1];
    const change = first ? (last / first - 1) * 100 : null;
    document.getElementById("long-hint").innerHTML =
      `Change over period: <span class="${trendClass(change)}">${arrow(change)}${pct(change)}</span> · Dashed line = your average buy price.`;
  } catch (e) {
    document.getElementById("long-hint").textContent = e.message;
  }
}

function select(symbol) {
  state.selected = symbol;
  safeStorage("selected", symbol || "");
  document.getElementById("live-title").textContent = symbol ? `${symbol} – live today` : "Live price – today";
  document.getElementById("long-title").textContent = symbol ? `${symbol} – closing prices` : "Closing prices";
  document.querySelectorAll("#holdings tr[data-symbol]").forEach((r) =>
    r.classList.toggle("selected", r.dataset.symbol === symbol));
  state.intraday = null;
  loadIntraday().then(tickIntraday);
  loadLongTerm();
}

// ---------- refresh loop ----------
async function refresh() {
  if (!state.holdings.length) {
    live.setStatus(true, "No stocks to track");
    return;
  }
  try {
    const previous = state.quotes;
    const list = await api.quotes(state.holdings.map((h) => h.symbol));
    state.quotes = Object.fromEntries(list.map((q) => [q.symbol, q]));
    renderTable();
    flashPrices(previous);
    renderTiles();
    // Re-sync the intraday candles once a minute; tick in between.
    if (!state.intraday || Date.now() - state.intraday.loadedAt > 60000) await loadIntraday();
    tickIntraday();
    live.setStatus(true, "Live · updated " + new Date().toLocaleTimeString());
  } catch (e) {
    live.setStatus(false, "Update failed: " + e.message);
  }
}

// ---------- events ----------
document.getElementById("holdings").addEventListener("click", async (e) => {
  const remove = e.target.closest("[data-remove]");
  if (remove) {
    const sym = remove.dataset.remove;
    if (!confirm(`Remove ${sym} from your portfolio?`)) return;
    state.holdings = await api.savePortfolio(state.holdings.filter((h) => h.symbol !== sym));
    if (state.selected === sym) select(state.holdings[0]?.symbol || null);
    renderTable(); renderTiles();
    return;
  }
  const row = e.target.closest("tr[data-symbol]");
  if (row && row.dataset.symbol !== state.selected) select(row.dataset.symbol);
});

document.getElementById("add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const symbol = f.get("symbol").trim().toUpperCase();
  const quantity = Number(f.get("quantity")), buyPrice = Number(f.get("buyPrice"));
  const existing = state.holdings.find((h) => h.symbol === symbol);
  if (existing) {
    // Average the buy price over both purchases.
    const qty = existing.quantity + quantity;
    existing.buyPrice = qty ? (existing.quantity * existing.buyPrice + quantity * buyPrice) / qty : buyPrice;
    existing.quantity = qty;
  } else {
    state.holdings.push({ symbol, quantity, buyPrice });
  }
  state.holdings = await api.savePortfolio(state.holdings);
  e.target.reset();
  select(symbol);
  refresh();
});

document.getElementById("long-range").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  document.querySelectorAll("#long-range button").forEach((x) => x.classList.toggle("on", x === b));
  state.longRange = { range: b.dataset.r, interval: b.dataset.i };
  loadLongTerm();
});

setupRefreshSelect(() => live.start(refresh));
onThemeChange(() => location.reload());

// ---------- start ----------
(async function init() {
  showModeBanner();
  try {
    state.holdings = await api.portfolio();
  } catch (e) {
    showError("Could not reach the server. Start it with:  python server.py");
    return;
  }
  renderTable();
  if (!state.holdings.some((h) => h.symbol === state.selected)) state.selected = state.holdings[0]?.symbol || null;
  select(state.selected);
  live.start(refresh);
})();
