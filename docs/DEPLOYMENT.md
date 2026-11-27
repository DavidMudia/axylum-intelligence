# Local development and production deployment

Axylum uses the same Next.js API/frontend, PostgreSQL schema, market-data worker and paper-trading worker in local and hosted environments. Only environment values and the process supervisor/reverse proxy change.

## Local development

Requirements:

- Node.js 22 or newer and npm.
- PostgreSQL 16 or newer, locally installed or via Docker Compose.
- Outbound HTTPS and WebSocket access to Binance public Spot endpoints.

1. Create local configuration:

   ```sh
   cp .env.example .env
   ```

   PowerShell equivalent: `Copy-Item .env.example .env`. Keep `.env` private; it is ignored by Git.

2. Start a local PostgreSQL database if needed:

   ```sh
   docker compose -f compose.dev.yaml up -d db
   ```

   The example connection URL is `postgresql://postgres:local-development-only@127.0.0.1:5432/axylum`. This password is for local development only.

3. Install, migrate, and launch the independent processes in separate terminals:

   ```sh
   npm ci
   npm run db:migrate
   npm run dev
   npm run market-data:worker
   npm run paper-trading:worker
   ```

   Browse to `http://localhost:5174`. Stop workers with Ctrl+C; they handle SIGINT/SIGTERM and release their PostgreSQL advisory lock.

4. For a schema change, edit `src/backend/db/schema.ts`, create a migration using `npm run db:generate`, inspect the generated SQL, then apply with `npm run db:migrate`.

To run tests and build:

```sh
npm run typecheck
npm run test:market-data
npm run test:phase2
npm run test:auth
npm run build
```

## Responsive app, installable PWA and offline behavior

The Next.js app includes a mobile bottom navigation, touch-sized controls, responsive trading/watchlist layouts, touch pointer inspection for charts, a web app manifest, branded icons, and a service worker. The service worker is registered on production builds, not the development server. Serve the deployed app over HTTPS; `localhost` is also treated as a secure origin for local testing.

Install the app:

- **Windows/macOS/Linux, Chrome or Edge:** open Axylum and use the install icon in the address bar or the browser menu’s **Install app** action.
- **iPhone/iPad:** open Axylum in Safari, use **Share → Add to Home Screen**, then launch it from the Home Screen.
- **Android:** open Axylum in Chrome and choose **Install app** or **Add to Home screen** from the browser menu.

Offline behavior is intentionally limited. The service worker may cache versioned Next.js static assets and app icons, and serves a generic offline page when navigation cannot reach the server. It does not cache `/api` responses, Next.js data requests, authenticated HTML, private account information, market responses, or order/trading actions. Account, market and trading functionality requires a network connection; the offline page does not imply offline trading support.

In **Settings → Alert delivery**, a user can grant browser notification permission and send a local test notification. The service worker can display a valid Web Push event, but Axylum does not yet include VAPID key configuration, authenticated push-subscription storage, subscription lifecycle APIs, or event publishers. Consequently, order fills, protection events, disconnections, market alerts, strategy signals and risk violations are not yet sent as background notifications. Do not treat permission or the local test as proof of server-side alert delivery. iOS/iPadOS Web Push requires a supported OS version and a Home Screen-installed web app.

For responsive checks, use browser device emulation at representative widths such as 320, 375, 768 and 1280 CSS pixels; verify navigation, chart inspection, scrolling, forms and trading panels. Also test real Safari/iPhone/iPad and Android Chrome before release: desktop emulation does not validate operating-system install prompts, safe areas, notification permissions, or touch behavior on physical hardware.

## Hosted production architecture

`compose.yaml` defines separate restartable containers:

- **Caddy** — public ports 80/443, automatic HTTPS, security headers and reverse proxy.
- **web** — Next.js interface and APIs, exposed only on the private Compose network.
- **market-data** — Binance REST/WebSocket collector.
- **paper-trading** — autonomous paper decision/risk/execution worker.
- **db** — PostgreSQL 17 with a named persistent volume and health check; no public database port.
- **backup** — daily custom-format `pg_dump` backups with configurable local retention.

