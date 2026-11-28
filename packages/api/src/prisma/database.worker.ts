import { Pool, neonConfig } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaPg } from '@prisma/adapter-pg';
import { createPool } from './database';

const g = globalThis as any;
const IS_WORKER = typeof g.caches !== 'undefined' && typeof g.WebSocketPair !== 'undefined';

let workerPool: Pool | null = null;

function getWorkerPool(): Pool {
  if (!workerPool) {
    const connectionString = process.env.DATABASE_URL || g.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required');
    workerPool = new Pool({ connectionString });
  }
  return workerPool;
}

/** Pick the right Prisma adapter for the current runtime (root-level safe). */
export function createAdapter(): PrismaNeon | PrismaPg {
  if (IS_WORKER) {
    const connectionString = process.env.DATABASE_URL || g.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required');
    return new PrismaNeon({ connectionString });
  }
  return new PrismaPg(createPool());
}
