# Neon integration

The API uses Neon for all five services declared in `neon.ts`. `neon deploy` provisions them
and pulls their credentials into `.env.local` (mirrored into `packages/api/.env` for local runs).

```
Neon branch "production" (br-round-field-bir34nm4, ap-southeast-1)
├── Lakebase Postgres   DATABASE_URL / DATABASE_URL_UNPOOLED      → Prisma (pg driver adapter)
├── Neon Auth           NEON_AUTH_BASE_URL / NEON_AUTH_JWKS_URL   → login + JWT verification
├── Functions           NEON_FUNCTION_HOST_SUFFIX                 → hello function invocation
├── AI Gateway          NEON_AI_GATEWAY_BASE_URL / _TOKEN         → /v1/models, /v1/chat/completions
└── Realtime            NEON_REALTIME_URL / _SECRET               → sealed live queries
```

## Commands

```bash
neon login                       # browser sign-in, once
neon link --project-id odd-brook-74717659
neon deploy                      # provisions neon.ts services + pulls env
neon dev                         # optional: run Functions locally
```

## Environment variables

| Variable | Used for |
|---|---|
| `DATABASE_URL` | Pooled connection used by the app (Prisma `pg` adapter) |
| `DATABASE_URL_UNPOOLED` | Direct connection for migrations |
| `NEON_AUTH_BASE_URL` | Managed Better Auth branch URL (`/sign-in/email`, `/token`) |
| `NEON_AUTH_JWKS_URL` | EdDSA JWKS used to verify access tokens |
| `NEON_BRANCH_ID` + `NEON_FUNCTION_HOST_SUFFIX` | Build a function URL |
| `NEON_AI_GATEWAY_BASE_URL` + `NEON_AI_GATEWAY_TOKEN` | Model listing and chat completions |
| `NEON_REALTIME_URL` + `NEON_REALTIME_SECRET` | Sealing live queries (secret stays server-side) |

## API surface

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/neon/status` | Which Neon services are configured |
| `GET /api/v1/neon/function?slug=hello` | Invoke a deployed Neon Function |
| `GET /api/v1/neon/models` | List gateway models and how many are enabled |
| `POST /api/v1/neon/chat` | `{ model, prompt }` → AI Gateway chat completion |
| `POST /api/v1/neon/realtime/seal` | `{ sql, parameters }` → sealed Realtime capability |
| `POST /api/v1/auth/neon-login` | `{ email, password }` → Neon Auth JWT + local user |

## Authentication

Login accepts both identity providers:

1. **Neon Auth** — `POST /auth/neon-login` calls the branch's Managed Better Auth
   (`/sign-in/email`, then `/token`), verifies the EdDSA JWT against `NEON_AUTH_JWKS_URL`
   pinned to the branch issuer, then mirrors the user into `users`.
2. **Supabase Auth** — the existing `/auth/login` path is unchanged.

`JwtAuthGuard` tries Supabase first and falls back to Neon verification, so a token from either
provider authenticates the dashboard.

Role mapping: a Neon Auth user whose `role` is `admin`, or whose email is listed in
`SUPABASE_ADMIN_EMAILS`, becomes `ADMIN` locally. Set it in Postgres:

```sql
UPDATE neon_auth."user" SET role = 'admin' WHERE email = 'you@example.com';
```

## Driver choice

The API is a long-running NestJS process, so it keeps the existing Prisma + `node-postgres`
(`pg`) pool adapter. Per the Neon guidance, `pg` is correct for long-running Node services and
Neon Functions, and the pooled `DATABASE_URL` (`-pooler`) is used for application traffic while
migrations use the unpooled URL.

## Known limitation: AI Gateway credits

`GET /v1/models` returns the full catalog, but inference returns `403`
`AI Gateway is not enabled on this account's current plan` until the organization adds a card
and buys AI Gateway credits (works on the Free plan too):

https://console.neon.tech/app/org-winter-firefly-43896663/billing

No code change is needed after credits are added.
