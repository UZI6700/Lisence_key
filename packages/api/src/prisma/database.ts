import { Pool } from 'pg';

let sharedPool: Pool | null = null;

/**
 * Build a PostgreSQL pool (singleton to survive warm Vercel invocations).
 */
export function createPool(): Pool {
  if (sharedPool) return sharedPool;
  const pool = buildPool();
  sharedPool = pool;
  return pool;
}

function buildPool(): Pool {
  const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }
  return new Pool({
    connectionString,
    ssl: connectionString.includes('sslmode=require')
      ? { rejectUnauthorized: false }
      : undefined,
    max: Number(process.env.DB_POOL_MAX || 10),
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 5_000,
  });
}
