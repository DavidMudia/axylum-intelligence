# Axylum: how to use the terminal

Axylum currently focuses on **Binance Spot BTCUSDT**. It reads public market data, calculates indicators, evaluates transparent trading rules and can simulate paper trades. It cannot place real exchange orders, use leverage, short BTC or withdraw funds.

## Before opening the terminal

For the full experience, PostgreSQL and all three application processes need to be running:

1. PostgreSQL stores market history, analysis, strategy settings, decisions and the simulated account.
2. The **market-data collector** downloads history and receives live Binance candle, trade and order-book streams.
3. The **web application** serves the interface and API on port `5174`.
4. The separate **paper-trading worker** evaluates strategies and updates the paper account. Closing a browser does not stop it.

The API health check is available at `/api/health`. Its public response is intentionally limited to app/database liveness; after production sign-in it also reports collector freshness, order-book sequence status, worker health and application/database resource details. A green web page alone does not mean every collector or worker is healthy.

## Sign up and sign in

Choose **Sign up** on the sign-in screen and create an account with an email address and a password of at least 12 characters. Passwords are stored as salted scrypt hashes. Sign-in sessions are stored as revocable database records; the browser receives only an `HttpOnly` session cookie.

Every sign-up starts on Free with a regular-user role. Registration order never grants administrator or founder privileges. The intended founder account must be explicitly provisioned with `npm run founder:provision` after applying the subscription migrations. The optional `AUTH_BOOTSTRAP_ADMIN_SECRET` can create one administrator account but never grants platform-owner privileges.

If the database already has an administrator but you cannot access it, there is no pre-issued password to retrieve. Configure a new 64-character hexadecimal `AUTH_BOOTSTRAP_ADMIN_SECRET` in the server environment and restart the app. The sign-up screen will then offer a one-time administrator setup code; create an account with that code to establish another administrator. Remove the configured secret from the environment after it is consumed. The legacy Operator login is also available when its server-side environment credentials are configured. Only the separately provisioned platform owner can assign or revoke the four additional permanent Professional slots.

Email verification and self-service password recovery are not implemented yet. Do not treat open registration as production-ready for a public audience until those account-recovery and abuse-protection controls are added. Never share passwords or setup codes in chat.

## Main sections

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

### Knowledge Graph

Open **Knowledge Graph** from the sidebar to explore and query example entities and relationships. The graph is currently seeded illustrative content: its nodes, evidence labels, confidence values and time filters are not live market, on-chain or news observations. “Verified” and “inferred” describe the examples only; they are not validation of live facts.

### Strategy Lab

Strategies, configurations and backtest runs belong to the signed-in user. Strategy editing and backtest limits depend on the user's subscription; Free access has limited backtests, while paid plans include expanded strategy and analysis features. A strategy or backtest created by one account is not visible to another account.

The initial catalog contains:

- **EMA Trend Confirmation** — a long-only EMA crossover filtered by long trend, RSI and volume.
- **RSI Support Reversal** — a long-only oversold/support reversal rule.

Each strategy can be activated/deactivated and configured within bounded ranges. Saving rule changes creates a new strategy version. The independent risk configuration still constrains every entry.

**Run backtest** uses closed BTCUSDT candles stored in PostgreSQL (minimum 250). Results split candles chronologically into a training/in-sample segment and a later out-of-sample segment. Trades execute at the next candle open, with configured fee/slippage assumptions; if a stop and target are both crossed in the same candle, the stop is assumed first. Results include comparison with buy-and-hold, return, drawdown, Sharpe, win rate, profit factor, trade count, average profit/loss and equity curve.

Backtests are hypothetical, depend on the execution assumptions and do not guarantee future results. This is a single holdout split, not comprehensive walk-forward validation. A strategy may be worse than buy-and-hold; do not activate it solely because one historical result looks favorable.

### Trading

Each signed-in user has a separate paper portfolio in USDT. The shared paper worker evaluates each eligible user's active strategies against that user's own risk settings, account, positions and orders. Portfolio and decision history are scoped to the signed-in account; the worker does not process suspended users or accounts without paper-trading entitlement.

