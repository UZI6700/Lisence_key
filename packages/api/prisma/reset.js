/* eslint-disable no-console */
/** Wipe all application data. Keeps the Ed25519 keypair intact. */
if (process.env.SUPABASE_DB_URL) process.env.DATABASE_URL = process.env.SUPABASE_DB_URL;
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.licenseActivation.deleteMany();
  await prisma.licenseRenewal.deleteMany();
  await prisma.device.deleteMany();
  await prisma.license.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.subscriptionPlan.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.product.deleteMany();
  await prisma.user.deleteMany();
  console.log('✓ All application data removed. Signing keys preserved.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
