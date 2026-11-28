import { neon, neonConfig } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaPg } from '@prisma/adapter-pg';
import { createPool } from './database';

const g = globalThis as any;
const IS_WORKER = typeof g.caches !== 'undefined' && typeof g.WebSocketPair !== 'undefined';

/** Pick the right Prisma adapter for the current runtime. */
export function createAdapter(): PrismaNeon | PrismaPg {
  if (IS_WORKER) {
    const connectionString = process.env.DATABASE_URL || g.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required');
    // neon() uses plain HTTP fetch per query — no persistent request-bound socket.
    return new PrismaNeon(neon(connectionString));
  }
  return new PrismaPg(createPool());
}
