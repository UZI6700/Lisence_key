import { Pool } from 'pg';

/**
 * Build a PostgreSQL pool from either Wasmer's injected DB_* variables
 * or a conventional DATABASE_URL.
 *
 * Wasmer managed databases use TLS with a private CA, so the chain is not
 * publicly verifiable. TLS stays enabled; only chain verification is disabled.
 */
export function createPool(): Pool {
  // Supabase PostgreSQL takes precedence when configured.
  const supabaseUrl = process.env.SUPABASE_DB_URL;
  if (supabaseUrl) {
    return new Pool({
      connectionString: supabaseUrl,
      ssl: supabaseUrl.includes('sslmode=disable') ? undefined : { rejectUnauthorized: false },
      max: Number(process.env.DB_POOL_MAX || 5),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }

  if (process.env.DB_HOST && process.env.DB_NAME && process.env.DB_USERNAME) {
    return new Pool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME,
      user: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'Database configuration missing: set SUPABASE_DB_URL, DATABASE_URL, or Wasmer DB_HOST/DB_PORT/DB_NAME/DB_USERNAME/DB_PASSWORD',
    );
  }
  return new Pool({
    connectionString,
    ssl: connectionString.includes('sslmode=require')
      ? { rejectUnauthorized: false }
      : undefined,
    max: 5,
  });
}
