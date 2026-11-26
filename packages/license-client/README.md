# @lms/license-client

Reusable licensing library for the desktop application. It performs online activation,
writes a signed `license.lic` into the OS-specific application data directory, verifies it
offline with the embedded Ed25519 **public** key, detects tampering/expiry/clock rollback and
synchronizes with the API whenever the network is available.

## Install / build

```bash
npm install        # from the repository root (npm workspace)
npm run build --workspace @lms/license-client
npm run test:licensing
```

## Electron / Node integration

```ts
import { LicenseManager, NodeLicenseStore } from '@lms/license-client'

const manager = new LicenseManager({
  apiBaseUrl: 'https://license.example.com/api/v1',
  // Embed the PEM from Settings → Signing Key at build time. Never ship the private key.
  publicKeyPem: LICENSE_PUBLIC_KEY_PEM,
  productId: 'prod_...',
  storage: new NodeLicenseStore({ appName: 'MyDesktopApp' }),
})

// First run (user enters DIG-XXXX-XXXX-XXXX key):
const { file, decision } = await manager.activate({
  licenseKey: userKey,
  deviceFingerprint: await getMachineFingerprint(),
})
if (!decision.allowed) showError(decision.code, decision.reason)

// Every startup:
const status = await manager.start({
  online: await isInternetAvailable(),
  deviceFingerprint: await getMachineFingerprint(),
})
if (!status.allowed) {
  showBlockedScreen(status.code, status.reason, status.requiresOnline)
} else {
  startApplication()
}
```

`NodeLicenseStore` resolves to:

- Windows: `%APPDATA%\mydesktopapp\license.lic`
- macOS: `~/Library/Application Support/mydesktopapp/license.lic`
- Linux: `$XDG_DATA_HOME/mydesktopapp/license.lic` (or `~/.local/share/mydesktopapp/license.lic`)

Directory mode is `0700`; the license file is written atomically with `0600` and then made
read-only (`0444` / Windows `+R`). Signature verification is the real anti-modification guard.

## Browser / Tauri / custom storage

Implement the tiny `LicenseStorage` interface (`readText`, `writeText`, `remove`) and pass it as
`storage`. Ed25519 verification uses WebCrypto, so no Node-specific APIs are required in the core.

## Offline decisions

`manager.checkOffline()` / `manager.start()` return:

```ts
{
  allowed: boolean
  code: 'VALID' | 'EXPIRED' | 'TAMPERED' | 'INVALID_SIGNATURE' |
        'DEVICE_MISMATCH' | 'PRODUCT_MISMATCH' | 'CLOCK_ROLLBACK' |
        'OFFLINE_GRACE_EXCEEDED' | 'OFFLINE_GRACE_DISABLED' | ...
  reason: string
  requiresOnline: boolean
  expiresAt: string | null
  daysLeft: number | null
}
```

See [docs/OFFLINE_LICENSE_API.md](../../docs/OFFLINE_LICENSE_API.md) for the file format and endpoint
reference, and [docs/OFFLINE_TESTING.md](../../docs/OFFLINE_TESTING.md) for the full test matrix.
