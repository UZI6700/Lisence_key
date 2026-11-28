// Legacy Cloudflare Worker DB adapter placeholder.
// The Cloudflare Worker is now a thin proxy to the Vercel-hosted API,
// so this adapter is not used at runtime. Kept for reference only.
import { PrismaPg } from '@prisma/adapter-pg';
import { createPool } from './database';

export function createAdapter(): PrismaPg {
  return new PrismaPg(createPool());
}
