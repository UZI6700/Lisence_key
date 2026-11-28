# License Management System

Full-stack license management platform: **NestJS** API + **React/TypeScript** admin dashboard, backed by **Neon PostgreSQL** with **Neon Auth**, deployable to **Vercel**. See [VERCEL.md](VERCEL.md) and [docs/NEON.md](docs/NEON.md) for setup and deployment.

## Features

- 🔐 **Neon Auth** access tokens verified against JWKS; argon2id password hashing for local accounts
- 🔑 **Ed25519 license tokens** — signed, tamper-proof, base64url encoded
- 📱 **Device activation** with fingerprinting, device limits, and audit trail
- ⏳ **Configurable offline grace period** (disabled / 3 / 7 / custom days) that never extends expiry
- 📊 **Admin dashboard** with 8 pages (Dashboard, Licenses, Products, Customers, Subscriptions, Devices, Activity Log, Settings)
- 🗄️ **Prisma ORM** (13 tables) with a pure-JS `pg` driver adapter — no native database binaries in WebAssembly
- 🌐 **REST API** with full CRUD for all entities
- ☁️ **Vercel ready**: serverless function wrapper, health checks, automatic HTTPS, Neon database
- 📴 **Online + offline licensing**: automatic signed `license.lic`, Ed25519 verification, device binding, offline grace, clock-rollback detection and online synchronization

**Documentation:** [Neon integration](docs/NEON.md) · [Vercel deployment](VERCEL.md) · [Wasmer deployment](DEPLOY.md) · [Offline license API](docs/OFFLINE_LICENSE_API.md) · [Testing instructions](docs/OFFLINE_TESTING.md) · [Desktop client library](packages/license-client/README.md)

---

## Quick start

### Prerequisites
- Node.js 20+ (24 recommended)
- npm
- A PostgreSQL connection (local instance, or a [Wasmer managed database](DEPLOY.md))

### 1. Backend

```bash
npm install                        # from the repository root (npm workspaces)
cd packages/api
export DATABASE_URL='postgresql://user:pass@localhost:5432/licensemgr'
npm run db:migrate                 # applies prisma/migrations/0001_init
# create the first admin account + Ed25519 keypair (no sample data is created):
ADMIN_EMAIL=admin@yourcompany.com ADMIN_PASSWORD='choose-a-strong-password' npm run db:setup
npm run start:dev                  # http://localhost:3000
```

### 2. Frontend

```bash
cd packages/web
npm install
npm run dev                        # http://localhost:5173
```

The Vite dev server proxies `/api` → `http://localhost:3000`.

For a single-process build (dashboard served by the API): `npm run build:prod && npm start`.

### Real installation — no demo data

`npm run db:setup` creates **only** the Ed25519 keypair and the first administrator account. It does **not** create any sample products, customers, licenses or devices — the dashboard starts empty and fills with your real data.

- If `ADMIN_PASSWORD` is omitted, a strong random password is generated and printed once.
- Use `POST /api/v1/auth/register` (while authenticated as admin) to add more users.
- Create products, plans, customers and licenses through the dashboard or API.
- `npm run db:reset` wipes all application data (users included) but preserves the signing keys.

---

## API endpoints

All routes are prefixed with `/api/v1`.

### Auth
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/auth/login` | Sign in, returns `accessToken` + `refreshToken` |
| POST | `/auth/register` | Create a new user account |
| POST | `/auth/refresh` | Exchange refresh token for new tokens |
| GET | `/auth/me` | Current user (bearer token required) |

### Licenses
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/licenses` | List (filters: `status`, `productId`, `customerId`, `search`, `page`, `limit`) |
| GET | `/licenses/stats` | License status counts + recent licenses |
| GET | `/licenses/:id` | License details with activations & renewals |
| GET | `/licenses/key/:key` | Look up by full license key |
| POST | `/licenses/issue` | Issue & sign a new license token |
| POST | `/licenses/validate` | Verify signature, status & expiry (offline grace supported) |
| POST | `/licenses/activate` | Activate on a device (fingerprinting + device limit) |
| POST | `/licenses/:id/renew` | Extend expiry, records a renewal |
| POST | `/licenses/:id/revoke` | Revoke a license |
| POST | `/licenses/:id/deactivate` | Deactivate device(s) |
| PATCH | `/licenses/:id` | Update status / expiry / device limit |
| DELETE | `/licenses/:id` | Delete license |

### Other resources
| Resource | Routes |
|----------|--------|
| Products | `GET/POST /products`, `GET/PATCH/DELETE /products/:id`, `GET /products/plans` |
| Customers | `GET/POST /customers`, `GET/PATCH/DELETE /customers/:id` |
| Subscriptions | `GET/POST /subscriptions`, `GET/PATCH/DELETE /subscriptions/:id` |
| Devices | `GET/POST /devices`, `GET/PATCH/DELETE /devices/:id` |
| API keys | `GET/POST /api-keys`, `GET/PATCH/DELETE /api-keys/:id` |
| Activity | `GET /activity?limit=30` |
| Stats | `GET /stats/dashboard` |
| Settings | `GET /settings` (public key fingerprint, grace period) |