1. In Strategy Lab, review the rules and activate only the strategy you intend to test.
2. Review and save the risk limits. Defaults are conservative paper-only values: `0.5%` maximum equity risk per entry, `2%` daily loss, `10%` drawdown, `10%` position size, one concurrent position and at least `2:1` reward/risk.
3. Confirm the collector and separate paper worker are healthy in System.
4. Select **Start**. The worker evaluates completed market candles with a fresh Binance trade available. The process runs independently of the browser.
5. Use **Pause**, **Resume** or **Stop** to control evaluations. **Emergency halt** blocks new entries; protective exits can still be processed. Clear a halt only after stopping and passing risk revalidation.

The engine can reject a proposed entry when risk, balance, exposure, stop/target or concurrency rules fail. Rejections are recorded. The current interface does not provide manual order entry or configurable limit orders. Paper fills are simulations and never go to Binance.

### System

Check PostgreSQL, Binance collector state, WebSocket/order-book sequence, last data timestamps, paper worker state, latest decisions and logs. A collector can be running but stale or reconnecting; inspect the timestamp and error fields, not just the process state.

Application resource data is for the web process/container; use Docker/VPS monitoring for whole-host CPU, memory, disk and alerting. Backups are managed separately in production deployment.

### Billing

Open **Billing** to compare Free, Starter and Professional access, start a one-time seven-day Starter or Professional trial, end a trial early, manage configured Paystack renewal, and inspect verified payment history. Paystack checkout is currently unavailable until a Paystack account and server-side credentials are configured; the page disables checkout and trial actions do not charge or create payment records. Once enabled, checkout completion in the browser is not sufficient to activate access: Axylum must verify the transaction with Paystack or process a signed webhook. Complimentary Professional access is shown without a renewal or expiration date. Paid plan changes remain unavailable until Paystack is configured.

### Accounts

Open **Accounts** to connect a Binance API key after the server validates it with Binance. Only read-only keys are accepted; keys reporting trading or withdrawal permissions are rejected. The backend encrypts credentials and only returns connection status/labels. Disconnecting deletes the saved credentials. Professional users can register an MT5 Windows bridge, copy its one-time token configuration to the trusted bridge host, view their bridge/account health, rotate the token, or disconnect while retaining account history. MT5 login passwords are not stored, and order execution remains demo-only and disabled unless the server explicitly enables it.

## Common states and fixes

| What you see | Meaning and next check |
|---|---|
| `Waiting for persisted candles` | Start PostgreSQL and market-data worker; confirm Binance connectivity and collector freshness in System. |
| Indicator values are `—` | Indicator needs more candles for its lookback window. Allow collection to continue. |
| Paper engine `stopped` or `paused` | Start/resume it in Trading and verify the separate `paper-trading` process is running. |
| No order after starting | The strategy may correctly be holding; review Intelligence decisions and active strategy status. |
| Rejected paper order | Read its recorded risk details; adjust valid settings only if appropriate. Limits are intentionally enforced server-side. |
| Collector reconnecting / unhealthy book sequence | Check DNS/network access to Binance and worker logs; the collector retries and resynchronizes its order-book snapshot. |
| Sign-in or sign-up reports a database error | Check PostgreSQL availability and confirm the environment has all required migrations applied in order. |
| You need an administrator account | A standard sign-up works without a setup code and receives Free access. An operator can optionally configure `AUTH_BOOTSTRAP_ADMIN_SECRET` to create a one-time administrator; this does not provision the founder. |
| You cannot open System or Security | These operational controls are administrator-only. Standard users can manage personal trading, billing and integrations from their workspace. |

## Safe operating reminders

- No Binance API key is needed for public Spot data or paper mode.
- Binance API credentials are used only for server-side read-only validation and encrypted storage; no Binance order or withdrawal API is enabled. Never paste exchange keys into chat or public logs.
- Strategies, backtests, paper accounts and integration records are scoped to signed-in users in the application code. The configured staging and production databases have migrations 0013–0014 applied; any other environment must apply the required migrations before using these workflows.
- Never enable Binance trading permissions for this application.
- Never put database or operator credentials into browser code or public client variables.
- Do not infer strategy profitability from a single backtest or a short live observation period.
- Keep backups and test recovery before any production upgrade.
