// Daily variation page: today's move for every holding, live intraday chart,
// day-to-day % change bars and a daily OHLC table for the selected stock.

const state = {
  holdings: [],
  quotes: {},
  selected: safeStorage("selected") || null,
  intradayRange: { range: "1d", interval: "1m" },
  variationRange: "1mo",
  intraday: null,          // { symbol, loadedAt }
};

const upFill = () => css("--up-fill"), downFill = () => css("--down-fill");

// ---------- charts ----------
const overviewChart = new Chart(document.getElementById("overview-chart"), {
  type: "bar",
  data: { labels: [], datasets: [{ data: [], borderRadius: 4, borderSkipped: false, maxBarThickness: 22 }] },
  options: (() => {
    const o = baseOptions({
      plugins: { tooltip: { callbacks: { label: (c) => "Today " + pct(c.parsed.x) } } },
    });
    o.indexAxis = "y";
    o.interaction = { mode: "nearest", axis: "y", intersect: false };
    o.scales.y.position = "left";
    o.scales.y.grid = { display: false };
    o.scales.y.ticks = { color: css("--text-2"), autoSkip: false };
    o.scales.x.grid = { color: (c) => (c.tick.value === 0 ? css("--axis") : css("--grid")) };
    o.scales.x.ticks.callback = (v) => v + "%";
    o.onClick = (_e, els) => els.length && select(overviewChart.data.labels[els[0].index]);
    return o;
  })(),
});

const intradayChart = lineChart(document.getElementById("intraday-chart"), {
  plugins: {
    tooltip: {
      callbacks: {
        label: (c) => {
          const q = quoteOf(state.selected), prev = intradayChart.$prevClose;
          const p = prev ? (c.parsed.y / prev - 1) * 100 : null;
          return [`Price ${money(c.parsed.y, q?.currency)}`, `vs prev. close ${pct(p)}`];
        },
      },
    },
  },
});

const variationChart = new Chart(document.getElementById("variation-chart"), {
  type: "bar",
  data: { labels: [], datasets: [{ data: [], borderRadius: 4, borderSkipped: false, maxBarThickness: 18 }] },
  options: (() => {
    const o = baseOptions({
      plugins: {
        tooltip: {
          callbacks: {
            label: (c) => {
              const row = variationChart.$rows[c.dataIndex];
              const cur = quoteOf(state.selected)?.currency;
              return [`Change ${pct(row.pct)} (${signedMoney(row.change, cur)})`, `Close ${money(row.close, cur)}`];
            },
          },
        },
      },
    });
    o.scales.y.grid = { color: (c) => (c.tick.value === 0 ? css("--axis") : css("--grid")) };
    o.scales.y.ticks.callback = (v) => v + "%";
    return o;
  })(),
});

function quoteOf(symbol) {
  return state.quotes[symbol];
}

function barColors(values) {
  return values.map((v) => (v >= 0 ? upFill() : downFill()));
}

// ---------- overview (all holdings) ----------
function renderOverview() {
  const rows = state.holdings
    .map((h) => {
      const q = quoteOf(h.symbol);
      return { symbol: h.symbol, pct: q?.price != null && q.previousClose ? (q.price / q.previousClose - 1) * 100 : null };
    })
    .filter((r) => r.pct != null)
    .sort((a, b) => b.pct - a.pct);
  document.getElementById("overview-box").style.height = Math.max(120, rows.length * 34 + 40) + "px";
  overviewChart.data.labels = rows.map((r) => r.symbol);
  overviewChart.data.datasets[0].data = rows.map((r) => r.pct);
  overviewChart.data.datasets[0].backgroundColor = barColors(rows.map((r) => r.pct));
  overviewChart.update();
}

function renderChips() {
  document.getElementById("chips").innerHTML = state.holdings.map((h) =>
    `<button class="chip ${h.symbol === state.selected ? "on" : ""}" data-symbol="${escapeHtml(h.symbol)}">${escapeHtml(h.symbol)}</button>`
  ).join("");
}

