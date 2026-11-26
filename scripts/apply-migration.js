/* eslint-disable no-console */
/**
 * Apply all PostgreSQL migrations to a Wasmer managed database.
 *
 * Run this locally (after deploying once so the database exists):
 *   wasmer app database list --with-password
 *   SUPABASE_DB_URL='postgresql://postgres:[PASSWORD]@db.<ref>.supabase.co:5432/postgres' node scripts/apply-migration.js
 *   # or: DATABASE_URL='postgresql://user:pass@host:port/db?sslmode=require' node scripts/apply-migration.js
 */
const { readFileSync, readdirSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
// `pg` is installed in the api workspace, not at the repository root.
const { createRequire } = require('node:module');
const { Pool } = createRequire(join(__dirname, '..', 'packages', 'api', 'package.json'))('pg');

async function main() {
  const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('SUPABASE_DB_URL or DATABASE_URL is required');

  const dir = join(__dirname, '..', 'packages', 'api', 'prisma', 'migrations');
  const migrations = readdirSync(dir)
    .filter((name) => /^\d+_/.test(name))
    .sort();

  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try {
    // A minimal migration ledger. Prisma migrate deploy creates the same table;
    // this helper is only used for first-time Wasmer bootstrap.
    await pool.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )`);

    for (const name of migrations) {
      const file = join(dir, name, 'migration.sql');
      if (!existsSync(file)) continue;
      const applied = await pool.query(
        'SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = $1',
        [name],
      );
      if (applied.rowCount) {
        console.log(`• ${name} already applied`);
        continue;
      }
      const sql = readFileSync(file, 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      await pool.query('BEGIN');
      try {
        await pool.query(sql);
        await pool.query(
          `INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "finished_at", "applied_steps_count")
           VALUES ($1, $2, $3, now(), 1)`,
          [randomUUID(), checksum, name],
        );
        await pool.query('COMMIT');
        console.log(`✓ Applied ${name}`);
      } catch (e) {
        await pool.query('ROLLBACK');
        throw new Error(`${name}: ${e.message}`);
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('❌ Migration failed:', e.message);
  process.exit(1);
});
