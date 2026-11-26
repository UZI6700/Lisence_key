# Supabase integration (Auth + PostgreSQL)

The API uses Supabase for **authentication** and connects directly to **Supabase PostgreSQL**
for all application data. The React dashboard keeps the same `/api/v1/auth/*` contract, so no UI
changes are required.

> ⚠️ The secret key pasted into a chat transcript should be rotated in Supabase
> **Settings → API → Keys** before production use. Use the replacement value in deployment secrets.

## 1. Environment variables

Set these on the API runtime (local `.env` for development, Wasmer secrets in production):

```env
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...          # server-only; never ship to the browser
SUPABASE_JWKS_URL=https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json

# From Supabase → Project Settings → Database → Connection string (direct, port 5432)
SUPABASE_DB_URL=postgresql://postgres:[DB_PASSWORD]@db.<project-ref>.supabase.co:5432/postgres

# Optional: emails always treated as ADMIN, regardless of app_metadata
SUPABASE_ADMIN_EMAILS=admin@example.com
```

`DATABASE_URL` is still supported as a fallback when `SUPABASE_DB_URL` is unset. If neither is set,
the app can use Wasmer's injected `DB_*` variables.

## 2. Database

Apply all migrations to the Supabase database:

```bash
SUPABASE_DB_URL='postgresql://postgres:[DB_PASSWORD]@db.<project-ref>.supabase.co:5432/postgres' \
  node scripts/apply-migration.js
```

This applies `0001_init`, `0002_offline_licensing` and `0003_supabase_auth`. The last migration adds
`users.supabaseId`, which links Supabase identities to the existing licensing rows.

If you prefer the Supabase CLI instead of a raw connection string, the repository already contains
`supabase/config.toml` and the three migrations in `supabase/migrations/`:

```bash
npx supabase login                 # or set SUPABASE_ACCESS_TOKEN
npx supabase link --project-ref atowoeiaatvkvrciynjt
npx supabase db push
```

`link` needs a Supabase access token with `project_admin_read`, and it also prompts for the
**database password** from Project Settings → Database (not the same as `SUPABASE_SECRET_KEY`).
`supabase migration new` is only for authoring *new* migrations after a schema change; it is not
needed to apply the existing ones.

If you do not want to share the database password at all, open **Supabase → SQL Editor** and run
the contents of [`scripts/supabase-all-migrations.sql`](../scripts/supabase-all-migrations.sql)
once instead. It contains the same three migrations in order.

Prisma connects with the `postgres` role supplied in `SUPABASE_DB_URL`, so PostgREST RLS policies
do not apply to the NestJS API. Application-level role checks (`assertRole(req, 'ADMIN')`) protect
settings updates, device transfers and user creation.

## 3. Users and roles

Users are created and authenticated by Supabase Auth. On the first successful login (or when setup
runs), the API mirrors the identity into `users` and maps its role:

1. An email listed in `SUPABASE_ADMIN_EMAILS` → `ADMIN`.
2. `app_metadata.role` (`ADMIN`, `USER` or `VIEWER`) → that role.
3. Otherwise → `USER`, or the existing local role when linking an existing row.

To promote a user, set their app metadata in Supabase:

```sql
update auth.users
set raw_app_meta_data = raw_app_meta_data || '{"role":"ADMIN"}'::jsonb
where email = 'admin@example.com';
```

First administrator bootstrap with the provided script:

```bash
SUPABASE_DB_URL='postgresql://...' \
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='a-strong-password' \
  npm run setup --workspace api
```

The script creates the Ed25519 keypair if needed, creates the Supabase Auth user with
`app_metadata.role=ADMIN`, and links it to the local admin row. No sample business data is created.

## 4. API behaviour

| Endpoint | Behaviour with Supabase configured |
|---|---|
| `POST /api/v1/auth/login` | `supabase.auth.signInWithPassword`; returns Supabase access/refresh tokens |
| `POST /api/v1/auth/refresh` | `supabase.auth.refreshSession` |
| `POST /api/v1/auth/change-password` | Verifies current password via sign-in, then updates with the admin client |
| `GET /api/v1/auth/me` | Returns the mirrored local user (id, name, email, role) |
| `POST /api/v1/auth/register` | Admin-only; creates a Supabase user with `createUser` |
| All guarded routes | Bearer token verified against `SUPABASE_JWKS_URL` via `@supabase/server/core` |

Setting `AUTH_ALLOW_LEGACY_JWT=true` temporarily accepts old locally-issued JWTs. Leave it unset in
production.

## 5. Wasmer deployment secrets

```bash
wasmer app secrets set \
  SUPABASE_URL='https://<project-ref>.supabase.co' \
  SUPABASE_PUBLISHABLE_KEY='sb_publishable_...' \
  SUPABASE_SECRET_KEY='sb_secret_...' \
  SUPABASE_JWKS_URL='https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json' \
  SUPABASE_DB_URL='postgresql://postgres:[DB_PASSWORD]@db.<project-ref>.supabase.co:5432/postgres' \
  LICENSE_PRIVATE_KEY="$(awk '{printf "%s\\n", $0}' packages/api/keys/private.pem)" \
  LICENSE_PUBLIC_KEY="$(awk '{printf "%s\\n", $0}' packages/api/keys/public.pem)"
```

The managed Wasmer PostgreSQL capability is no longer required when `SUPABASE_DB_URL` is set.
`app.yaml` keeps no database capability so no unused database is provisioned.

## 6. Verify

```bash
curl https://<app-name>.wasmer.app/health
curl -X POST https://<app-name>.wasmer.app/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"..."}'
```

Use the returned `accessToken` as `Authorization: Bearer <token>` for dashboard requests.