Both workers take PostgreSQL advisory locks so a second copy cannot run concurrently. Paper execution also has unique decision/order IDs and transaction-bound risk/account updates. Docker restarts processes after failures and host restarts; the workers resume from PostgreSQL state.

Secrets are passed only to the containers that need them: the web service receives database/authentication configuration; the market-data and paper workers receive the database URL and their runtime settings; Caddy receives only the public domain; PostgreSQL and the backup service receive database credentials.

This repository does **not** create a VPS, register a domain, configure DNS, or open a provider firewall. A deployment needs a Linux VPS, a domain/subdomain you control, DNS A/AAAA records pointing to the VPS, SSH access and the operator to apply provider/security changes.

Suggested starting VPS: 2+ vCPU, 4+ GB RAM and SSD storage sized for retained candles/trades/order-book data and backups. Actual disk growth depends on ingestion duration and retention policy; no automatic market-data deletion is configured. Choose a VPS with enough disk and monitor it. A public deployment URL is not available until you provision DNS and the server.

## Vercel web app with Neon PostgreSQL

Vercel can host the Next.js web app and API routes, and Neon can host PostgreSQL. This supports Axylum account registration and sign-in, but Vercel does not run the continuous Binance collector or paper-trading worker. Run those workers on a separate always-on host before expecting live ingestion or autonomous paper trading.

1. Link the GitHub repository to a Vercel project. Keep the project root at the repository root and leave the Next.js output directory on **Automatic**.
2. In Vercel **Settings → Environment Variables**, set the following for Production (and Preview only if you intend to use the same Neon database there):
   - `DATABASE_URL` — Neon’s pooled connection URL. This is the app’s runtime connection.
   - `APP_BASE_URL` — the canonical HTTPS app URL used for Paystack callbacks and receipts.
   - `CRON_SECRET` — a random secret of at least 32 characters for subscription expiration processing.
   - `PAYSTACK_SECRET_KEY`, `PAYSTACK_STARTER_PLAN_CODE`, and `PAYSTACK_PROFESSIONAL_PLAN_CODE` — server-only Paystack credentials and the matching NGN monthly plans. Configure the Starter plan at ₦5,000/month and Professional at ₦10,000/month; checkout verifies the remote plan amount before creating a transaction.
   - `EXCHANGE_CREDENTIALS_ENCRYPTION_KEY` — canonical base64-encoded 32-byte key used to encrypt saved exchange credentials and Paystack subscription-management tokens.
3. Keep all URLs, API keys, and encryption/cron secrets server-side. Do not use `NEXT_PUBLIC_` or `VITE_` prefixes. Axylum continues to use its existing email/password and role system; the separately enabled Neon Auth service is not the app’s active identity provider.
4. The checked-in database migrations must be applied to the Neon branch before first use. Review them and test them on a branch first. For future schema changes, set `DATABASE_URL_UNPOOLED` to Neon’s direct connection URL in a trusted local shell and run `npm run db:migrate`. Do not use the pooled URL for migrations.
5. Deploy from the linked GitHub branch. New accounts receive Free access; the first registration is never promoted to administrator or owner. Register the intended founder email, then provision it explicitly from a trusted environment with the direct database URL and both email variables set to the same value:

   ```powershell
   $env:DATABASE_URL_UNPOOLED = "<trusted direct PostgreSQL URL>"
   $env:AXYLUM_FOUNDER_EMAIL = "<founder account email>"
   $env:AXYLUM_FOUNDER_CONFIRM_EMAIL = "<same founder account email>"
   npm run founder:provision
   ```

   The command requires the founder account to exist and the migrations (including the five slot rows) to be applied. It promotes only that exact account to platform owner, assigns founder slot 1, and writes an audit event. It is idempotent and refuses to replace a different existing owner. Do not put the founder email or database URL in source control or public logs.
