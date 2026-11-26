# Deploy to Wasmer Edge (Supabase Auth + PostgreSQL)

The whole system — NestJS API **and** React dashboard — runs as one Wasmer Edge app.
Authentication and data storage are provided by an external Supabase project; see
[docs/SUPABASE.md](docs/SUPABASE.md) for the complete setup.

## Architecture

```
Browser
  │  HTTPS (automatic Wasmer TLS)
  ▼
Wasmer Edge app  ── Edge.js (Node.js 24 in WebAssembly)
  ├── GET /                React dashboard (served from public/)
  ├── /api/v1/*            NestJS REST API
  └── /health              Health check
        │  verifies Supabase JWTs (JWKS)
        │  pg driver adapter → Supabase PostgreSQL (pure JS, no native binaries)
        ▼
Supabase Auth + Supabase PostgreSQL
```

Why pure JS: Wasmer Edge runs Node.js inside WebAssembly, so native N-API modules
(`better-sqlite3`, native argon2, Prisma's query-engine binary) are not used. The app uses
Prisma's `pg` driver adapter and `@noble/hashes` argon2id.

---

## 1. Prepare Supabase

1. Create a Supabase project.
2. Copy the values from **Project Settings → API → Keys**:
   `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWKS_URL`.
3. Copy the direct PostgreSQL connection string from
   **Project Settings → Database → Connection string** into `SUPABASE_DB_URL`.
4. Apply migrations and create the first administrator as described in
   [docs/SUPABASE.md](docs/SUPABASE.md).

> Rotate any key that was shared or pasted into a chat before going to production.

## 2. Build locally

```bash
npm install
npm run build:prod        # verifies Prisma generate + API + web + client + static copy
npm run test:licensing    # 12 offline licensing scenario tests
```

Install the [Wasmer CLI](https://docs.wasmer.io/install) and log in:

```bash
wasmer login
```

Edit `app.yaml` and set your own `owner` (Wasmer username/namespace) and app `name`.

## 3. First deployment

```bash
wasmer deploy --build-remote
```

The `Anybuild` file builds the monorepo with Node 24 and starts
`node packages/api/dist/main.js`. Your app will be available at
`https://<app-name>.wasmer.app`.

## 4. Set secrets

```bash
wasmer app secrets set \
  SUPABASE_URL='https://<project-ref>.supabase.co' \
  SUPABASE_PUBLISHABLE_KEY='sb_publishable_...' \
  SUPABASE_SECRET_KEY='sb_secret_...' \
  SUPABASE_JWKS_URL='https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json' \
  SUPABASE_DB_URL='postgresql://postgres:[DB_PASSWORD]@db.<project-ref>.supabase.co:5432/postgres'

# Stable Ed25519 license signing keys — REQUIRED so every instance verifies the same keys.
# Use the PEM contents from packages/api/keys/, with literal \n escapes.
wasmer app secrets set \
  LICENSE_PRIVATE_KEY="$(awk '{printf "%s\\n", $0}' packages/api/keys/private.pem)" \
  LICENSE_PUBLIC_KEY="$(awk '{printf "%s\\n", $0}' packages/api/keys/public.pem)"
```

`CryptoService` converts `\n` back to real newlines. Never commit `private.pem`.
If these keys are missing, each Edge instance generates a different keypair and licenses fail
validation on other instances.

## 5. Verify

```bash
curl https://<app-name>.wasmer.app/health
# {"status":"ok","database":"connected",...}

curl -X POST https://<app-name>.wasmer.app/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"..."}'
```

Open `https://<app-name>.wasmer.app` in a browser and sign in with the Supabase credentials.
Redeploy any time with `wasmer deploy --build-remote`.

---

## Useful commands

| Command | Purpose |
|---|---|
| `wasmer app logs` | Stream application logs |
| `wasmer app secrets list` | List configured secret names |
| `wasmer deploy --build-remote` | Build and deploy a new version |
| `wasmer app rollback` | Roll back to a previous version |

## Custom domain and HTTPS

Wasmer automatically provisions and renews TLS for `*.wasmer.app` and forces HTTPS.
Add a custom domain in the app dashboard under **Domains** — certificates are automatic.

## Notes / limitations

- Edge instances are stateless: all persistent state lives in Supabase PostgreSQL.
- Keep `LICENSE_PRIVATE_KEY` secret and backed up. Rotating it invalidates all issued licenses.
- Keep `SUPABASE_SECRET_KEY` and `SUPABASE_DB_URL` secret; they bypass Supabase RLS.
- The legacy database fallback (`DATABASE_URL` or Wasmer `DB_*`) still works if Supabase is not configured.
