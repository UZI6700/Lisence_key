# Deploy to Vercel

The NestJS API and React dashboard deploy as a single Vercel Functions app.
Neon provides PostgreSQL and the backend services; Supabase Auth and Neon Auth are both accepted.

## Prerequisites

```bash
npm i -g vercel@latest
vercel login
```

Apply the Neon schema and create the first admin before deploying (see [docs/NEON.md](docs/NEON.md)):

```bash
neon deploy
node scripts/apply-migration.js   # DATABASE_URL from .env.local
```

## Project setup

```bash
vercel project create license-management-system
vercel link --project license-management-system --yes
```

`vercel.json` runs `npm run build:prod` remotely and routes every request through
`api/index.js`, which boots NestJS with an Express adapter and serves `packages/api/public/`.

## Environment variables

Push the branch secrets from `.env.local` and `packages/api/.env` to all Vercel environments:

```bash
vercel env add DATABASE_URL --environment production,preview,development --force --yes --sensitive
# repeat for DATABASE_URL_UNPOOLED, NEON_*, SUPABASE_*, LICENSE_PRIVATE_KEY,
# LICENSE_PUBLIC_KEY, JWT_SECRET, JWT_REFRESH_SECRET, NODE_ENV
```

`packages/web/package.json` declares `@rollup/rollup-linux-x64-gnu` as an optional dependency so
Vercel's Linux build machine does not hit npm's Rollup optional-dependency bug.

## Deploy

```bash
vercel deploy --prod --yes
```

Verify:

```bash
curl https://<deployment>.vercel.app/health
curl https://<deployment>.vercel.app/api/v1/neon/status
curl -X POST https://<deployment>.vercel.app/api/v1/auth/neon-login \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"..."}'
```

Open the deployment URL and sign in with either **Sign in with Supabase** or **Sign in with Neon**.
