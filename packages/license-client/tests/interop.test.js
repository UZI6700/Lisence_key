const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const path = require('node:path');

// The server CryptoService must load OUR test key, so set env before requiring it.
const keys = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
process.env.LICENSE_PRIVATE_KEY = keys.privateKey;
process.env.LICENSE_PUBLIC_KEY = keys.publicKey;

const { CryptoService } = require(path.join(__dirname, '..', '..', 'api', 'dist', 'crypto', 'crypto.service.js'));
const { verifyLicenseFile } = require('../dist');

test('server-signed license file verifies with the desktop client public key', async () => {
  const crypto = new CryptoService();
  const now = new Date().toISOString();
  const payload = {
    v: 1,
    format: 'LMS-LICENSE/1',
    licenseVersion: 1,
    licenseId: 'lic_interop',
    licenseKey: 'DIG-8K29-XP71-MQ45',
    customerId: 'cus_1',
    customerName: 'Acme Ltd',
    productId: 'prod_1',
    productCode: 'POS',
    deviceFingerprint: 'AABBCCDD',
    plan: 'pro',
    planId: 'plan_1',
    maxDevices: 3,
    durationDays: 30,
    issuedAt: now,
    activatedAt: now,
    firstActivatedAt: now,
    expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    lastValidatedAt: now,
    serverTime: now,
    trustedTime: now,
    localTimeAtValidation: now,
    clockSequence: 1,
    gracePeriodDays: 7,
  };

  const file = crypto.signLicenseFile(payload);
  const verification = await verifyLicenseFile(file, crypto.getPublicKeyPem());
  assert.equal(verification.valid, true);
  assert.equal(verification.payload.licenseId, 'lic_interop');

  const serverCheck = crypto.verifyLicenseFile(file);
  assert.equal(serverCheck.valid, true);

  file.payload.customerName = 'Tampered';
  assert.equal((await verifyLicenseFile(file, keys.publicKey)).code, 'TAMPERED');
  assert.equal(crypto.verifyLicenseFile(file).code, 'TAMPERED');
});