6. Configure the Paystack webhook URL as `https://<your-domain>/api/billing/paystack/webhook`. The endpoint validates the Paystack signature and verifies successful transactions server-side. `vercel.json` schedules subscription expiration hourly; other hosts must invoke `GET /api/cron/subscriptions` with `Authorization: Bearer <CRON_SECRET>` at least hourly.
7. Verify sign-up, Free access, a Paystack test-mode checkout and verification, webhook delivery, the founder account, and the owner-only complimentary slot dashboard before enabling live Paystack keys. A trial lasts seven days and must be started by the signed-in user. Complimentary accounts are represented only by slot assignments, not subscription or payment rows.

Only server-side environment variables are used by the Vercel runtime. `DATABASE_URL_UNPOOLED` is for trusted migrations and founder provisioning, not a browser variable. Do not configure the local Docker Compose database URL (`@db:5432`) in Vercel.

Subscription billing, complimentary access, billing screens, and user-scoped read-only Binance credential management are implemented in code. Full user-level isolation for the existing shared strategies, backtests, and paper-trading engine is not yet implemented; those legacy APIs are restricted to administrators rather than exposed to ordinary accounts. MT5 bridge self-registration/monitoring and broader user/subscription administration remain outstanding. Switching between active paid plans is blocked to prevent duplicate Paystack subscriptions; a safe scheduled upgrade/downgrade flow is still required. Do not treat Phase 4A as complete until those gaps are closed and tested.

## MetaTrader 5 bridge and demo execution

MetaTrader 5 requires its Windows desktop terminal and the official Windows-only Python package. Do not attempt to load the terminal or `MetaTrader5` package in Next.js, Vercel functions, or the Linux Compose services. The intended deployment is a separate Python bridge running on the same Windows machine/VPS as the terminal. It makes outbound HTTPS requests to Axylum; no inbound MT5 port is required.

The integration provides owner-scoped account and market data, signed bridge APIs, and a trading page with account status, broker-mapped quotes, positions, pending orders, execution requests, and broker deals. The bridge reports account, instrument, tick, and candle snapshots, and supports demo-only order commands:

- `POST /api/mt5/bridge/heartbeat`
- `POST /api/mt5/bridge/snapshot`
- `POST /api/mt5/bridge/market-data`
- `POST /api/mt5/bridge/orders/commands`
- `POST /api/mt5/bridge/orders/preflight`
- `POST /api/mt5/bridge/orders/result`
- `GET /api/mt5/accounts` (authenticated, owner-scoped, with broker login masked)
- `GET` and `POST /api/mt5/orders` (authenticated and owner-scoped)

The bridge token is generated out-of-band by `npm run mt5:bridge:provision -- <account-email> <bridge-name>`. The specified existing Axylum account becomes the bridge owner, allowing separate bridge identities per user. The command prints the token once and stores only its SHA-256 digest in PostgreSQL. Keep the token in a trusted Windows service environment, never in browser code, source control, or chat. Revoke a token with `npm run mt5:bridge:revoke -- <bridge-id>`. MT5 login passwords are not stored by Axylum; the bridge attaches to a terminal already logged into its broker account.

The MT5 schema migrations are additive and leave Binance tables unchanged. Review [migration 0008](../src/backend/db/migrations/0008_harsh_absorbing_man.sql) and [migration 0009](../src/backend/db/migrations/0009_glossy_plazm.sql), back up the database, and apply both using a trusted direct connection before provisioning a bridge. Neither migration is applied automatically; do not run them against production without explicit authorization, review, and backup:

```sh
npm run db:migrate
```

### Run the Windows bridge

1. Deploy the Axylum web app/API containing the MT5 routes and apply the reviewed migrations. Keep `AXYLUM_MT5_DEMO_TRADING_ENABLED` unset or set to `false` until a demo terminal has been verified. Provision a bridge against the intended database with an administrator account:

   ```powershell
   npm run mt5:bridge:provision -- admin@example.com "Windows demo terminal"
   ```

   Run provisioning from a trusted environment with `DATABASE_URL_UNPOOLED` set to the direct Neon URL (or a trusted direct PostgreSQL connection). Save the printed `bridgeId` and one-time `token` directly into the Windows service's protected environment. The token cannot be retrieved later.

