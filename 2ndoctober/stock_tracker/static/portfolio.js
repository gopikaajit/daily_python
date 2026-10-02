// Portfolio page: holdings table with live prices and one chart where all
// your stocks are drawn on top of each other. Each line shows the % change
// from the start of the chosen range (from the previous close for 1D), so
// stocks with very different prices and currencies share one scale.

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
  selected: safeStorage("selected") || null,   // highlighted line
  hidden: new Set(),                            // lines switched off in the legend
  range: RANGES[safeStorage("range")] ? safeStorage("range") : "1d",
  loaded: null,            // { key, range, loadedAt } of the data in the chart
};

const isIntraday = (range) => range === "1d" || range === "5d";

// Colour follows the stock (its position in your holdings), never its rank.
function colorFor(symbol) {
  const i = state.holdings.findIndex((h) => h.symbol === symbol);
  return css(`--series-${(i % 8) + 1}`);
}
// A 9th+ stock reuses a colour, so it also gets a dashed line to tell it apart.
function dashFor(symbol) {
  return state.holdings.findIndex((h) => h.symbol === symbol) >= 8 ? [6, 4] : [];
}

// Tooltip: for every line, the point nearest to the mouse's time – the stocks
// may trade at different times (e.g. NSE vs US), so points don't line up.
Chart.Interaction.modes.nearestEach = (chart, e) => {
  const items = [];
  chart.data.datasets.forEach((ds, di) => {
    const meta = chart.getDatasetMeta(di);
    if (!chart.isDatasetVisible(di) || !meta.data.length) return;
    let best = 0, bestDist = Infinity;
    meta.data.forEach((el, i) => {
      const d = Math.abs(el.x - e.x);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    if (bestDist < 40) items.push({ element: meta.data[best], datasetIndex: di, index: best });
  });
  return items;
};

// Symbol labels at the right-hand end of each line, nudged apart so they don't overlap.
const endLabelPlugin = {
  id: "endLabels",
  afterDatasetsDraw(c) {
    if (c.$noEndLabels) return;
    const { ctx, chartArea: a } = c;
    const labels = [];
    c.data.datasets.forEach((ds, di) => {
      const meta = c.getDatasetMeta(di);
      if (!c.isDatasetVisible(di) || !meta.data.length) return;
      const el = meta.data[meta.data.length - 1];
      labels.push({ y: Math.min(Math.max(el.y, a.top + 6), a.bottom - 6), x: el.x, text: ds.label, color: ds.borderColor });
    });
    labels.sort((p, q) => p.y - q.y);
    for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 14);
    ctx.save();
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    for (const l of labels) {
      ctx.fillStyle = l.color;
      ctx.fillRect(a.right + 6, l.y - 1, 8, 2);
      ctx.fillStyle = css("--text-2");
      ctx.fillText(l.text, a.right + 18, l.y);
    }
    ctx.restore();
  },
};

const chart = new Chart(document.getElementById("price-chart"), {
  type: "line",
  data: { datasets: [] },
  options: (() => {
    const o = baseOptions({
      plugins: {
        tooltip: {
          displayColors: true,
          usePointStyle: true,
          boxWidth: 8, boxHeight: 8,
          itemSort: (p, q) => q.parsed.y - p.parsed.y,
          callbacks: {
            title: (items) => {
              const t = items[0].parsed.x;
              return isIntraday(state.range) ? dateOf(t) + " " + timeOf(t) : dateOf(t);
            },
            label: (c) => {
              const q = quoteOf(c.dataset.label);
              return ` ${c.dataset.label}  ${pct(c.parsed.y)}  (${money(c.raw.price, q?.currency)})`;
            },
            labelColor: (c) => ({ borderColor: c.dataset.borderColor, backgroundColor: c.dataset.borderColor }),
          },
        },
        refLine: { lines: [{ value: 0, label: "" }] },
      },
    });
    o.interaction = { mode: "nearestEach", intersect: false };
    o.layout = { padding: { right: 16 } };
    o.scales.x.type = "linear";
    o.scales.x.ticks.callback = (v) => labelFor(v, state.range);
    o.scales.y.position = "left";
    o.scales.y.ticks.callback = (v) => (v > 0 ? "+" : "") + v + "%";
    o.onClick = (_e, els) => els.length && select(chart.data.datasets[els[0].datasetIndex].label);
    return o;
  })(),
  plugins: [refLinePlugin, endLabelPlugin],
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

// ---------- the superimposed chart ----------
function labelFor(t, range) {
  if (range === "1d") return timeOf(t);
  if (range === "5d") return dateOf(t, false);
  if (range === "5y" || range === "max") return monthOf(t);
  return dateOf(t, false);
}

const holdingsKey = () => state.holdings.map((h) => h.symbol).join(",");

function makeDataset(symbol, h) {
  // 1D: change vs. yesterday's close (= "today's change"); other ranges: vs. first point.
  const base = state.range === "1d" ? (h.previousClose || h.close[0]) : h.close[0];
  const selected = symbol === state.selected;
  return {
    label: symbol,
    $base: base,
    data: h.t.map((t, i) => ({ x: t, y: (h.close[i] / base - 1) * 100, price: h.close[i] })),
    borderColor: colorFor(symbol),
    borderDash: dashFor(symbol),
    borderWidth: selected ? 3 : 2,
    order: selected ? 0 : 1,          // selected line drawn on top
    pointRadius: 0,
    pointHoverRadius: 4,
    pointHoverBackgroundColor: colorFor(symbol),
    pointHoverBorderColor: css("--surface"),
    pointHoverBorderWidth: 2,
    hidden: state.hidden.has(symbol),
  };
}

async function loadChart() {
  const range = state.range, key = holdingsKey();
  const symbols = state.holdings.map((h) => h.symbol);
  const results = await Promise.all(symbols.map((s) =>
    api.history(s, range, RANGES[range].interval).catch(() => null)));
  if (range !== state.range || key !== holdingsKey()) return;
  chart.data.datasets = symbols
    .map((s, i) => (results[i] && results[i].close.length ? makeDataset(s, results[i]) : null))
    .filter(Boolean);
  fitChart();
  chart.update();
  state.loaded = { key, range, loadedAt: Date.now() };
  renderLegend();
}

// Push each stock's newest live price into its line without refetching, so
// every line moves on every refresh – whichever range is shown.
function tickChart() {
  if (!state.loaded || state.loaded.range !== state.range) return;
  for (const ds of chart.data.datasets) {
    const q = quoteOf(ds.label);
    if (!q || q.price == null || !ds.data.length) continue;
    const last = ds.data[ds.data.length - 1].x;
    let newPoint;
    if (isIntraday(state.range)) {
      const step = (state.range === "1d" ? 1 : 5) * 60000;   // one point per candle
      newPoint = Math.floor(q.time / step) > Math.floor(last / step);
    } else if (RANGES[state.range].interval === "1d") {
      newPoint = q.time > last && new Date(q.time).toDateString() !== new Date(last).toDateString();
    } else {
      newPoint = false;                                      // weekly/monthly: update current bar
    }
    const point = { x: newPoint ? q.time : last, y: (q.price / ds.$base - 1) * 100, price: q.price };
    if (newPoint) ds.data.push(point); else ds.data[ds.data.length - 1] = point;
  }
  fitChart();
  chart.update();
  renderLegend();
}

// Make the time axis span exactly the data, and leave room on the right for
// the end-of-line labels (skipped on narrow screens – the legend covers it).
function fitChart() {
  const xs = chart.data.datasets.flatMap((d) => (d.data.length ? [d.data[0].x, d.data[d.data.length - 1].x] : []));
  chart.options.scales.x.min = xs.length ? Math.min(...xs) : undefined;
  chart.options.scales.x.max = xs.length ? Math.max(...xs) : undefined;
  chart.$noEndLabels = chart.width < 560;
  const longest = Math.max(0, ...chart.data.datasets.map((d) => d.label.length));
  chart.options.layout.padding.right = chart.$noEndLabels ? 8 : 26 + longest * 7.5;
}

// Legend above the chart: colour, symbol and change over the range. Click to hide/show a line.
function renderLegend() {
  document.getElementById("chart-title").textContent = `All holdings – ${RANGES[state.range].label}`;
  document.getElementById("legend").innerHTML = state.holdings.map((h) => {
    const ds = chart.data.datasets.find((d) => d.label === h.symbol);
    const change = ds?.data.length ? ds.data[ds.data.length - 1].y : null;
    const off = state.hidden.has(h.symbol);
    const sel = h.symbol === state.selected;
    return `<button class="legend-item ${off ? "off" : ""} ${sel ? "sel" : ""}" data-symbol="${escapeHtml(h.symbol)}"
              title="${off ? "Show" : "Hide"} ${escapeHtml(h.symbol)}">
        <span class="swatch" style="background:${colorFor(h.symbol)}"></span>
        ${escapeHtml(h.symbol)}
        <span class="${trendClass(change)}">${ds ? arrow(change) + pct(change) : "no data"}</span>
      </button>`;
  }).join("");
  document.getElementById("chart-hint").textContent = state.range === "1d"
    ? "Each line = % change from the previous close. The newest points move live. Hover to compare; click a line to highlight it."
    : `Each line = % change since the start of the ${RANGES[state.range].label} (closing prices). The newest points move live.`;
}

function select(symbol) {
  state.selected = symbol;
  safeStorage("selected", symbol || "");
  document.querySelectorAll("#holdings tr[data-symbol]").forEach((r) =>
    r.classList.toggle("selected", r.dataset.symbol === symbol));
  for (const ds of chart.data.datasets) {
    ds.borderWidth = ds.label === symbol ? 3 : 2;
    ds.order = ds.label === symbol ? 0 : 1;
  }
  chart.update();
  renderLegend();
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
    if (!state.loaded || state.loaded.key !== holdingsKey() || Date.now() - state.loaded.loadedAt > 60000) await loadChart();
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

document.getElementById("legend").addEventListener("click", (e) => {
  const b = e.target.closest("[data-symbol]");
  if (!b) return;
  const sym = b.dataset.symbol;
  state.hidden.has(sym) ? state.hidden.delete(sym) : state.hidden.add(sym);
  chart.data.datasets.forEach((ds) => (ds.hidden = state.hidden.has(ds.label)));
  chart.update();
  renderLegend();
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
