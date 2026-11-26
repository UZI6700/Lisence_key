/* eslint-disable no-console */
/**
 * First-run bootstrap for a real installation.
 *
 * Creates ONLY the infrastructure needed to run the system:
 *   - the Ed25519 signing keypair (if absent)
 *   - the first administrator account (local row + Supabase Auth user when configured)
 *
 * No sample products, customers, licenses or devices are created.
 *
 * Usage:
 *   ADMIN_EMAIL=admin@yourcompany.com ADMIN_PASSWORD='a-strong-password' node prisma/setup.js
 *
 * If ADMIN_PASSWORD is omitted, a strong random password is generated and
 * printed once. Set CREATE_ADMIN=false to only ensure the keypair exists.
 */
require('dotenv').config();
if (process.env.SUPABASE_DB_URL) process.env.DATABASE_URL = process.env.SUPABASE_DB_URL;

const { PrismaClient } = require('@prisma/client');
const { createAdminClient } = require('@supabase/server/core');
const { argon2id } = require('@noble/hashes/argon2.js');
const {
  generateKeyPairSync,
  randomBytes,
  randomInt,
} = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const prisma = new PrismaClient();

function supabaseEnabled() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

function ensureKeys() {
  const keysDir = join(process.cwd(), 'keys');
  const privatePath = join(keysDir, 'private.pem');
  const publicPath = join(keysDir, 'public.pem');
  if (existsSync(privatePath) && existsSync(publicPath)) {
    console.log('✓ Ed25519 keypair already present');
    return;
  }
  if (!existsSync(keysDir)) mkdirSync(keysDir, { recursive: true });
  const pair = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  writeFileSync(privatePath, pair.privateKey, { mode: 0o600 });
  writeFileSync(publicPath, pair.publicKey);
  console.log('✓ Generated Ed25519 keypair in ./keys — back up private.pem securely');
}

function hashPassword(password) {
  const salt = randomBytes(16);
  const m = 19456, t = 2, p = 1, dkLen = 32;
  const derived = argon2id(password, salt, { m, t, p, dkLen, version: 0x13 });
  const b64 = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '');
  return `$argon2id$v=19$m=${m},t=${t},p=${p}$${b64(salt)}$${b64(derived)}`;
}

function randomPassword(length = 24) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
  return Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join('');
}

async function ensureSupabaseAdmin(email, password, name) {
  if (!supabaseEnabled()) return null;
  const supabase = createAdminClient();
  const normalized = email.toLowerCase().trim();

  const { data: listed, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw new Error(`Could not list Supabase users: ${listError.message}`);
  const found = listed.users.find((user) => user.email?.toLowerCase() === normalized);
  if (found) {
    console.log(`✓ Supabase Auth user ${normalized} already exists`);
    return found;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: normalized,
    password,
    email_confirm: true,
    app_metadata: { role: 'ADMIN' },
    user_metadata: { name },
  });
  if (error || !data.user) throw new Error(`Could not create Supabase admin: ${error?.message}`);
  console.log(`✓ Created Supabase Auth admin ${normalized} (app_metadata.role=ADMIN)`);
  return data.user;
}

async function main() {
  ensureKeys();

  if (process.env.CREATE_ADMIN === 'false') {
    console.log('Skipped administrator creation (CREATE_ADMIN=false)');
    return;
  }

  const email = (process.env.ADMIN_EMAIL || 'admin@localhost').toLowerCase().trim();
  const generated = !process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD || randomPassword();
  const name = process.env.ADMIN_NAME || 'Administrator';

  let supabaseUser = await ensureSupabaseAdmin(email, password, name);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (supabaseUser && !existing.supabaseId) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { supabaseId: supabaseUser.id, role: 'ADMIN', status: 'ACTIVE' },
      });
      console.log(`✓ Linked existing administrator to Supabase Auth (${supabaseUser.id})`);
    } else {
      console.log(`✓ Administrator ${email} already exists`);
    }
  } else {
    await prisma.user.create({
      data: {
        name,
        email,
        password: hashPassword(password),
        role: 'ADMIN',
        status: 'ACTIVE',
        supabaseId: supabaseUser?.id,
      },
    });
    console.log(`✓ Created administrator: ${email}`);
    if (generated) {
      console.log('\n  Generated password (shown once — save it now):');
      console.log(`  ${password}\n`);
    }
  }

  if (supabaseEnabled() && !supabaseUser) {
    console.log('⚠ Supabase is configured but no admin user was created; sign in once to link it.');
  }
}

main()
  .catch((e) => { console.error('❌ Setup failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