2. On the Windows host, install 64-bit Python 3.11+, install MetaTrader 5, and sign in to a **demo** account in the desktop terminal. The bridge does not accept or transmit the broker password.

3. From the repository root, create a Python environment and install the bridge dependency:

   ```powershell
   py -3.11 -m venv .venv
   .\.venv\Scripts\python.exe -m pip install -r services\mt5-bridge\requirements.txt
   ```

4. Configure the bridge process environment using the bridge ID and token from provisioning:

   ```powershell
   $env:AXYLUM_API_BASE_URL = "https://<your-axylum-domain>"
   $env:AXYLUM_BRIDGE_ID = "<provisioned-bridge-uuid>"
   $env:AXYLUM_BRIDGE_TOKEN = "<one-time-bridge-token>"
   $env:MT5_SYMBOLS = "EURUSD,GBPUSD,USDJPY,AUDUSD,XAUUSD,US30,NAS100"
   $env:MT5_SERVER_UTC_OFFSET_SECONDS = "0"
   # Optional: map canonical symbols to the exact names shown by this broker.
   $env:MT5_SYMBOL_MAP = '{"US30":"US30.cash","NAS100":"USTEC"}'
   .\.venv\Scripts\python.exe services\mt5-bridge\bridge.py
   ```

   `MT5_SERVER_UTC_OFFSET_SECONDS` is the broker server's verified offset from UTC; the bridge subtracts it from terminal timestamps before sending market data and order history. Keep `0` only when terminal timestamps are already UTC. This staging MetaQuotes-Demo terminal reports timestamps two hours ahead of UTC, so its staging bridge uses `7200`; do not copy that value for another broker or terminal without checking. The example mappings are placeholders; configure only names confirmed in the broker's terminal. Unmapped or ambiguous instruments are skipped with a warning. The bridge sends account snapshots every 30 seconds, heartbeats every 15 seconds, and changed ticks/candles on its polling interval. Initial history backfill is configurable with `MT5_HISTORY_BARS` (100–5000, default 500). For local development only, `AXYLUM_API_BASE_URL` may use `http://127.0.0.1:5174` or `http://localhost:5174`; non-local endpoints require HTTPS.

5. Run the bridge under the same Windows user/session as the terminal. For ongoing use, configure a Windows service/process supervisor and protect its environment variables. Revoke a bridge token if the host is decommissioned or the token is exposed.

The bridge ingests account metrics, instrument specifications, positions, pending orders, recent deals, ticks, and historical/updated candles for M1, M5, M15, M30, H1, H4, D1, and W1. It reconnects after errors and retries data ingestion idempotently.

Demo order requests are disabled by default. To test them, set `AXYLUM_MT5_DEMO_TRADING_ENABLED=true` only on the server after confirming the connected terminal is a demo account. `AXYLUM_MT5_MAX_SPREAD_POINTS` defaults to `30`. Each new order requires server-side risk validation, current bridge margin preflight, and a live broker quote; the bridge then validates the demo login/server, symbol rules, spread, margin, and MT5 `order_check` before sending. The backend records an intent ID before the bridge can send it. A submitted request is not automatically replayed after a timeout; it is reconciled with broker history and may remain `unknown`. A `202` response means the request was queued, not that the broker filled it. Confirm the final state in the execution requests and broker-deals panels.

The UI also supports demo position closure, stop modification, and pending-order cancellation. Live-account execution is rejected in both backend and bridge code. Credentials remain in the local MT5 terminal and are never sent to the browser or Axylum.

