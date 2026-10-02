"""
Stock portfolio tracker - backend.

A tiny web server (Python standard library only, nothing to pip install) that:
  * serves the HTML pages in ./static
  * fetches stock data from Yahoo Finance and hands it to the pages as JSON
  * stores your holdings in portfolio.json

Run:
    python server.py            # real data from Yahoo Finance
    python server.py --demo     # simulated prices (works offline / weekends)

Then open http://localhost:8000 in your browser.

Symbols use Yahoo Finance format, e.g. AAPL, MSFT, TSLA (US),
RELIANCE.NS, TCS.NS, INFY.NS (NSE India), RELIANCE.BO (BSE).
"""

import argparse
import json
import math
import os
import random
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
PORTFOLIO_FILE = os.path.join(BASE_DIR, "portfolio.json")

YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?{query}"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

# Which (range, interval) pairs the pages may ask for, and how long to cache each.
ALLOWED_RANGES = {
    ("1d", "1m"): 20,
    ("5d", "5m"): 60,
    ("1mo", "1d"): 600,
    ("3mo", "1d"): 600,
    ("6mo", "1d"): 600,
    ("1y", "1d"): 600,
    ("5y", "1wk"): 3600,
    ("max", "1mo"): 3600,
}
QUOTE_CACHE_SECONDS = 4

DEMO_MODE = False
_cache = {}
_cache_lock = threading.Lock()


# --------------------------------------------------------------------------- #
# Small cache so several open tabs don't hammer Yahoo
# --------------------------------------------------------------------------- #
def cached(key, max_age, fetch):
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < max_age:
            return hit[1]
    value = fetch()
    with _cache_lock:
        _cache[key] = (now, value)
    return value


# --------------------------------------------------------------------------- #
# Yahoo Finance
# --------------------------------------------------------------------------- #
def yahoo_chart(symbol, range_, interval):
    query = urllib.parse.urlencode(
        {"range": range_, "interval": interval, "includePrePost": "false"}
    )
    url = YAHOO_CHART_URL.format(symbol=urllib.parse.quote(symbol), query=query)
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.load(resp)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise ValueError(f"Unknown symbol '{symbol}'")
        raise
    result = (data.get("chart") or {}).get("result")
    if not result:
        err = (data.get("chart") or {}).get("error") or {}
        raise ValueError(err.get("description") or f"No data for '{symbol}'")
    return result[0]


def parse_series(raw):
    """Turn Yahoo's chart result into lists, dropping empty candles."""
    stamps = raw.get("timestamp") or []
    q = ((raw.get("indicators") or {}).get("quote") or [{}])[0]
    out = {"t": [], "open": [], "high": [], "low": [], "close": []}
    for i, ts in enumerate(stamps):
        close = (q.get("close") or [None] * len(stamps))[i]
        if close is None:
            continue
        out["t"].append(ts * 1000)  # milliseconds for JavaScript
        out["close"].append(round(close, 4))
        for k in ("open", "high", "low"):
            v = (q.get(k) or [None] * len(stamps))[i]
            out[k].append(round(v, 4) if v is not None else round(close, 4))
    return out


def real_history(symbol, range_, interval):
    raw = yahoo_chart(symbol, range_, interval)
    meta = raw.get("meta", {})
    series = parse_series(raw)
    series.update(
        symbol=symbol,
        currency=meta.get("currency", ""),
        previousClose=meta.get("chartPreviousClose") or meta.get("previousClose"),
    )
    return series


def real_quote(symbol):
    raw = yahoo_chart(symbol, "1d", "1m")
    meta = raw.get("meta", {})
    series = parse_series(raw)
    price = meta.get("regularMarketPrice")
    prev = meta.get("previousClose") or meta.get("chartPreviousClose")
    return {
        "symbol": symbol,
        "name": meta.get("shortName") or meta.get("longName") or symbol,
        "currency": meta.get("currency", ""),
        "exchange": meta.get("fullExchangeName") or meta.get("exchangeName", ""),
        "price": price,
        "previousClose": prev,
        "open": series["open"][0] if series["open"] else None,
        "dayHigh": meta.get("regularMarketDayHigh"),
        "dayLow": meta.get("regularMarketDayLow"),
        "volume": meta.get("regularMarketVolume"),
        "time": (meta.get("regularMarketTime") or time.time()) * 1000,
    }


