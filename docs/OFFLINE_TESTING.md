# Testing the online/offline licensing system

## 1. Automated test suite (no database required)

The client library ships a deterministic test suite that simulates the server, network failures,
file tampering, expiry, renewal, revocation, device transfer and clock manipulation. It also
includes a server/client interoperability test that signs with the real `CryptoService`.

```bash
npm install
npm run test:licensing
```

Expected: **12 tests pass**, including:

| Test | Scenario covered |
|---|---|
| server-signed file verifies with desktop public key | signature interoperability |
| first activation writes complete signed `license.lic` | first-time activation, file generation |
| startup without internet | offline application startup |
| startup with internet | signed file refresh + trusted time |
| subscription expiry while offline | expiry while offline |
| renewal extends expiry on sync | subscription renewal |
| revoked license | license revocation |
| modified license file | tamper detection |
| invalid signature | forged signature |
| device transfer | device transfer / binding |
| clock rollback | clock rollback detection + re-verification |
| grace disabled / exceeded | offline grace behaviour |

To run only one file: `cd packages/license-client && node --test tests/licensing.test.js`.

---

## 2. Verify server/client interop with the real API

The automated suite already checks the exact signing format. To exercise the HTTP endpoints
against a running API, apply the migrations and start the server first:

```bash
# PostgreSQL must be available via DATABASE_URL (or Wasmer DB_* variables)
npm install
npm run prisma:generate --workspace api
npm run db:migrate --workspace api            # applies 0001_init + 0002_offline_licensing
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='StrongPass123!' npm run setup --workspace api
npm start
```

Get a JWT (admin) and issue a license:

```bash
TOKEN=$(curl -s -X POST localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"StrongPass123!"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).accessToken")

curl -s -X POST localhost:3000/api/v1/licenses/issue \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"productCode":"POS","customerName":"Test Customer","customerEmail":"test@example.com","plan":"standard","days":30,"maxDevices":2}'
```

Copy the returned `licenseKey` (`DIG-XXXX-XXXX-XXXX`). Activate it from a desktop client:

```bash
curl -s -X POST localhost:3000/api/v1/offline/activate \
  -H 'Content-Type: application/json' \
  -d '{"licenseKey":"DIG-....","deviceFingerprint":"AABBCCDDEEFF00112233445566778899","productCode":"POS","clientTime":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}'
```

The response contains `licenseFile`. A desktop app writes it to `license.lic` using
`NodeLicenseStore` (or an equivalent platform store). Verify startup:

```bash
curl -s -X POST localhost:3000/api/v1/offline/sync \
  -H 'Content-Type: application/json' \
  -d '{"licenseKey":"DIG-....","deviceFingerprint":"AABBCCDDEEFF00112233445566778899","clockSequence":2}'
```

### Scenario checklist against the live API

| Scenario | How to test |
|---|---|
| First-time activation | `POST /offline/activate`, confirm `license.lic` is created and signature verifies |
| Automatic license file | Inspect the OS app-data dir from step above; file is 0600/0444 |
| Startup offline | Disconnect network, call `manager.start({ online: true })` → falls back to offline check |
| Startup online | Reconnect, call `manager.start({ online: true })` → new `lastValidatedAt` and trusted time |
| Expiry offline | Issue `days: 1`, advance client clock past expiry → `EXPIRED` |
| Renewal | `POST /licenses/:id/renew {"days":30}`, sync → new `expiresAt` in file |
| Revocation | `POST /licenses/:id/revoke`, sync → `REVOKED` |
| Modified file | Edit a field in `license.lic` → `TAMPERED` |
| Invalid signature | Replace `signature` → `INVALID_SIGNATURE` |
| Device transfer | `POST /offline/transfer/:id {"fingerprint":"NEW..."}`; old device fails, new device works |
| Clock rollback | Set client clock behind `trustedTime`/state → `CLOCK_ROLLBACK`, then sync to clear |
| Offline grace | Set grace to `0`/`3`/`7` in Settings, advance clock past `lastValidatedAt + grace` → blocked |

### Configure grace from the dashboard

Sign in to the admin console → **Settings** → **Offline Grace Period** → choose **Disabled**,
**3 days**, **7 days** or **Custom**, then **Save Changes**. The value is persisted in
`system_settings` and is included in every newly signed license file.

Equivalent API call:

```bash
curl -s -X PATCH localhost:3000/api/v1/settings \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"offlineGraceDays":3}'
```

---

## 3. Database verification

```sql
SELECT key, value FROM system_settings;
SELECT licenseId, result, reason, clientTime, serverTime
FROM license_validations ORDER BY "createdAt" DESC LIMIT 20;
SELECT licenseKey, firstActivatedAt, durationDays, expiresAt, deviceId FROM licenses;
```

`firstActivatedAt` should equal the first activation time. `clientTime` vs `serverTime` in the
validation log makes clock-skew investigations possible.

---

## 4. Important behaviours to remember

- Grace never extends `expiresAt`: an expired license is blocked even if grace is 30 days.
- Revocation/suspension is detected on the next successful online sync; while permanently offline the
  client can only use the last signed state. Keep grace aligned with your security policy.
- Clock rollback is a hard offline block. Online sync re-establishes trust and issues a new signed timestamp.
- A device transfer requires an administrator JWT; a customer cannot self-transfer by editing the file.