The existing Binance paper-trading UI and engine are unchanged. MT5 signals are not yet produced by a multi-market strategy engine, cross-currency balances are not consolidated, and strategy compatibility across crypto and FX is not implemented. Do not treat this as a completed or production-verified broker integration: Python mock tests require Python 3.11+, while real bridge operation requires Windows and the MT5 terminal. Live account synchronization, database persistence, and demo execution must be verified against an authenticated MT5 demo terminal before use.

Run bridge unit tests on a host with Python installed:

```powershell
py -3.11 -m unittest discover -s services\mt5-bridge -p test_*.py
```

## First VPS deployment

### 1. Prepare the host

Install Docker Engine and the Docker Compose plugin from Docker's official instructions for your Linux distribution. Create a non-root deployment user with permission to run Docker. Configure SSH key access. Keep SSH available before enabling a firewall.

Create DNS records:

- `A`: chosen terminal hostname → VPS IPv4 address.
- `AAAA`: only if the VPS has working IPv6 connectivity.

Allow inbound TCP 22 (or your configured SSH port), TCP 80/443 and optionally UDP 443 for HTTP/3. Do **not** open PostgreSQL port 5432 or application port 5174. Use the provider firewall and host firewall consistently.

### 2. Get the code and create secrets

On the VPS, obtain the repository through your trusted Git remote and enter its root directory. Create production secrets:

```sh
cp .env.production.example .env.production
chmod 600 .env.production
openssl rand -hex 32
```

Edit `.env.production`:

- Set `DOMAIN` to the DNS hostname.
- Optionally set `AUTH_BOOTSTRAP_ADMIN_SECRET` to a new `openssl rand -hex 32` value if you need a one-time administrator account. Normal sign-ups work without it and receive Free access; the code never grants founder privileges. Remove the configured secret after use.
- Leave `ADMIN_USERNAME`, `ADMIN_PASSWORD` and `AUTH_SESSION_SECRET` blank unless you explicitly want the legacy Operator login.
- Set `EXCHANGE_CREDENTIALS_ENCRYPTION_KEY` to a canonical base64-encoded 32-byte value before enabling Binance key storage or Paystack subscription cancellation/resumption.
- Generate a separate database password and set both `POSTGRES_PASSWORD` and the matching password inside `DATABASE_URL`. URL-encode any reserved characters; a generated hex password avoids reserved-character encoding.
- Keep `DATABASE_URL` host set to `db`, not `localhost`.
- Leave Binance Spot URLs public. No exchange keys are needed.

Never commit `.env.production`, print it in logs, or send its secrets in chat. The tracked `.env.production.example` contains placeholders only.

### 3. Build, migrate and start

From the project directory, with `.env.production` set:

```sh
docker compose --env-file .env.production build
docker compose --env-file .env.production up -d db
docker compose --env-file .env.production --profile ops run --rm migrate
docker compose --env-file .env.production up -d
docker compose --env-file .env.production ps
```

The migration step applies only checked-in SQL. It does not erase historical data. Caddy requests certificates automatically once DNS resolves publicly and ports 80/443 reach the server. Then open `https://<DOMAIN>`, choose **Sign up**, and create the administrator account using the setup secret.

After first deployment, verify:

```sh
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs --tail=100 web market-data paper-trading backup caddy
curl -fsS "https://<DOMAIN>/api/health"
```

`/api/health` is intentionally public but only exposes app/database liveness without authentication; collector state and resource metrics require an authenticated session. Administrative data and mutation APIs require an administrator. Start paper trading explicitly from the Trading page after verifying ingestion, rules and risk settings.

## Updates without data loss

1. Take and verify a recent backup.
2. Fetch the new application version.
3. Build new images.
4. Run additive/compatible SQL migrations.
5. Restart services.

Example:

```sh
docker compose --env-file .env.production exec backup ls -lh /backups
docker compose --env-file .env.production build
docker compose --env-file .env.production --profile ops run --rm migrate
docker compose --env-file .env.production up -d
```

`docker compose down` preserves named volumes. **Never use `docker compose down -v`** for normal updates; it deletes the PostgreSQL and Caddy volumes.

