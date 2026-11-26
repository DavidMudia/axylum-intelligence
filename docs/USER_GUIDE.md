# Axylum: how to use the terminal

Axylum currently focuses on **Binance Spot BTCUSDT**. It reads public market data, calculates indicators, evaluates transparent trading rules and can simulate paper trades. It cannot place real exchange orders, use leverage, short BTC or withdraw funds.

## Before opening the terminal

For the full experience, PostgreSQL and all three application processes need to be running:

1. PostgreSQL stores market history, analysis, strategy settings, decisions and the simulated account.
2. The **market-data collector** downloads history and receives live Binance candle, trade and order-book streams.
3. The **web application** serves the interface and API on port `5174`.
4. The separate **paper-trading worker** evaluates strategies and updates the paper account. Closing a browser does not stop it.

The API health check is available at `/api/health`. Its public response is intentionally limited to app/database liveness; after production sign-in it also reports collector freshness, order-book sequence status, worker health and application/database resource details. A green web page alone does not mean every collector or worker is healthy.

## Six main sections

### Overview

Use this as the system summary: latest persisted BTCUSDT close, inferred market regime, current paper-account equity, worker/collector status, recent decisions and a close-price chart. Values load from backend APIs. If values are missing, check System health rather than assuming the market is quiet.

### Markets

Inspect the latest BTCUSDT 1-minute close series and derived indicators. The analysis panel distinguishes:

- **Observed** — OHLCV values persisted from Binance Spot.
- **Calculated** — RSI, MACD, EMAs/SMAs, Bollinger Bands, ATR, volume ratios, momentum, support/resistance and volatility.
- **Inferred** — trend and volatility regime labels, plus confidence. Confidence is a heuristic data/indicator confidence, not a calibrated probability of profit.

The bid/ask spread is available only when an order-book snapshot is stored. Candle indicators may show `—` during their warm-up periods because not enough candles exist yet.

### Intelligence

Review current calculated analysis and persisted strategy decisions. A decision includes its action (`BUY`, `SELL` or `HOLD`), strategy, status, explanation, evidence, regime and confidence. `HOLD` is normal: it means the rules did not justify an entry/exit. Decisions are not financial advice or promises of future performance.

### Strategy Lab

The initial catalog contains:

- **EMA Trend Confirmation** — a long-only EMA crossover filtered by long trend, RSI and volume.
- **RSI Support Reversal** — a long-only oversold/support reversal rule.

Each strategy can be activated/deactivated and configured within bounded ranges. Saving rule changes creates a new strategy version. The independent risk configuration still constrains every entry.

**Run backtest** uses closed BTCUSDT candles stored in PostgreSQL (minimum 250). Results split candles chronologically into a training/in-sample segment and a later out-of-sample segment. Trades execute at the next candle open, with configured fee/slippage assumptions; if a stop and target are both crossed in the same candle, the stop is assumed first. Results include comparison with buy-and-hold, return, drawdown, Sharpe, win rate, profit factor, trade count, average profit/loss and equity curve.

Backtests are hypothetical, depend on the execution assumptions and do not guarantee future results. This is a single holdout split, not comprehensive walk-forward validation. A strategy may be worse than buy-and-hold; do not activate it solely because one historical result looks favorable.

### Trading

The account is simulated USDT only. It displays cash, equity, realized/unrealized P&L, exposure, fees/slippage, positions, recent orders and decisions.

1. In Strategy Lab, review the rules and activate only the strategy you intend to test.
2. Review and save the risk limits. Defaults are conservative paper-only values: `0.5%` maximum equity risk per entry, `2%` daily loss, `10%` drawdown, `10%` position size, one concurrent position and at least `2:1` reward/risk.
3. Confirm the collector and separate paper worker are healthy in System.
4. Select **Start**. The worker evaluates completed market candles with a fresh Binance trade available. The process runs independently of the browser.
5. Use **Pause**, **Resume** or **Stop** to control evaluations. **Emergency halt** blocks new entries; protective exits can still be processed. Clear a halt only after stopping and passing risk revalidation.

The engine can reject a proposed entry when risk, balance, exposure, stop/target or concurrency rules fail. Rejections are recorded. The current interface does not provide manual order entry or configurable limit orders. Paper fills are simulations and never go to Binance.

### System

Check PostgreSQL, Binance collector state, WebSocket/order-book sequence, last data timestamps, paper worker state, latest decisions and logs. A collector can be running but stale or reconnecting; inspect the timestamp and error fields, not just the process state.

Application resource data is for the web process/container; use Docker/VPS monitoring for whole-host CPU, memory, disk and alerting. Backups are managed separately in production deployment.

## Common states and fixes

| What you see | Meaning and next check |
|---|---|
| `Waiting for persisted candles` | Start PostgreSQL and market-data worker; confirm Binance connectivity and collector freshness in System. |
| Indicator values are `—` | Indicator needs more candles for its lookback window. Allow collection to continue. |
| Paper engine `stopped` or `paused` | Start/resume it in Trading and verify the separate `paper-trading` process is running. |
| No order after starting | The strategy may correctly be holding; review Intelligence decisions and active strategy status. |
| Rejected paper order | Read its recorded risk details; adjust valid settings only if appropriate. Limits are intentionally enforced server-side. |
| Collector reconnecting / unhealthy book sequence | Check DNS/network access to Binance and worker logs; the collector retries and resynchronizes its order-book snapshot. |
| Production sign-in unavailable | Check that `ADMIN_USERNAME`, `ADMIN_PASSWORD` and a 32+ character `AUTH_SESSION_SECRET` are set in the server-only environment file. |

## Safe operating reminders

- No Binance API key is needed for public Spot data or paper mode.
- Never enable Binance trading permissions for this application.
- Never put database or operator credentials into browser code or public client variables.
- Do not infer strategy profitability from a single backtest or a short live observation period.
- Keep backups and test recovery before any production upgrade.
