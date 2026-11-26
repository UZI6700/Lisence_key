# Online + Offline License API

This document describes the complete licensing flow used by the NestJS API and the
`@lms/license-client` desktop library.

## Overview

```
                    ┌──────────────────────── online ────────────────────────┐
Desktop app  ──► POST /offline/activate ──► verify key / product / device / expiry
                    │                       register device ──► sign license.lic
                    │  (signature + payload written to OS app-data dir)
                    ▼
             start()
              ├── online ──► POST /offline/sync ──► refreshed signed file + trusted time
              └── offline ─► verify Ed25519 ─► identity ─► expiry ─► grace ─► clock rollback
```

**Rules**

- The server is the only holder of the Ed25519 **private** key. Desktop apps embed only the public key.
- Expiry is a hard server-side boundary. Offline grace is *only* a synchronization tolerance and
  is always capped by `expiresAt`; it can never extend a subscription.
- Subscription time starts at the **first successful activation**, not when the key is issued.
- Offline time decisions use `max(local clock, last observed local time, trusted server time − tolerance)`.
  Moving the clock forward cannot extend expiry; moving it backwards is detected and requires online re-verification.

---

## Endpoints

All paths are relative to `/api/v1`. HTTPS is required in production (Wasmer terminates TLS).
Desktop endpoints are authenticated by the license key + device fingerprint; they never require a JWT.

### `GET /offline/config` (public)

Bootstrap data for a fresh desktop installation.

```json
{
  "apiBaseUrl": "/api/v1",
  "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
  "publicKeyFingerprint": "AB:CD:...",
  "offlineGraceDays": 7,
  "licenseFileVersion": 1,
  "serverTime": "2026-11-25T10:00:00.000Z"
}
```

### `GET /offline/time` (public)

Trusted server clock. Use this instead of the local clock when verifying suspicious time changes.

```json
{ "serverTime": "...", "publicKeyFingerprint": "AB:CD:...", "gracePeriodDays": 7 }
```

### `POST /offline/activate`

First-time online activation.

```json
{
  "licenseKey": "DIG-8K29-XP71-MQ45",
  "deviceFingerprint": "AABBCCDD...",
  "requestCode": "PWPOS1-...",
  "productId": "prod_1",
  "productCode": "POS",
  "os": "Windows",
  "appVersion": "2.4.0",
  "clientTime": "2026-11-25T10:00:00.000Z",
  "clockSequence": 1
}
```

`deviceFingerprint` or `requestCode` is required. `productId`/`productCode` are optional but,
when supplied, are checked against both the signed token and the database.

Success (`201`):

```json
{
  "activated": true,
  "licenseFile": { "...": "signed license file" },
  "license": { "id": "...", "status": "ACTIVE", "expiresAt": "..." },
  "device": { "id": "...", "fingerprint": "...", "status": "ACTIVE" },
  "serverTime": "...",
  "daysLeft": 30
}
```

Failure codes: `NOT_FOUND`, `INVALID_SIGNATURE`, `REVOKED`, `SUSPENDED`, `EXPIRED`,
`PRODUCT_MISMATCH`, `DEVICE_MISMATCH`, `FINGERPRINT_REQUIRED`, `DEVICE_LIMIT`.

### `POST /offline/validate` and `POST /offline/sync`

Online startup check / re-synchronization. `sync` is an alias forcing a fresh signed file.

```json
{
  "licenseKey": "DIG-8K29-XP71-MQ45",
  "deviceFingerprint": "AABBCCDD...",
  "productId": "prod_1",
  "clientTime": "2026-11-25T10:00:00.000Z",
  "clockSequence": 4
}
```

Valid response (`200`):

```json
{
  "valid": true,
  "code": "VALID",
  "licenseFile": { "...": "newly signed file" },
  "serverTime": "2026-11-25T10:05:00.000Z",
  "gracePeriodDays": 7,
  "daysLeft": 30,
  "clockSkewDetected": false
}
```

Invalid response (`200`, so clients can degrade gracefully): `{ "valid": false, "code": "REVOKED", "reason": "...", "serverTime": "..." }`.
Codes: `REVOKED`, `SUSPENDED`, `EXPIRED`, `DEVICE_MISMATCH`, `PRODUCT_MISMATCH`, `INVALID_SIGNATURE`, `NOT_FOUND`, `NOT_ACTIVATED`.