// ---------- selected stock: tiles ----------
function renderTiles() {
  const q = quoteOf(state.selected);
  const el = document.getElementById("tiles");
  if (!q || q.error) {
    el.innerHTML = q?.error ? `<div class="tile"><div class="label">${escapeHtml(q.symbol)}</div><div class="sub down">${escapeHtml(q.error)}</div></div>` : "";
    return;
  }
  const c = q.currency;
  const change = q.price - q.previousClose;
  const changePct = q.previousClose ? (change / q.previousClose) * 100 : null;
  const rangePct = q.dayLow ? ((q.dayHigh - q.dayLow) / q.dayLow) * 100 : null;
  const fromOpen = q.open ? (q.price / q.open - 1) * 100 : null;
  const tile = (label, value, sub = "", cls = "") =>
    `<div class="tile"><div class="label">${label}</div><div class="value ${cls}">${value}</div><div class="sub">${sub}</div></div>`;
  el.innerHTML =
    tile(escapeHtml(q.name), money(q.price, c), `${escapeHtml(q.exchange || "")} · ${timeOf(q.time)}`) +
    tile("Change today", `${arrow(change)}${signedMoney(change, c)}`, `<span class="${trendClass(changePct)}">${pct(changePct)}</span>`, trendClass(change)) +
    tile("Open", money(q.open, c), `Since open: <span class="${trendClass(fromOpen)}">${pct(fromOpen)}</span>`) +
    tile("Previous close", money(q.previousClose, c)) +
    tile("Day high", money(q.dayHigh, c)) +
    tile("Day low", money(q.dayLow, c)) +
    tile("Day range", rangePct != null ? rangePct.toFixed(2) + "%" : "–", "(high − low) / low");
}

// ---------- selected stock: intraday ----------
async function loadIntraday() {
  const symbol = state.selected;
  if (!symbol) return;
  const { range, interval } = state.intradayRange;
  try {
    const h = await api.history(symbol, range, interval);
    if (symbol !== state.selected) return;
    const multiDay = range !== "1d";
    intradayChart.data.labels = h.t.map((t) => (multiDay ? dateOf(t, false) + " " : "") + timeOf(t));
    intradayChart.data.datasets[0].data = h.close;
    intradayChart.$times = h.t.slice();
    intradayChart.$multiDay = multiDay;
    const prev = multiDay ? quoteOf(symbol)?.previousClose : h.previousClose;
    intradayChart.$prevClose = prev;
    intradayChart.options.plugins.refLine.lines = prev ? [{ value: prev, label: "Prev. close " + money(prev, h.currency) }] : [];
    intradayChart.update();
    state.intraday = { symbol, loadedAt: Date.now() };
  } catch (e) {
    document.getElementById("intraday-title").textContent = `${symbol} – ${e.message}`;
  }
}

function tickIntraday() {
  const q = quoteOf(state.selected);
  if (!q || q.price == null || state.intraday?.symbol !== state.selected) return;
  const step = (intradayChart.$multiDay ? 5 : 1) * 60000;
  const times = intradayChart.$times || [];
  const data = intradayChart.data.datasets[0].data;
  const bucket = Math.floor(q.time / step);
  const last = times.length ? Math.floor(times[times.length - 1] / step) : -1;
  if (bucket === last) {
    data[data.length - 1] = q.price;
  } else if (bucket > last) {
    times.push(q.time);
    intradayChart.data.labels.push((intradayChart.$multiDay ? dateOf(q.time, false) + " " : "") + timeOf(q.time));
    data.push(q.price);
  }
  intradayChart.update();
}