## Backups and recovery

The backup service runs `pg_dump --format=custom` once daily, retains 14 days by default and stores files in the host's `./backups` folder. This is a same-server backup, not disaster-proof: copy backups regularly to encrypted off-server storage and restrict access. Monitor backup output:

```sh
docker compose --env-file .env.production logs --tail=100 backup
ls -lh ./backups
```

To restore, select a verified dump, stop application writers, then restore into PostgreSQL. The following Linux-host example preserves the existing volume but replaces objects in the target database; use it only after confirming the file and database:

```sh
docker compose --env-file .env.production stop web market-data paper-trading
docker compose --env-file .env.production exec -T db \
  pg_restore --clean --if-exists --no-owner --no-acl \
  --username=axylum --dbname=axylum \
  < ./backups/axylum-YYYYMMDDTHHMMSSZ.dump
docker compose --env-file .env.production up -d
```

Use the actual database/user names from `.env.production`. For a safer recovery drill, restore to a separate test database first. Check the `pg_restore` exit code and `/api/health`; then confirm market rows, strategy state and paper account records. If restoring over an existing production DB, use a maintenance window and retain a pre-restore backup.

## Operations and troubleshooting

- Status: `docker compose --env-file .env.production ps`
- Logs: `docker compose --env-file .env.production logs -f web market-data paper-trading`
- Restart one service: `docker compose --env-file .env.production restart market-data`
- Stop services without deleting data: `docker compose --env-file .env.production down`
- Host CPU/RAM/container use: `docker stats`
- Disk: `df -h` and `du -sh ./backups`; monitor the Docker and PostgreSQL volume filesystem as well.
- Public health: `https://<DOMAIN>/api/health`

The health endpoint includes database size, web-process CPU/RSS/heap, application filesystem availability, collector state/freshness and engine state. Compose restarts containers on failure. External paging/alerting and full VPS/volume metrics should be configured with the chosen host's monitoring service; this repository does not provision an alerting vendor.

If Binance DNS or networking fails, inspect the collector logs and data freshness. The collector reconnects and resynchronizes the order book. If the paper worker is unhealthy, check database readiness, collector freshness and worker logs before resuming.

## Production security and boundaries

- User accounts use email/password, salted scrypt hashes, database-backed revocable sessions and an 8-hour `HttpOnly`, `Secure`, `SameSite=Strict` cookie. Account mutations verify same-origin requests. Five failed sign-in/sign-up attempts per forwarded client address are throttled for 15 minutes per web process.
- Use HTTPS only, strong unique credentials and restricted SSH. For a single-user terminal, consider placing the site behind a VPN or an additional identity-aware proxy.
- All registrations start as Free user accounts. `AUTH_BOOTSTRAP_ADMIN_SECRET` optionally creates one administrator, while founder status requires the separate `npm run founder:provision` process described above. System-wide mutations and audit access require an administrator; complimentary allocation requires the founder. The optional legacy Operator login remains supported.
- Email verification, MFA and password recovery are not implemented. Do not enable unrestricted public registration on a production deployment until those controls are added.
- Health liveness and public market-data endpoints are unauthenticated by design. User-facing private APIs require sign-in.
- Binance API credentials can be managed per user with read-only permissions and encrypted server-side storage. MT5 account/bridge records are user-associated, but self-service bridge provisioning is not implemented. Per-user strategies, backtests and paper portfolios are not implemented; those legacy APIs are administrator-only and the paper portfolio remains shared.
- Do not enable Binance trading permissions. There is no live execution, leverage, short selling or withdrawal feature.
- Backups are local to the VPS unless you configure encrypted off-site copies. Host-level resource alerts are not provisioned automatically.

## Current deployment blockers

- No VPS is provisioned or connected to this workspace.
- No production domain/DNS is configured.
- The production environment secrets must be generated and installed by the operator.
- Public deployment, TLS issuance, remote backups, provider firewall and actual hosted process health can only be verified after the server and DNS exist.
