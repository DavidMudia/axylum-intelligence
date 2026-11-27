# Axylum Intelligence Terminal

Axylum currently runs a BTCUSDT Spot market-data and paper-trading terminal. Binance public market data is collected into PostgreSQL; technical indicators, rule-based decisions, risk checks and simulated paper executions run on that persisted data. The application does not send Binance exchange orders or use Binance trading credentials.

MetaTrader 5 support includes additive account/market/order storage, signed Windows-bridge APIs, a demo-only order-intent and risk-preflight pipeline, and an MT5 account/market/positions interface under Trading. The bridge must run beside an authenticated Windows MT5 terminal; Vercel does not host it. Order submission is disabled unless `AXYLUM_MT5_DEMO_TRADING_ENABLED=true`, and live accounts are rejected. Real demo-account execution, MT5 strategy compatibility, and cross-currency portfolio aggregation remain unverified or unimplemented. See the [deployment guide](./docs/DEPLOYMENT.md#metatrader-5-bridge-and-demo-execution) for setup and boundaries.

## Documentation

- [How to use Axylum](./docs/USER_GUIDE.md) — a practical guide to the six primary sections and paper-trading workflow.
- [Local development and production deployment](./docs/DEPLOYMENT.md) — environment setup, Docker Compose, HTTPS, operations, backups and recovery.
- [Responsive and PWA setup](./docs/DEPLOYMENT.md#responsive-app-installable-pwa-and-offline-behavior) — install guidance, offline boundaries and notification status.

## Quick local setup

Requirements: Node.js 22+, npm, PostgreSQL 16+, and public internet access to Binance Spot.

1. Copy `.env.example` to `.env`. Set `DATABASE_URL` to your PostgreSQL database.
2. Install dependencies and apply checked-in migrations:

   ```sh
   npm ci
   npm run db:migrate
   ```

3. In separate terminals, start the frontend, collector and paper worker:

   ```sh
   npm run dev
   npm run market-data:worker
   npm run paper-trading:worker
   ```

4. Open [http://localhost:5174](http://localhost:5174), choose **Sign up**, and create an account. New accounts start on Free; registration order never grants administrator or founder privileges. Provision the founder explicitly with `npm run founder:provision` after applying the subscription migrations.

You can run PostgreSQL locally or start the development database with `docker compose -f compose.dev.yaml up -d db`. The worker processes are separate from the browser and web server. The paper worker only acts when paper trading is started from the Trading section.

## Production

Use the production Compose stack in [the deployment guide](./docs/DEPLOYMENT.md). It runs PostgreSQL, the web application, collector, paper worker, daily database backup and Caddy HTTPS reverse proxy as separate restartable services. Never expose PostgreSQL or the application port directly to the public internet.

The VPS, domain and DNS are not configured by this repository. A public deployment requires the operator to provision those resources and configure production secrets.

For a Vercel-hosted web app with Neon PostgreSQL, see the Vercel + Neon instructions in [the deployment guide](./docs/DEPLOYMENT.md). Account registration and sign-in work on that deployment; continuous Binance collection and paper trading still require a separate always-on worker host.

## Useful checks

```sh
npm run typecheck
npm run test:market-data
npm run test:mt5
npm run test:phase2
npm run test:auth
npm run build
```

Backtests and paper trades are simulations, not evidence that a strategy will be profitable. Review out-of-sample results and the assumptions documented in the user guide before enabling a strategy.

The web app includes responsive desktop/mobile layouts and an installable PWA shell. Offline mode is limited to the generic fallback and static app assets; authenticated pages, account data, market responses and trading APIs are never cached. Browser notification permission is available in Settings, but server-delivered trading alerts still require push subscription storage and event delivery infrastructure.
