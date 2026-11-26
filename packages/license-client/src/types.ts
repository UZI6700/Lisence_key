/** The signed payload written to `license.lic`. Mirrors the server format. */
export interface OfflineLicensePayload {
  v: 1;
  format: 'LMS-LICENSE/1';
  licenseVersion: number;
  licenseId: string;
  licenseKey: string;
  customerId: string;
  customerName: string;
  productId: string;
  productCode: string;
  deviceFingerprint: string;
  plan: string;
  planId: string;
  maxDevices: number;
  durationDays: number;
  issuedAt: string;
  activatedAt: string;
  firstActivatedAt: string;
  expiresAt: string;
  lastValidatedAt: string;
  serverTime: string;
  trustedTime: string;
  localTimeAtValidation: string;
  clockSequence: number;
  gracePeriodDays: number;
}

export interface SignedLicenseFile {
  format: 'LMS-LICENSE/1';
  payloadEncoding: 'base64url-json-canonical';
  payload: OfflineLicensePayload;
  signedData: string;
  signature: string;
}

/** Monotonic local observations; the signed file remains the trust anchor. */
export interface LocalClockState {
  lastObservedLocalTime: number;
  clockSequence: number;
  lastSuccessfulValidation: string | null;
}

/** Implement this to use the library in Electron, Tauri, mobile or a browser. */
export interface LicenseStorage {
  /** Returns null when the file does not exist. */
  readText(name: string): string | null;
  writeText(name: string, content: string): void;
  remove(name: string): void;
  readonly baseDir?: string;
}

export type DecisionCode =
  | 'VALID'
  | 'NO_LICENSE'
  | 'NO_PUBLIC_KEY'
  | 'MALFORMED'
  | 'TAMPERED'
  | 'INVALID_SIGNATURE'
  | 'PRODUCT_MISMATCH'
  | 'DEVICE_MISMATCH'
  | 'EXPIRED'
  | 'CLOCK_ROLLBACK'
  | 'OFFLINE_GRACE_EXCEEDED'
  | 'OFFLINE_GRACE_DISABLED'
  | 'NETWORK_ERROR'
  | 'NOT_ACTIVATED'
  | 'REVOKED'
  | 'SUSPENDED'
  | 'SERVER_INVALID';

export interface LicenseDecision {
  allowed: boolean;
  code: DecisionCode;
  reason: string;
  /** True when the desktop app must go online before allowing access. */
  requiresOnline: boolean;
  file: SignedLicenseFile | null;
  effectiveNow: string | null;
  expiresAt: string | null;
  daysLeft: number | null;
}

export interface ActivateInput {
  licenseKey: string;
  deviceFingerprint?: string;
  requestCode?: string;
  productId?: string;
  productCode?: string;
}

export interface StartInput {
  deviceFingerprint?: string;
  productId?: string;
  /** Try the licensing API first; fall back to offline checks if unreachable. */
  online?: boolean;
}

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<any>;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<FetchResponseLike>;
