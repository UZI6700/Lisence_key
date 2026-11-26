/* eslint-disable no-console */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, sign } = require('node:crypto');
const { canonicalJson, LicenseManager } = require('../dist');

const DAY = 86_400_000;
const KEY = 'DIG-TEST-0000-0001';
const FINGERPRINT = 'AABBCCDDEEFF00112233445566778899';
const OTHER_FINGERPRINT = '11223344556677889900AABBCCDDEEFF';

class MemoryStorage {
  constructor() { this.files = new Map(); this.baseDir = 'memory://app-data'; }
  readText(name) { return this.files.has(name) ? this.files.get(name) : null; }
  writeText(name, content) { this.files.set(name, content); }
  remove(name) { this.files.delete(name); }
}

function signPayload(payload, privateKey) {
  const signedBytes = Buffer.from(canonicalJson(payload), 'utf8');
  const signedData = signedBytes.toString('base64url');
  const signature = sign(null, signedBytes, privateKey).toString('base64url');
  return {
    format: 'LMS-LICENSE/1',
    payloadEncoding: 'base64url-json-canonical',
    payload,
    signedData,
    signature,
  };
}

class FakeLicensingApi {
  constructor(keys, serverNow) {
    this.keys = keys;
    this.serverNow = serverNow;
    this.graceDays = 7;
    this.license = {
      licenseKey: KEY,
      licenseId: 'lic_1',
      customerId: 'cus_1',
      customerName: 'Acme Ltd',
      productId: 'prod_1',
      productCode: 'POS',
      plan: 'pro',
      durationDays: 365,
      status: 'ACTIVE',
      deviceFingerprint: null,
      firstActivatedAt: null,
      expiresAt: null,
      lastValidatedAt: null,
    };
    this.requests = [];
  }

  payload(fingerprint, clockSequence, clientTime) {
    const now = new Date(this.serverNow()).toISOString();
    return {
      v: 1,
      format: 'LMS-LICENSE/1',
      licenseVersion: 1,
      licenseId: this.license.licenseId,
      licenseKey: this.license.licenseKey,
      customerId: this.license.customerId,
      customerName: this.license.customerName,
      productId: this.license.productId,
      productCode: this.license.productCode,
      deviceFingerprint: fingerprint || this.license.deviceFingerprint,
      plan: this.license.plan,
      planId: 'plan_1',
      maxDevices: 3,
      durationDays: this.license.durationDays,
      issuedAt: now,
      activatedAt: this.license.firstActivatedAt || now,
      firstActivatedAt: this.license.firstActivatedAt || now,
      expiresAt: new Date(this.license.expiresAt).toISOString(),
      lastValidatedAt: now,
      serverTime: now,
      trustedTime: now,
      localTimeAtValidation: clientTime || now,
      clockSequence,
      gracePeriodDays: this.graceDays,
    };
  }

  problem(code, reason) {
    return { ok: false, status: 400, json: async () => ({ code, reason, message: reason }) };
  }