# --------------------------------------------------------------------------- #
# Demo data (random walk seeded by the symbol, so it is stable between calls)
# --------------------------------------------------------------------------- #
def _demo_base(symbol):
    return 50 + (sum(map(ord, symbol)) * 37) % 900


def _demo_walk(symbol, n, step_seconds, end, vol, start=None, drift=0.0):
    rng = random.Random(f"{symbol}-{step_seconds}-{n}")
    price = start or _demo_base(symbol)
    t0 = end - (n - 1) * step_seconds
    out = {"t": [], "open": [], "high": [], "low": [], "close": []}
    for i in range(n):
        o = price
        price = max(1.0, price * (1 + rng.gauss(drift, vol)))
        hi = max(o, price) * (1 + abs(rng.gauss(0, vol / 2)))
        lo = min(o, price) * (1 - abs(rng.gauss(0, vol / 2)))
        out["t"].append(int((t0 + i * step_seconds) * 1000))
        for k, v in (("open", o), ("high", hi), ("low", lo), ("close", price)):
            out[k].append(round(v, 2))
    return out


def _demo_currency(symbol):
    return "INR" if symbol.endswith((".NS", ".BO")) else "USD"


def _demo_live_price(symbol, last_close):
    # Smooth wiggle + a little noise so the live chart visibly moves.
    t = time.time()
    phase = sum(map(ord, symbol))
    wiggle = 0.004 * math.sin(t / 40 + phase) + 0.002 * math.sin(t / 7 + phase)
    return round(last_close * (1 + wiggle + random.gauss(0, 0.0005)), 2)


def demo_history(symbol, range_, interval):
    now = time.time()
    if interval in ("1m", "5m"):
        # Intraday data starts from yesterday's simulated close.
        start = _demo_walk(symbol, 3000, 86400, now - now % 86400, 0.015, drift=0.0002)["close"][-2]
        if interval == "1m":
            series = _demo_walk(symbol, 375, 60, now - now % 60, 0.0008, start)  # one session
            series["close"][-1] = _demo_live_price(symbol, series["close"][-2])
        else:
            series = _demo_walk(symbol, 5 * 75, 300, now - now % 300, 0.0015, start)
    else:
        # Every daily range is a slice of the same long walk, so they agree.
        full = _demo_walk(symbol, 3000, 86400, now - now % 86400, 0.015, drift=0.0002)
        days = {"1mo": 22, "3mo": 64, "6mo": 126, "1y": 252, "5y": 1260, "max": 3000}[range_]
        every = {"1d": 1, "1wk": 5, "1mo": 21}[interval]
        idx = list(range(len(full["t"]) - days, len(full["t"])))[::-1][::every][::-1]
        series = {k: [v[i] for i in idx] for k, v in full.items()}
    series.update(symbol=symbol, currency=_demo_currency(symbol), previousClose=series["open"][0])
    return series


def demo_quote(symbol):
    day = demo_history(symbol, "1d", "1m")
    price = _demo_live_price(symbol, day["close"][-2])
    return {
        "symbol": symbol,
        "name": f"{symbol} (demo)",
        "currency": _demo_currency(symbol),
        "exchange": "DEMO",
        "price": price,
        "previousClose": day["open"][0],
        "open": day["open"][0],
        "dayHigh": max(max(day["high"]), price),
        "dayLow": min(min(day["low"]), price),
        "volume": 1_000_000,
        "time": time.time() * 1000,
    }


