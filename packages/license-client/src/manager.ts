import { verifyLicenseFile } from './crypto';
import type {
  ActivateInput,
  DecisionCode,
  FetchLike,
  FetchResponseLike,
  LicenseDecision,
  LicenseStorage,
  LocalClockState,
  SignedLicenseFile,
  StartInput,
} from './types';

const DAY = 86_400_000;

export interface LicenseManagerOptions {
  /** e.g. https://license.example.com/api/v1 */
  apiBaseUrl?: string;
  /** Embed the server's PUBLIC key in the desktop application at build time. */
  publicKeyPem?: string;
  /** Optional product identity checked against every license file. */
  productId?: string;
  storage: LicenseStorage;
  fetchFn?: FetchLike;
  /** Injectable clock for tests. Defaults to Date.now(). */
  now?: () => number;
  licenseFileName?: string;
  stateFileName?: string;
  /** Allowed clock skew in milliseconds (default 5 minutes). */
  clockToleranceMs?: number;
}

/**
 * Drop-in licensing manager for a desktop application.
 *
 * - activate() performs online activation and atomically writes `license.lic`
 * - start() synchronizes when online and falls back to verified offline mode
 * - checkOffline() verifies signature, identity, expiry, grace and clock rollback
 */
export class LicenseManager {
  private readonly apiBaseUrl: string;
  private readonly storage: LicenseStorage;
  private readonly fetchFn: FetchLike;
  private readonly now: () => number;
  private readonly licenseFileName: string;
  private readonly stateFileName: string;
  private readonly tolerance: number;
  private publicKeyPem: string;
  private readonly productId?: string;

  constructor(options: LicenseManagerOptions) {
    if (!options.storage) throw new Error('storage is required');
    const base = (options.apiBaseUrl || '/api/v1').replace(/\/$/, '');
    if (/^http:\/\//i.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(`${base}/`)) {
      throw new Error('License API must use HTTPS in production');
    }
    this.apiBaseUrl = base;
    this.storage = options.storage;
    this.publicKeyPem = options.publicKeyPem || '';
    this.productId = options.productId;
    this.now = options.now || (() => Date.now());
    this.fetchFn = options.fetchFn || ((url, init) => fetch(url, init) as Promise<FetchResponseLike>);
    this.licenseFileName = options.licenseFileName || 'license.lic';
    this.stateFileName = options.stateFileName || 'license.state.json';
    this.tolerance = options.clockToleranceMs ?? 5 * 60 * 1000;
  }

  /** Fetch public configuration (including the public key) from the API. */
  async bootstrapPublicKey(): Promise<{ publicKey: string; publicKeyFingerprint: string; offlineGraceDays: number }> {
    const config = await this.get('/offline/config');
    if (config?.publicKey) this.publicKeyPem = config.publicKey;
    return config;
  }

  /** First-time online activation. Writes the signed local license file. */
  async activate(input: ActivateInput): Promise<{ file: SignedLicenseFile; decision: LicenseDecision }> {
    if (!input?.licenseKey) throw new Error('licenseKey is required');
    await this.ensurePublicKey();
    const state = this.readState();
    const result = await this.post('/offline/activate', {
      licenseKey: input.licenseKey.trim().toUpperCase(),
      deviceFingerprint: input.deviceFingerprint,
      requestCode: input.requestCode,
      productId: input.productId || this.productId,
      productCode: input.productCode,
      clientTime: new Date(this.now()).toISOString(),
      clockSequence: state.clockSequence + 1,
    });

    if (!result?.activated || !result.licenseFile) {
      throw new Error(result?.reason || result?.message || 'Activation failed');
    }
    const verification = await verifyLicenseFile(result.licenseFile, this.publicKeyPem);
    if (!verification.valid) {
      return {
        file: result.licenseFile,
        decision: this.blocked(verification.code as DecisionCode, verification.error, result.licenseFile),
      };
    }
    this.write(result.licenseFile, state, result.serverTime);
    const decision = await this.checkOffline({
      deviceFingerprint: input.deviceFingerprint,
      productId: input.productId,
    });
    return { file: result.licenseFile, decision };
  }