  async handle(url, init) {
    const body = init.body ? JSON.parse(init.body) : {};
    this.requests.push({ url, body });
    if (url.endsWith('/offline/config')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          publicKey: this.keys.publicKey,
          publicKeyFingerprint: 'TEST:KEY',
          offlineGraceDays: this.graceDays,
          apiBaseUrl: '/api/v1',
        }),
      };
    }

    if (url.endsWith('/offline/activate')) {
      if (this.license.status !== 'ACTIVE') return this.problem(this.license.status, `License is ${this.license.status.toLowerCase()}`);
      if (body.productId && body.productId !== this.license.productId) return this.problem('PRODUCT_MISMATCH', 'Product mismatch');
      const fingerprint = body.deviceFingerprint;
      if (!fingerprint) return this.problem('FINGERPRINT_REQUIRED', 'Fingerprint required');
      if (this.license.deviceFingerprint && this.license.deviceFingerprint !== fingerprint) {
        return this.problem('DEVICE_MISMATCH', 'License is bound to another device');
      }
      const now = this.serverNow();
      if (!this.license.firstActivatedAt) this.license.firstActivatedAt = new Date(now).toISOString();
      this.license.deviceFingerprint = fingerprint;
      this.license.lastValidatedAt = new Date(now).toISOString();
      this.license.expiresAt = new Date(now + this.license.durationDays * DAY).toISOString();
      return {
        ok: true,
        status: 201,
        json: async () => ({
          activated: true,
          serverTime: new Date(now).toISOString(),
          licenseFile: signPayload(this.payload(fingerprint, body.clockSequence || 1, body.clientTime), this.keys.privateKey),
        }),
      };
    }

    if (url.endsWith('/offline/sync')) {
      if (this.license.status !== 'ACTIVE') {
        return { ok: true, status: 200, json: async () => ({ valid: false, code: this.license.status, reason: `License is ${this.license.status.toLowerCase()}` }) };
      }
      if (this.serverNow() >= Date.parse(this.license.expiresAt)) {
        return { ok: true, status: 200, json: async () => ({ valid: false, code: 'EXPIRED', reason: 'Subscription has expired' }) };
      }
      if (body.deviceFingerprint && this.license.deviceFingerprint && body.deviceFingerprint !== this.license.deviceFingerprint) {
        return { ok: true, status: 200, json: async () => ({ valid: false, code: 'DEVICE_MISMATCH', reason: 'Bound to another device' }) };
      }
      this.license.lastValidatedAt = new Date(this.serverNow()).toISOString();
      return {
        ok: true,
        status: 200,
        json: async () => ({
          valid: true,
          code: 'VALID',
          serverTime: new Date(this.serverNow()).toISOString(),
          gracePeriodDays: this.graceDays,
          licenseFile: signPayload(this.payload(this.license.deviceFingerprint, body.clockSequence || 1, body.clientTime), this.keys.privateKey),
        }),
      };
    }

    return this.problem('NOT_FOUND', `Unexpected endpoint ${url}`);
  }
}

function fixture({ graceDays = 7 } = {}) {
  const keys = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  let clientNow = Date.now();
  let serverNow = Date.now();
  const api = new FakeLicensingApi(keys, () => serverNow);
  api.graceDays = graceDays;
  const storage = new MemoryStorage();
  const manager = new LicenseManager({
    apiBaseUrl: '/api/v1',
    publicKeyPem: keys.publicKey,
    storage,
    productId: 'prod_1',
    now: () => clientNow,
    fetchFn: (url, init) => api.handle(url, init),
  });
  return {
    api, storage, manager, keys,
    advanceClient: (ms) => { clientNow += ms; },
    rewindClient: (ms) => { clientNow -= ms; },
    advanceServer: (ms) => { serverNow += ms; },
    getClientNow: () => clientNow,
  };
}

async function activated(f) {
  await f.manager.activate({ licenseKey: KEY, deviceFingerprint: FINGERPRINT });
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

test('first-time online activation writes a complete signed license.lic', async () => {
  const f = fixture();
  const { file, decision } = await f.manager.activate({ licenseKey: KEY, deviceFingerprint: FINGERPRINT });
  assert.equal(decision.allowed, true);
  assert.ok(f.storage.readText('license.lic'));

  const stored = JSON.parse(f.storage.readText('license.lic'));
  assert.equal(stored.format, 'LMS-LICENSE/1');
  for (const field of [
    'licenseId', 'customerId', 'productId', 'deviceFingerprint', 'plan',
    'activatedAt', 'expiresAt', 'lastValidatedAt', 'licenseVersion',
  ]) {
    assert.ok(stored.payload[field] !== undefined, `missing ${field}`);
  }
  assert.ok(stored.signature, 'missing digital signature');
  assert.equal(stored.payload.deviceFingerprint, FINGERPRINT);
  assert.equal(file.signature.length > 40, true);
  assert.ok(f.storage.readText('license.state.json'));
});

test('application starts offline with no internet after activation', async () => {
  const f = fixture();
  await activated(f);
  f.manager = new LicenseManager({
    apiBaseUrl: '/api/v1',
    publicKeyPem: f.keys.publicKey,
    storage: f.storage,
    productId: 'prod_1',
    now: () => f.getClientNow(),
    fetchFn: async () => { throw new Error('ENETUNREACH'); },
  });
  const decision = await f.manager.start({ online: true });
  assert.equal(decision.allowed, true);
  assert.equal(decision.code, 'VALID');
  assert.match(decision.reason, /Offline mode/);
});

test('application startup with internet synchronizes trusted time and refreshes the file', async () => {
  const f = fixture();
  await activated(f);
  const before = JSON.parse(f.storage.readText('license.lic')).payload.lastValidatedAt;
  f.advanceClient(60_000);
  f.advanceServer(60_000);
  const decision = await f.manager.start({ online: true });
  assert.equal(decision.allowed, true);
  const after = JSON.parse(f.storage.readText('license.lic')).payload.lastValidatedAt;
  assert.notEqual(after, before);
  assert.equal(JSON.parse(f.storage.readText('license.state.json')).clockSequence >= 2, true);
});

test('subscription expiry while offline blocks access', async () => {
  const f = fixture();
  await activated(f);
  f.advanceClient(366 * DAY);
  const decision = await f.manager.checkOffline();
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, 'EXPIRED');
  assert.equal(decision.requiresOnline, true);
});