# --------------------------------------------------------------------------- #
# Portfolio storage
# --------------------------------------------------------------------------- #
DEFAULT_PORTFOLIO = [
    {"symbol": "AAPL", "quantity": 10, "buyPrice": 180},
    {"symbol": "MSFT", "quantity": 5, "buyPrice": 400},
    {"symbol": "RELIANCE.NS", "quantity": 20, "buyPrice": 2800},
]


def load_portfolio():
    if not os.path.exists(PORTFOLIO_FILE):
        save_portfolio(DEFAULT_PORTFOLIO)
    with open(PORTFOLIO_FILE, encoding="utf-8") as f:
        return json.load(f)


def save_portfolio(items):
    clean = []
    for item in items:
        symbol = str(item.get("symbol", "")).strip().upper()
        if not symbol:
            continue
        clean.append(
            {
                "symbol": symbol,
                "quantity": float(item.get("quantity") or 0),
                "buyPrice": float(item.get("buyPrice") or 0),
            }
        )
    with open(PORTFOLIO_FILE, "w", encoding="utf-8") as f:
        json.dump(clean, f, indent=2)
    return clean


# --------------------------------------------------------------------------- #
# HTTP handler
# --------------------------------------------------------------------------- #
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def log_message(self, fmt, *args):  # keep the console quiet for API polling
        if not self.path.startswith("/api/"):
            super().log_message(fmt, *args)

    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        params = dict(urllib.parse.parse_qsl(url.query))
        try:
            if url.path == "/api/portfolio":
                return self.send_json(load_portfolio())
            if url.path == "/api/quote":
                return self.send_json(self.quotes(params.get("symbols", "")))
            if url.path == "/api/history":
                return self.send_json(self.history(params))
            if url.path == "/api/mode":
                return self.send_json({"demo": DEMO_MODE})
        except ValueError as e:
            return self.send_json({"error": str(e)}, 400)
        except Exception as e:  # network problems, Yahoo changes, ...
            return self.send_json({"error": f"Could not fetch data: {e}"}, 502)
        return super().do_GET()

    def do_POST(self):
        if urllib.parse.urlparse(self.path).path != "/api/portfolio":
            return self.send_json({"error": "Not found"}, 404)
        try:
            length = int(self.headers.get("Content-Length", 0))
            items = json.loads(self.rfile.read(length) or b"[]")
            return self.send_json(save_portfolio(items))
        except (ValueError, TypeError) as e:
            return self.send_json({"error": f"Bad portfolio data: {e}"}, 400)

    @staticmethod
    def quotes(symbols):
        fetch = demo_quote if DEMO_MODE else real_quote
        out = []
        for symbol in filter(None, (s.strip().upper() for s in symbols.split(","))):
            try:
                out.append(cached(("q", symbol), QUOTE_CACHE_SECONDS, lambda: fetch(symbol)))
            except Exception as e:
                out.append({"symbol": symbol, "error": str(e)})
        return out

    @staticmethod
    def history(params):
        symbol = params.get("symbol", "").strip().upper()
        key = (params.get("range", "1y"), params.get("interval", "1d"))
        if not symbol:
            raise ValueError("symbol is required")
        if key not in ALLOWED_RANGES:
            raise ValueError(f"Unsupported range/interval {key}")
        fetch = demo_history if DEMO_MODE else real_history
        return cached(("h", symbol) + key, ALLOWED_RANGES[key], lambda: fetch(symbol, *key))


def main():
    global DEMO_MODE
    parser = argparse.ArgumentParser(description="Live stock portfolio tracker")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--demo", action="store_true", help="use simulated prices")
    args = parser.parse_args()
    DEMO_MODE = args.demo

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    mode = "DEMO (simulated prices)" if DEMO_MODE else "LIVE (Yahoo Finance)"
    print(f"Stock tracker running in {mode} mode")
    print(f"Open http://localhost:{args.port} in your browser  (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nBye!")


if __name__ == "__main__":
    main()
