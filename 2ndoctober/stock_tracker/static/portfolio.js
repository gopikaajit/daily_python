// Portfolio page: holdings table with live prices and one combined price
// chart for the selected stock – from today's live minute-by-minute price
// (1D) all the way out to long-term closing prices (1Y, 5Y, Max).

const RANGES = {
  "1d":  { interval: "1m",  label: "today" },
  "5d":  { interval: "5m",  label: "5 days" },
  "1mo": { interval: "1d",  label: "1 month" },
  "3mo": { interval: "1d",  label: "3 months" },
  "6mo": { interval: "1d",  label: "6 months" },
  "1y":  { interval: "1d",  label: "1 year" },
  "5y":  { interval: "1wk", label: "5 years" },
  "max": { interval: "1mo", label: "all time" },
};

const state = {
  holdings: [],
  quotes: {},
  selected: safeStorage("selected") || null,
  range: RANGES[safeStorage("range")] ? safeStorage("range") : "1d",
  loaded: null,            // { symbol, range, loadedAt } of the data in the chart
};

const isIntraday = (range) => range === "1d" || range === "5d";

const chart = lineChart(document.getElementById("price-chart"), {
  plugins: {
    tooltip: {
      callbacks: {
        title: (items) => {
          const t = chart.$times[items[0].dataIndex];
          return isIntraday(state.range) ? dateOf(t) + " " + timeOf(t) : dateOf(t);
        },
        label: (c) => (isIntraday(state.range) ? "Price " : "Close ") + money(c.parsed.y, quoteOf(state.selected)?.currency),
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

// ---------- the combined chart ----------
function labelFor(t, range) {
  if (range === "1d") return timeOf(t);
  if (range === "5d") return dateOf(t, false) + " " + timeOf(t);
  if (range === "5y" || range === "max") return monthOf(t);
  return dateOf(t, false);
}

async function loadChart() {
  const symbol = state.selected, range = state.range;
  if (!symbol) return;
  try {
    const h = await api.history(symbol, range, RANGES[range].interval);
    if (symbol !== state.selected || range !== state.range) return;
    chart.$times = h.t.slice();
    chart.data.labels = h.t.map((t) => labelFor(t, range));
    chart.data.datasets[0].data = h.close.slice();

    // Dashed reference lines: previous close (intraday views) and your buy price.
    const lines = [];
    const prev = range === "1d" ? h.previousClose : quoteOf(symbol)?.previousClose;
    if (isIntraday(range) && prev) lines.push({ value: prev, label: "Prev. close " + money(prev, h.currency) });
    const holding = state.holdings.find((x) => x.symbol === symbol);
    if (holding) lines.push({ value: holding.buyPrice, label: "Your buy " + money(holding.buyPrice, h.currency) });
    chart.options.plugins.refLine.lines = lines;

    chart.update();
    state.loaded = { symbol, range, loadedAt: Date.now() };
    renderChartInfo();
  } catch (e) {
    document.getElementById("chart-hint").textContent = e.message;
  }
}

// Push the newest live price into the chart without refetching it, so the
// line moves on every refresh – whichever range is shown.
function tickChart() {
  const q = quoteOf(state.selected);
  const l = state.loaded;
  if (!q || q.price == null || !l || l.symbol !== state.selected || l.range !== state.range) return;
  const times = chart.$times, data = chart.data.datasets[0].data;
  if (!times.length) return;
  const last = times[times.length - 1];
  let newPoint;
  if (isIntraday(state.range)) {
    const step = (state.range === "1d" ? 1 : 5) * 60000;   // one point per candle
    newPoint = Math.floor(q.time / step) > Math.floor(last / step);
  } else if (RANGES[state.range].interval === "1d") {
    newPoint = new Date(q.time).toDateString() !== new Date(last).toDateString() && q.time > last;
  } else {
    newPoint = false;                                      // weekly/monthly: update current bar
  }
  if (newPoint) {
    times.push(q.time);
    chart.data.labels.push(labelFor(q.time, state.range));
    data.push(q.price);
  } else {
    data[data.length - 1] = q.price;
  }
  chart.update();
  renderChartInfo();
}

function renderChartInfo() {
  const q = quoteOf(state.selected);
  const data = chart.data.datasets[0].data;
  const sym = state.selected;
  document.getElementById("chart-title").textContent = sym ? `${sym} – ${RANGES[state.range].label}` : "Price chart";
  if (q && q.price != null) {
    const dayPct = q.previousClose ? (q.price / q.previousClose - 1) * 100 : null;
    document.getElementById("chart-meta").innerHTML =
      `<strong>${money(q.price, q.currency)}</strong> <span class="${trendClass(dayPct)}">${arrow(dayPct)}${pct(dayPct)} today</span> · ${timeOf(q.time)}`;
  }
  if (data.length) {
    const first = state.range === "1d" ? (q?.previousClose ?? data[0]) : data[0];
    const change = first ? (data[data.length - 1] / first - 1) * 100 : null;
    document.getElementById("chart-hint").innerHTML =
      `Change over ${RANGES[state.range].label}: <span class="${trendClass(change)}">${arrow(change)}${pct(change)}</span>` +
      ` · The latest point moves live · Dashed lines = previous close / your average buy price.`;
  }
}

function select(symbol) {
  state.selected = symbol;
  safeStorage("selected", symbol || "");
  document.querySelectorAll("#holdings tr[data-symbol]").forEach((r) =>
    r.classList.toggle("selected", r.dataset.symbol === symbol));
  state.loaded = null;
  loadChart().then(tickChart);
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
    // Re-sync the chart data once a minute; tick the live price in between.
    if (!state.loaded || Date.now() - state.loaded.loadedAt > 60000) await loadChart();
    tickChart();
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

document.getElementById("chart-range").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  document.querySelectorAll("#chart-range button").forEach((x) => x.classList.toggle("on", x === b));
  state.range = b.dataset.r;
  safeStorage("range", state.range);
  state.loaded = null;
  loadChart().then(tickChart);
});

document.querySelectorAll("#chart-range button").forEach((x) => x.classList.toggle("on", x.dataset.r === state.range));

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
