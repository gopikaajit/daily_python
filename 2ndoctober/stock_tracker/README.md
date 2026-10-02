# Live Stock Portfolio Tracker

A web page that tracks the stocks you have bought, with **live prices** and charts
that update automatically.

## What it shows

**Portfolio page** (`index.html`)
- Totals: invested, current value, total profit/loss, today's change (grouped per currency)
- Holdings table with live price (flashes green/red when it ticks), today's %, P&L
- **One combined price chart** for the selected stock with range buttons:
  **1D (live)** minute by minute, 5D, then daily closing prices for 1M / 3M / 6M / 1Y,
  weekly closes for 5Y and monthly for Max. The newest point moves live on every
  refresh in every range; dashed lines show the previous close and your buy price
- Add / remove stocks (saved to `portfolio.json`)

**Daily variation page** (`daily.html`)
- Bar chart of today's % move for every holding (live)
- Open, high, low, previous close, change today and day range for the selected stock
- Live intraday chart (today or the last 5 days)
- Day-to-day % change bars for the last 1M / 3M / 6M, with up/down day counts, best and worst day
- Table of daily open / high / low / close, change and high–low range

## How to run

Only Python 3 is needed – no packages to install.

```bash
cd 2ndoctober/stock_tracker
python server.py            # real data from Yahoo Finance
python server.py --demo     # simulated prices (for testing, weekends, offline)
```

The page opens in your browser automatically (otherwise go to <http://127.0.0.1:8000>).
Keep the terminal window open while you use it. Change the refresh rate (2–60 s) from the top-right corner.

## Symbols

Use Yahoo Finance symbols:

| Market | Example |
|---|---|
| US | `AAPL`, `MSFT`, `TSLA` |
| NSE India | `RELIANCE.NS`, `TCS.NS`, `INFY.NS` |
| BSE India | `RELIANCE.BO` |

## How it works

```
browser (index.html / daily.html + Chart.js)
   │  polls every few seconds
   ▼
server.py  ──►  Yahoo Finance chart API
   │  /api/quote     live price, day high/low, previous close
   │  /api/history   intraday (1m/5m) or daily/weekly/monthly closes
   └  /api/portfolio your holdings (portfolio.json)
```

The server sits in the middle because browsers block direct calls to Yahoo
Finance (CORS). It also caches answers for a few seconds so several open tabs
don't hit Yahoo repeatedly.

Prices are as fresh as Yahoo provides: US stocks are near real time, and some
exchanges may be delayed by a few minutes. Outside market hours the price stays at
the last close.