// ---------- selected stock: day-to-day variation ----------
async function loadVariation() {
  const symbol = state.selected;
  if (!symbol) return;
  try {
    const h = await api.history(symbol, state.variationRange, "1d");
    if (symbol !== state.selected) return;
    const rows = h.t.map((t, i) => {
      const prevClose = i > 0 ? h.close[i - 1] : h.previousClose;
      const change = prevClose ? h.close[i] - prevClose : null;
      return {
        t, open: h.open[i], high: h.high[i], low: h.low[i], close: h.close[i], change,
        pct: prevClose ? (change / prevClose) * 100 : null,
        range: h.low[i] ? ((h.high[i] - h.low[i]) / h.low[i]) * 100 : null,
      };
    }).filter((r) => r.pct != null);

    variationChart.$rows = rows;
    variationChart.data.labels = rows.map((r) => dateOf(r.t, false));
    variationChart.data.datasets[0].data = rows.map((r) => r.pct);
    variationChart.data.datasets[0].backgroundColor = barColors(rows.map((r) => r.pct));
    variationChart.update();

    const upDays = rows.filter((r) => r.pct > 0).length;
    const best = rows.reduce((a, b) => (b.pct > a.pct ? b : a), rows[0]);
    const worst = rows.reduce((a, b) => (b.pct < a.pct ? b : a), rows[0]);
    const avgAbs = rows.reduce((s, r) => s + Math.abs(r.pct), 0) / (rows.length || 1);
    document.getElementById("variation-summary").innerHTML = rows.length
      ? `${upDays} up days, ${rows.length - upDays} down days · average daily move ${avgAbs.toFixed(2)}% ·
         best <span class="up">${pct(best.pct)}</span> (${dateOf(best.t)}) ·
         worst <span class="down">${pct(worst.pct)}</span> (${dateOf(worst.t)})`
      : "No data for this period.";

    const cur = h.currency;
    document.getElementById("daily-table").innerHTML = rows.slice().reverse().map((r) => `
      <tr>
        <td>${dateOf(r.t)}</td>
        <td>${money(r.open, cur)}</td>
        <td>${money(r.high, cur)}</td>
        <td>${money(r.low, cur)}</td>
        <td><strong>${money(r.close, cur)}</strong></td>
        <td class="${trendClass(r.change)}">${signedMoney(r.change, cur)}</td>
        <td class="${trendClass(r.pct)}">${arrow(r.pct)}${pct(r.pct)}</td>
        <td>${r.range != null ? r.range.toFixed(2) + "%" : "–"}</td>
      </tr>`).join("");
  } catch (e) {
    document.getElementById("variation-summary").textContent = e.message;
  }
}

function select(symbol) {
  state.selected = symbol;
  safeStorage("selected", symbol || "");
  document.getElementById("intraday-title").textContent = symbol ? `${symbol} – intraday price` : "Intraday price";
  document.getElementById("variation-title").textContent = symbol ? `${symbol} – day-to-day change` : "Day-to-day change";
  renderChips();
  renderTiles();
  state.intraday = null;
  loadIntraday().then(tickIntraday);
  loadVariation();
}

// ---------- refresh loop ----------
async function refresh() {
  if (!state.holdings.length) {
    live.setStatus(true, "No stocks – add some on the Portfolio page");
    return;
  }
  try {
    const list = await api.quotes(state.holdings.map((h) => h.symbol));
    state.quotes = Object.fromEntries(list.map((q) => [q.symbol, q]));
    renderOverview();
    renderTiles();
    if (!state.intraday || Date.now() - state.intraday.loadedAt > 60000) await loadIntraday();
    tickIntraday();
    live.setStatus(true, "Live · updated " + new Date().toLocaleTimeString());
  } catch (e) {
    live.setStatus(false, "Update failed: " + e.message);
  }
}

// ---------- events ----------
document.getElementById("chips").addEventListener("click", (e) => {
  const chip = e.target.closest("[data-symbol]");
  if (chip) select(chip.dataset.symbol);
});

function segment(id, onPick) {
  document.getElementById(id).addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    document.querySelectorAll(`#${id} button`).forEach((x) => x.classList.toggle("on", x === b));
    onPick(b.dataset);
  });
}
segment("intraday-range", (d) => {
  state.intradayRange = { range: d.r, interval: d.i };
  state.intraday = null;
  loadIntraday().then(tickIntraday);
});
segment("variation-range", (d) => {
  state.variationRange = d.r;
  loadVariation();
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
  if (!state.holdings.some((h) => h.symbol === state.selected)) state.selected = state.holdings[0]?.symbol || null;
  select(state.selected);
  live.start(refresh);
})();