  /**
   * Application startup. With `online: true`, re-verifies with the server first;
   * if the network is unavailable, falls back to the signed offline file.
   */
  async start(input: StartInput = {}): Promise<LicenseDecision> {
    if (input.online) {
      try {
        return await this.sync(input);
      } catch (e: any) {
        const offline = await this.checkOffline(input);
        return {
          ...offline,
          code: offline.allowed ? offline.code : offline.code,
          reason: offline.allowed
            ? `Offline mode (server unreachable): ${e?.message || 'network error'}`
            : offline.reason,
        };
      }
    }
    return this.checkOffline(input);
  }

  /** Online synchronization: refresh expiry, revocation status and trusted time. */
  async sync(input: { deviceFingerprint?: string; productId?: string } = {}): Promise<LicenseDecision> {
    const file = this.readFile();
    if (!file) return this.blocked('NO_LICENSE', 'No local license file. Activate this application first.', null, true);
    await this.ensurePublicKey();
    const state = this.readState();
    const result = await this.post('/offline/sync', {
      licenseKey: file.payload.licenseKey,
      deviceFingerprint: input.deviceFingerprint || file.payload.deviceFingerprint,
      productId: input.productId || this.productId || file.payload.productId,
      clientTime: new Date(this.now()).toISOString(),
      clockSequence: state.clockSequence + 1,
    });

    if (!result?.valid) {
      const code = this.serverCodeToDecisionCode(result?.code);
      return this.blocked(code, result?.reason || 'License is not valid', file);
    }
    if (!result.licenseFile) return this.blocked('SERVER_INVALID', 'Server did not return a signed license file', file);

    const verification = await verifyLicenseFile(result.licenseFile, this.publicKeyPem);
    if (!verification.valid) {
      return this.blocked(verification.code as DecisionCode, verification.error, file);
    }
    this.write(result.licenseFile, state, result.serverTime);
    return this.checkOffline({ deviceFingerprint: input.deviceFingerprint, productId: input.productId });
  }

  /** Pure offline verification — never contacts the API. */
  async checkOffline(input: { deviceFingerprint?: string; productId?: string } = {}): Promise<LicenseDecision> {
    const file = this.readFile();
    if (!file) return this.blocked('NO_LICENSE', 'No local license file found.', null, true);
    if (!this.publicKeyPem) {
      return this.blocked('NO_PUBLIC_KEY', 'Embed the server public key or call bootstrapPublicKey() while online.', file, true);
    }

    const verification = await verifyLicenseFile(file, this.publicKeyPem);
    if (!verification.valid) {
      return this.blocked(verification.code as DecisionCode, verification.error, file);
    }
    const payload = verification.payload;

    const expectedProduct = input.productId || this.productId;
    if (expectedProduct && payload.productId !== expectedProduct) {
      return this.blocked('PRODUCT_MISMATCH', 'License is not valid for this product.', file);
    }
    const expectedFingerprint = input.deviceFingerprint || payload.deviceFingerprint;
    if (expectedFingerprint && payload.deviceFingerprint !== expectedFingerprint.toUpperCase()) {
      return this.blocked('DEVICE_MISMATCH', 'License is bound to a different device.', file);
    }

    const nowMs = this.now();
    const state = this.readState();
    const trusted = Date.parse(payload.trustedTime || payload.serverTime);
    const observed = Math.max(
      Date.parse(payload.localTimeAtValidation) || 0,
      state.lastObservedLocalTime || 0,
      trusted || 0,
    );
    const trustedFloor = Number.isFinite(trusted) ? trusted - this.tolerance : 0;

    // Clock rollback: the local clock went behind a previously observed or
    // server-trusted time. Re-verification online is mandatory.
    if (nowMs < observed - this.tolerance || nowMs < trustedFloor) {
      return this.blocked(
        'CLOCK_ROLLBACK',
        'System clock moved backwards. Connect to the licensing server to re-verify.',
        file,
        true,
      );
    }

    // Never let a forwarded clock extend the subscription: use the maximum of
    // trusted and observed times for expiry decisions.
    const effectiveNow = Math.max(nowMs, observed, trustedFloor);
    const expires = Date.parse(payload.expiresAt);
    if (!Number.isFinite(expires) || effectiveNow >= expires) {
      return {
        ...this.blocked('EXPIRED', 'Subscription has expired.', file, true),
        expiresAt: payload.expiresAt,
        effectiveNow: new Date(effectiveNow).toISOString(),
      };
    }

    const lastValidated = Date.parse(payload.lastValidatedAt);

    // Offline validity runs until the subscription expiry date itself arrives.
    // Grace/staleness limits are intentionally NOT enforced here: a license that
    // has not reached expiresAt is allowed offline, even if it was last
    // validated a long time ago. Server sync (/offline/sync) still refreshes
    // trusted time and revocation when online.

    // Persist a monotonic observation; it is never allowed to move backwards.
    this.writeState({
      lastObservedLocalTime: Math.max(state.lastObservedLocalTime || 0, nowMs),
      clockSequence: Math.max(state.clockSequence || 0, payload.clockSequence || 0),
      lastSuccessfulValidation: payload.lastValidatedAt,
    });

    return {
      allowed: true,
      code: 'VALID',
      reason: 'License is valid',
      requiresOnline: false,
      file,
      effectiveNow: new Date(effectiveNow).toISOString(),
      expiresAt: payload.expiresAt,
      daysLeft: Math.max(0, Math.ceil((expires - effectiveNow) / DAY)),
    };
  }