`clockSkewDetected` is `true` when `clientTime` differs from server time by more than 5 minutes.
The signed file still contains the authoritative server time; use it to correct local state.

### `POST /offline/transfer/:licenseId` (JWT required)

Administrator endpoint to rebind a license after a device replacement/hardware change.
Body: `{ "fingerprint": "NEWFINGERPRINT..." }`. The old device is suspended.

---

## `license.lic` file format

Stored in the OS-specific application data directory as `license.lic` with restricted permissions.

```json
{
  "format": "LMS-LICENSE/1",
  "payloadEncoding": "base64url-json-canonical",
  "payload": {
    "v": 1,
    "format": "LMS-LICENSE/1",
    "licenseVersion": 1,
    "licenseId": "clx...",
    "licenseKey": "DIG-8K29-XP71-MQ45",
    "customerId": "clx...",
    "customerName": "Acme Ltd",
    "productId": "clx...",
    "productCode": "POS",
    "deviceFingerprint": "AABBCCDD...",
    "plan": "pro",
    "planId": "",
    "maxDevices": 3,
    "durationDays": 30,
    "issuedAt": "...",
    "activatedAt": "...",
    "firstActivatedAt": "...",
    "expiresAt": "...",
    "lastValidatedAt": "...",
    "serverTime": "...",
    "trustedTime": "...",
    "localTimeAtValidation": "...",
    "clockSequence": 1,
    "gracePeriodDays": 7
  },
  "signedData": "<base64url of canonical JSON bytes>",
  "signature": "<base64url Ed25519 signature>"
}
```

The signature covers the **canonical JSON bytes** (`signedData` decoded), not the base64url text.
Keys are sorted recursively and no insignificant whitespace is included. Verification rejects any
file where `signedData` does not match the canonical serialization of `payload`, so adding or
editing fields is detected before the signature is even checked.

A companion `license.state.json` (0600) stores monotonic local observations:
`lastObservedLocalTime`, `clockSequence`, `lastSuccessfulValidation`. The signed file remains the
security anchor; the state file only helps detect clock rollback between syncs.

---

## Offline decision codes (client)

| Code | Meaning | Requires online |
|---|---|---|
| `VALID` | Signature, identity, expiry, grace and clock checks passed | no |
| `NO_LICENSE` | No local file | yes |
| `NO_PUBLIC_KEY` | Public key not embedded and no network to fetch it | yes |
| `MALFORMED` / `TAMPERED` / `INVALID_SIGNATURE` | File failed integrity verification | yes |
| `PRODUCT_MISMATCH` / `DEVICE_MISMATCH` | File is for another product/device | yes |
| `EXPIRED` | `expiresAt` reached (grace never applies) | yes |
| `OFFLINE_GRACE_EXCEEDED` | Too long since last successful validation | yes |
| `OFFLINE_GRACE_DISABLED` | Administrator set grace to 0 | yes |
| `CLOCK_ROLLBACK` | Local clock moved behind trusted/observed time | yes |
| `REVOKED` / `SUSPENDED` | Server reported invalid status | yes |
| `NOT_ACTIVATED` | Key issued but never activated; no subscription clock started | yes |

---

## Subscription durations

`POST /licenses/issue` accepts `days` (30, 60, 365 or any custom value 1–3650) or `expiresAt`.
The value is stored as the authoritative `durationDays`. On first activation the server computes
`expiresAt = firstActivatedAt + durationDays`. Renewals (`POST /licenses/:id/renew`) update both
`expiresAt` and `durationDays`; the next sync signs the new expiry into the local file.

---

## Security notes

- Private key sources: `LICENSE_PRIVATE_KEY` secret (Wasmer), or `packages/api/keys/private.pem` locally.
- Desktop apps must embed only `publicKey`. `/settings`, `/offline/config` and `/api/v1/settings/public` never return private material.
- Local files are written atomically (temp + rename) with 0700 directory and 0600/0444 file modes.
- Revocation and suspension take effect at the next online sync; offline mode cannot know about them. Keep grace short enough for your risk model.
- All desktop endpoints must be reached over HTTPS. Set `apiBaseUrl` to an `https://` URL in production.