### Example: validate a license

```bash
curl -X POST http://localhost:3000/api/v1/licenses/validate \
  -H 'Content-Type: application/json' \
  -d '{"licenseKey":"DIG-8K29-XP71-MQ45"}'
```

Successful response:

```json
{
  "valid": true,
  "customer": "Your Customer",
  "plan": "pro",
  "daysLeft": 29,
  "maxDevices": 2,
  "inGracePeriod": false
}
```

---

## License key format

User-facing license keys are short and easy to transcribe:

```
DIG-XXXX-XXXX-XXXX      e.g. DIG-8K29-XP71-MQ45
```

`X` is an uppercase letter (A–Z) or digit (0–9). The short key is the public identifier; the full Ed25519 signed token is stored server-side in `signaturePayload` and verified on every activation/validation. Legacy raw tokens are still accepted.

### Signed token format (server-side)

```
base64url(JSON payload) "." base64url(Ed25519 signature)
```

Payload fields: `v`, `customer`, `deviceHashes` (`mac`, `guid`, `board`), `plan`, `maxDevices`, `issuedAt`, `expiresAt`, `licenseId`.

The Ed25519 keypair is generated once in `packages/api/keys/` (`private.pem`, `public.pem`). In production, set `LICENSE_PRIVATE_KEY` and `LICENSE_PUBLIC_KEY` environment variables (PEM with `\n` escapes) instead of committing the private key.

Device Request Codes (`PWPOS1-…`, RFC4648 base32 with a 2-byte SHA-256 checksum) are decoded by the same crypto service, matching the PLY Woods POS desktop client format.

---

## Environment variables

Create `packages/api/.env`:

```env
PORT=3000
DATABASE_URL="postgresql://...@...aws.neon.tech/...?sslmode=require"
DATABASE_URL_UNPOOLED="postgresql://...@...aws.neon.tech/..."
NEON_AUTH_BASE_URL="https://...auth.neon.tech"
NEON_AUTH_JWKS_URL="https://...auth.neon.tech/.well-known/jwks.json"
NEON_FUNCTION_HOST_SUFFIX="..."
NEON_AI_GATEWAY_BASE_URL="https://...neon.tech/v1"
NEON_AI_GATEWAY_TOKEN="..."
NEON_REALTIME_URL="wss://...neon.tech"
NEON_REALTIME_SECRET="..."
JWT_SECRET="..."
JWT_REFRESH_SECRET="..."
LICENSE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
LICENSE_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
```

Secrets are pushed to Vercel with `vercel env add`. See `VERCEL.md` and `docs/NEON.md`.

---

## Deploying to Vercel

See **[VERCEL.md](VERCEL.md)** for the complete walkthrough. In short:

```bash
npm run build:prod
vercel deploy --prod --yes
```

---

## Project structure

```
packages/
  api/src/
    auth/         Neon Auth controller/service, JWT guard, guards
    neon/         Neon Auth, Functions, AI Gateway, Realtime integration
    crypto/       Ed25519 signing, verification, device request codes
    license/      Issue / activate / validate / renew / revoke logic
    product/      Products + subscription plans
    customer/     Customers
    subscription/ Subscriptions
    device/       Device registry
    api-key/      API key management
    activity/     Audit log
    stats/        Dashboard aggregates
    settings/     Public key + configuration
    prisma/       PostgreSQL pool + PrismaService (pg driver adapter)
    health/       /health endpoint
  api/prisma/
    schema.prisma 13 models (PostgreSQL)
    migrations/0001_init, 0002_offline_licensing, 0003_supabase_auth
    setup.js       First-run bootstrap: admin account + keypair (no demo data)
    reset.js       Wipe application data, keep signing keys
  web/src/
    App.tsx       8-page admin dashboard
    lib/api.ts    Typed API client with token refresh
api/index.js      Vercel serverless entrypoint (esbuild-bundled NestJS)
scripts/bundle-api.js  Bundles the API for Vercel's CommonJS runtime
vercel.json       Vercel build + rewrite config
docs/NEON.md      Neon Auth + database setup, roles, secrets
VERCEL.md         Full Vercel deployment guide
DEPLOY.md         Legacy Wasmer deployment guide
```

---

## Verification checklist

- [x] `npm run build:prod` (API + web + static copy) — clean
- [x] Prisma PostgreSQL client generation — clean
- [x] No native modules in the deployed app (pure-JS pg adapter + argon2id)
- [x] `POST /auth/neon-login` with a Neon admin — access token returned
- [x] `POST /licenses/issue` — `DIG-XXXX-XXXX-XXXX` key + signed token created
- [x] `POST /licenses/validate` — valid response
- [x] Tampered token — rejected with signature error
- [x] `POST /licenses/activate` — device registered
- [x] Dashboard metrics, chart and user details derived from real DB data
- [x] All 8 dashboard pages render live API data with no console errors