  getLicenseFilePath(): string | undefined {
    return this.storage.baseDir ? `${this.storage.baseDir}/${this.licenseFileName}` : undefined;
  }

  readFile(): SignedLicenseFile | null {
    const raw = this.storage.readText(this.licenseFileName);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SignedLicenseFile;
    } catch {
      // A malformed file is returned as-is so verification reports MALFORMED.
      return { raw } as unknown as SignedLicenseFile;
    }
  }

  // ----------------------------------------------------------------
  // Internals
  // ----------------------------------------------------------------

  private async ensurePublicKey() {
    if (!this.publicKeyPem) await this.bootstrapPublicKey();
    if (!this.publicKeyPem) throw new Error('Server public key is not available');
  }

  private async get(path: string): Promise<any> {
    return this.request('GET', path);
  }

  private async post(path: string, body: Record<string, unknown>): Promise<any> {
    return this.request('POST', path, body);
  }

  private async request(method: string, path: string, body?: Record<string, unknown>): Promise<any> {
    const res = await this.fetchFn(`${this.apiBaseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error: any = new Error(data?.message || data?.reason || `Request failed (${res.status})`);
      error.code = data?.code;
      error.response = data;
      throw error;
    }
    return data;
  }

  private readState(): LocalClockState {
    const raw = this.storage.readText(this.stateFileName);
    if (!raw) return { lastObservedLocalTime: 0, clockSequence: 0, lastSuccessfulValidation: null };
    try {
      const parsed = JSON.parse(raw);
      return {
        lastObservedLocalTime: Number(parsed.lastObservedLocalTime) || 0,
        clockSequence: Number(parsed.clockSequence) || 0,
        lastSuccessfulValidation: parsed.lastSuccessfulValidation || null,
      };
    } catch {
      return { lastObservedLocalTime: 0, clockSequence: 0, lastSuccessfulValidation: null };
    }
  }

  private writeState(state: LocalClockState) {
    this.storage.writeText(this.stateFileName, JSON.stringify(state));
  }

  private write(file: SignedLicenseFile, state: LocalClockState, serverTime?: string) {
    this.storage.writeText(this.licenseFileName, JSON.stringify(file, null, 2));
    this.writeState({
      lastObservedLocalTime: Math.max(state.lastObservedLocalTime || 0, this.now()),
      clockSequence: Math.max(state.clockSequence || 0, file.payload.clockSequence || 0),
      lastSuccessfulValidation: serverTime || file.payload.lastValidatedAt,
    });
  }

  private blocked(code: DecisionCode, reason: string, file: SignedLicenseFile | null, requiresOnline = false): LicenseDecision {
    return {
      allowed: false,
      code,
      reason,
      requiresOnline: requiresOnline || code === 'CLOCK_ROLLBACK' || code === 'OFFLINE_GRACE_EXCEEDED' || code === 'OFFLINE_GRACE_DISABLED',
      file,
      effectiveNow: null,
      expiresAt: file?.payload?.expiresAt || null,
      daysLeft: null,
    };
  }

  private serverCodeToDecisionCode(code?: string): DecisionCode {
    switch (code) {
      case 'NOT_ACTIVATED': return 'NOT_ACTIVATED';
      case 'REVOKED': return 'REVOKED';
      case 'SUSPENDED': return 'SUSPENDED';
      case 'EXPIRED': return 'EXPIRED';
      case 'DEVICE_MISMATCH': return 'DEVICE_MISMATCH';
      case 'PRODUCT_MISMATCH': return 'PRODUCT_MISMATCH';
      default: return 'SERVER_INVALID';
    }
  }
}
