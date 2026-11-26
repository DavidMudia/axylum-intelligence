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
   - `AUTH_BOOTSTRAP_ADMIN_SECRET` — generate a new value with `openssl rand -hex 32`. Use it for the first production administrator account, then remove it from Vercel after signup.
3. Keep the URL and setup secret server-side. Do not use `NEXT_PUBLIC_` or `VITE_` prefixes. Axylum continues to use its existing email/password and role system; the separately enabled Neon Auth service is not the app’s active identity provider.
4. The checked-in database migrations must be applied to the Neon branch before first use. For future schema changes, set `DATABASE_URL_UNPOOLED` to Neon’s direct connection URL in a trusted local shell and run `npm run db:migrate`. Do not use the pooled URL for migrations.
5. Deploy from the linked GitHub branch. Open the Vercel URL, choose **Sign up**, create the first account with the one-time setup code, and verify you can sign out and sign back in. Remove `AUTH_BOOTSTRAP_ADMIN_SECRET` from Vercel once the administrator account is created.

Only the pooled URL and bootstrap secret are required by the Vercel web runtime. `DATABASE_URL_UNPOOLED` is for trusted migrations and long-lived worker advisory locks, not a browser variable. Do not configure the local Docker Compose database URL (`@db:5432`) in Vercel.

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
- Set `AUTH_BOOTSTRAP_ADMIN_SECRET` to a new `openssl rand -hex 32` value. Use it once to create the first administrator account, or to recover admin access if the database already contains an inaccessible administrator. Remove it from the server environment after use.
- Leave `ADMIN_USERNAME`, `ADMIN_PASSWORD` and `AUTH_SESSION_SECRET` blank unless you explicitly want the legacy Operator login.
- `EXCHANGE_CREDENTIALS_ENCRYPTION_KEY` is reserved for the future exchange connection API; it is not used yet and no exchange keys should be entered.
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
- First production administrator setup and admin recovery are protected by a one-time `AUTH_BOOTSTRAP_ADMIN_SECRET`; subsequent public sign-ups are regular users. System-wide mutations and audit access require an administrator. The optional legacy Operator login remains supported.
- Email verification, MFA and password recovery are not implemented. Do not enable unrestricted public registration on a production deployment until those controls are added.
- Health liveness and public market-data endpoints are unauthenticated by design. User-facing private APIs require sign-in.
- User, session, exchange-connection and account-share tables are now modeled. Per-user exchange API management and per-user paper portfolios are not implemented yet; the existing paper portfolio remains shared.
- Do not enable Binance trading permissions. There is no live execution, leverage, short selling or withdrawal feature.
- Backups are local to the VPS unless you configure encrypted off-site copies. Host-level resource alerts are not provisioned automatically.

## Current deployment blockers

- No VPS is provisioned or connected to this workspace.
- No production domain/DNS is configured.
- The production environment secrets must be generated and installed by the operator.
- Public deployment, TLS issuance, remote backups, provider firewall and actual hosted process health can only be verified after the server and DNS exist.
