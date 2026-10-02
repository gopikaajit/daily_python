// Shared helpers for both pages: API calls, number formatting, chart setup.

const api = {
  async get(path) {
    const res = await fetch(path, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  },
  portfolio: () => api.get("/api/portfolio"),
  quotes: (symbols) => api.get("/api/quote?symbols=" + encodeURIComponent(symbols.join(","))),
  history: (symbol, range, interval) =>
    api.get(`/api/history?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`),
  async savePortfolio(items) {
    const res = await fetch("/api/portfolio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(items),
    });
    return res.json();
  },
};

// ---------- formatting ----------
const CURRENCY_SYMBOL = { USD: "$", INR: "₹", EUR: "€", GBP: "£", JPY: "¥" };

function money(value, currency = "") {
  if (value == null || isNaN(value)) return "–";
  const sym = CURRENCY_SYMBOL[currency] ?? (currency ? currency + " " : "");
  const s = Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (value < 0 ? "−" : "") + sym + s;
}
function signedMoney(value, currency) {
  if (value == null || isNaN(value)) return "–";
  return (value > 0 ? "+" : "") + money(value, currency);
}
function pct(value) {
  if (value == null || !isFinite(value)) return "–";
  return (value > 0 ? "+" : value < 0 ? "−" : "") + Math.abs(value).toFixed(2) + "%";
}
function arrow(value) {
  return value > 0 ? "▲ " : value < 0 ? "▼ " : "";
}
function trendClass(value) {
  return value > 0 ? "up" : value < 0 ? "down" : "muted";
}
function timeOf(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function monthOf(ms) {
  return new Date(ms).toLocaleDateString([], { month: "short", year: "numeric" });
}
function dateOf(ms, withYear = true) {
  return new Date(ms).toLocaleDateString([], withYear
    ? { day: "numeric", month: "short", year: "numeric" }
    : { day: "numeric", month: "short" });
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- live status pill + refresh interval ----------
const live = {
  seconds: Number(safeStorage("refreshSeconds")) || 5,
  timer: null,
  start(fn) {
    clearInterval(this.timer);
    fn();
    this.timer = setInterval(fn, this.seconds * 1000);
  },
  setStatus(ok, text) {
    document.getElementById("status-dot").className = "dot " + (ok ? "live" : "err");
    document.getElementById("status-text").textContent = text;
  },
};

function safeStorage(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch (e) { /* storage blocked - ignore */ }
  return null;
}

function setupRefreshSelect(onChange) {
  const sel = document.getElementById("refresh");
  sel.value = String(live.seconds);
  sel.addEventListener("change", () => {
    live.seconds = Number(sel.value);
    safeStorage("refreshSeconds", sel.value);
    onChange();
  });
}

async function showModeBanner() {
  try {
    const { demo } = await api.get("/api/mode");
    if (demo) {
      const b = document.getElementById("banner");
      b.hidden = false;
      b.textContent = "Demo mode: prices are simulated. Restart the server without --demo for real Yahoo Finance data.";
    }
  } catch (e) { /* ignore */ }
}

function showError(message) {
  const b = document.getElementById("banner");
  b.hidden = false;
  b.className = "banner error";
  b.textContent = message;
}

// ---------- charts ----------
function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Draws a dashed horizontal line (e.g. previous close / buy price) and a
// vertical crosshair under the mouse.
const refLinePlugin = {
  id: "refLine",
  afterDatasetsDraw(chart, _args, opts) {
    const { ctx, chartArea: a, scales } = chart;
    for (const line of opts.lines || []) {
      if (line.value == null) continue;
      const y = scales.y.getPixelForValue(line.value);
      if (y < a.top || y > a.bottom) continue;
      ctx.save();
      ctx.strokeStyle = css("--muted");
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(a.left, y); ctx.lineTo(a.right, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = css("--text-2");
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(line.label, a.left + 6, y - 5);
      ctx.restore();
    }
    const active = chart.tooltip?.getActiveElements?.() || [];
    if (active.length && chart.config.type === "line") {
      const x = active[0].element.x;
      ctx.save();
      ctx.strokeStyle = css("--axis");
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke();
      ctx.restore();
    }
  },
};

function baseOptions(extra = {}) {
  const grid = css("--grid"), muted = css("--muted");
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: css("--surface"),
        titleColor: css("--text"),
        bodyColor: css("--text-2"),
        borderColor: css("--border"),
        borderWidth: 1,
        padding: 10,
        displayColors: false,
      },
      refLine: { lines: [] },
      ...extra.plugins,
    },
    scales: {
      x: {
        grid: { display: false },
        border: { color: css("--axis") },
        ticks: { color: muted, maxTicksLimit: window.innerWidth < 600 ? 4 : 6, maxRotation: 0, autoSkip: true },
      },
      y: {
        position: "right",
        grid: { color: grid },
        border: { display: false },
        ticks: { color: muted, maxTicksLimit: 6 },
      },
    },
  };
}

function lineChart(canvas, extraOptions = {}) {
  return new Chart(canvas, {
    type: "line",
    data: {
      labels: [],
      datasets: [{
        data: [],
        borderColor: css("--series-1"),
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: css("--series-1"),
        pointHoverBorderColor: css("--surface"),
        pointHoverBorderWidth: 2,
        tension: 0,
        fill: false,
      }],
    },
    options: baseOptions(extraOptions),
    plugins: [refLinePlugin],
  });
}

// Re-colour charts when the OS switches between light and dark.
function onThemeChange(fn) {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", fn);
}