test('renewal extends expiry on the next online sync', async () => {
  const f = fixture();
  await activated(f);
  const originalExpiry = Date.parse(f.api.license.expiresAt);
  f.api.license.expiresAt = new Date(originalExpiry + 30 * DAY).toISOString();
  f.advanceClient(2 * DAY);
  f.advanceServer(2 * DAY);
  const decision = await f.manager.start({ online: true });
  assert.equal(decision.allowed, true);
  const file = JSON.parse(f.storage.readText('license.lic'));
  assert.equal(Date.parse(file.payload.expiresAt) > originalExpiry, true);
});

test('revoked license is blocked when online', async () => {
  const f = fixture();
  await activated(f);
  f.api.license.status = 'REVOKED';
  const decision = await f.manager.start({ online: true });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, 'REVOKED');
});

test('modified license file is detected as tampered', async () => {
  const f = fixture();
  await activated(f);
  const file = JSON.parse(f.storage.readText('license.lic'));
  file.payload.customerName = 'Attacker';
  f.storage.writeText('license.lic', JSON.stringify(file));
  const decision = await f.manager.checkOffline();
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, 'TAMPERED');
});

test('invalid Ed25519 signature blocks access', async () => {
  const f = fixture();
  await activated(f);
  const file = JSON.parse(f.storage.readText('license.lic'));
  file.signature = Buffer.from('not-a-real-signature').toString('base64url');
  f.storage.writeText('license.lic', JSON.stringify(file));
  const decision = await f.manager.checkOffline();
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, 'INVALID_SIGNATURE');
});

test('device transfer rebinds the license and invalidates the old device', async () => {
  const f = fixture();
  await activated(f);
  f.api.license.deviceFingerprint = OTHER_FINGERPRINT;
  f.advanceClient(60_000);
  f.advanceServer(60_000);

  const oldDevice = await f.manager.sync({ deviceFingerprint: FINGERPRINT });
  assert.equal(oldDevice.allowed, false);
  assert.equal(oldDevice.code, 'DEVICE_MISMATCH');

  const newDevice = await f.manager.sync({ deviceFingerprint: OTHER_FINGERPRINT });
  assert.equal(newDevice.allowed, true);
  assert.equal((await f.manager.checkOffline({ deviceFingerprint: OTHER_FINGERPRINT })).allowed, true);
  assert.equal((await f.manager.checkOffline({ deviceFingerprint: FINGERPRINT })).code, 'DEVICE_MISMATCH');
});

test('system clock rollback requires online re-verification', async () => {
  const f = fixture();
  await activated(f);
  f.rewindClient(2 * DAY);
  const blocked = await f.manager.checkOffline();
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.code, 'CLOCK_ROLLBACK');
  assert.equal(blocked.requiresOnline, true);

  // Moving the clock back to a trusted time and syncing clears the flag.
  f.advanceClient(2 * DAY + 60_000);
  f.advanceServer(60_000);
  const decision = await f.manager.start({ online: true });
  assert.equal(decision.allowed, true);
});

test('offline stays valid until expiry (grace not enforced offline)', async () => {
  const f = fixture({ graceDays: 0 });
  await activated(f);
  // grace disabled → offline still valid until expiry
  const disabled = await f.manager.checkOffline();
  assert.equal(disabled.allowed, true);
  assert.equal(disabled.code, 'VALID');

  f.api.graceDays = 3;
  await f.manager.start({ online: true });
  f.advanceClient(2 * DAY);
  assert.equal((await f.manager.checkOffline()).allowed, true);

  // advancing past expiry (365 days) blocks offline access
  f.advanceClient(366 * DAY);
  const expired = await f.manager.checkOffline();
  assert.equal(expired.allowed, false);
  assert.equal(expired.code, 'EXPIRED');
});
