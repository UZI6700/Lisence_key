import { Injectable, Logger } from '@nestjs/common';
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  createHash,
  randomInt,
  KeyObject,
} from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PREFIX = 'PWPOS1-';

export interface LicensePayload {
  v: number;
  customer: string;
  deviceHashes: { mac: string[]; guid: string; board: string };
  plan: string;
  maxDevices: number;
  issuedAt: string;
  expiresAt: string;
  licenseId?: string;
  productId?: string;
  productCode?: string;
  customerId?: string;
  durationDays?: number;
}

/**
 * The data that is digitally signed into a desktop `license.lic` file.
 * Every security-relevant field lives inside this object; the surrounding
 * envelope only carries the canonical encoding and the Ed25519 signature.
 */
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

/** Deterministic JSON: object keys sorted recursively, no insignificant whitespace. */
export function canonicalJson(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (input instanceof Date) return input.toISOString();
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === 'object') {
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(input as Record<string, unknown>).sort()) {
        const entry = (input as Record<string, unknown>)[key];
        if (entry !== undefined) result[key] = normalize(entry);
      }
      return result;
    }
    return input;
  };
  return JSON.stringify(normalize(value));
}

export interface VerificationResult {
  valid: boolean;
  payload?: LicensePayload;
  customer: string;
  plan: string;
  issuedAt: Date;
  expiresAt: Date;
  daysLeft: number | null;
  maxDevices: number;
  deviceId: string;
  error?: string;
}

@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly keysDir = join(process.cwd(), 'keys');
  private readonly privatePath = join(this.keysDir, 'private.pem');
  private readonly publicPath = join(this.keysDir, 'public.pem');

  private privateKeyPem: string | null = null;
  private publicKeyPem: string | null = null;

  constructor() {
    this.loadOrCreateKeys();
  }

  /** Load keys from disk (env override supported) or generate a dev keypair. */
  private loadOrCreateKeys() {
    const envPrivate = process.env.LICENSE_PRIVATE_KEY;
    const envPublic = process.env.LICENSE_PUBLIC_KEY;
    if (envPrivate && envPublic) {
      this.privateKeyPem = envPrivate.replace(/\\n/g, '\n');
      this.publicKeyPem = envPublic.replace(/\\n/g, '\n');
      return;
    }

    if (existsSync(this.privatePath) && existsSync(this.publicPath)) {
      this.privateKeyPem = readFileSync(this.privatePath, 'utf8');
      this.publicKeyPem = readFileSync(this.publicPath, 'utf8');
      return;
    }

    if (!existsSync(this.keysDir)) mkdirSync(this.keysDir, { recursive: true });
    const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    this.privateKeyPem = privateKey;
    this.publicKeyPem = publicKey;
    writeFileSync(this.privatePath, privateKey, { mode: 0o600 });
    writeFileSync(this.publicPath, publicKey);
    this.logger.warn('Generated new Ed25519 keypair in ./keys (development only)');
  }

  getPublicKeyPem(): string {
    return this.publicKeyPem!;
  }

  getPrivateKeyPem(): string {
    return this.privateKeyPem!;
  }

  private getPrivateKey(): KeyObject {
    return createPrivateKey(String(this.privateKeyPem).trim() + '\n');
  }

  private getPublicKey(): KeyObject {
    return createPublicKey(String(this.publicKeyPem).trim() + '\n');
  }

  /** Sign a license payload and return base64url(payload).base64url(signature). */
  issueToken(payload: LicensePayload): string {
    const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');
    const signature = sign(null, payloadBytes, this.getPrivateKey()).toString('base64url');
    return `${payloadBytes.toString('base64url')}.${signature}`;
  }

  /** Verify a license token against the server public key. */
  verifyToken(token: string): VerificationResult {
    const empty: VerificationResult = {
      valid: false,
      customer: '',
      plan: '',
      issuedAt: new Date(0),
      expiresAt: new Date(0),
      daysLeft: null,
      maxDevices: 0,
      deviceId: '',
    };
    if (typeof token !== 'string') return { ...empty, error: 'Invalid token.' };

    const parts = token.trim().split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return { ...empty, error: 'The license key format is invalid.' };
    }

    let payloadBytes: Buffer;
    let payload: LicensePayload;
    try {
      payloadBytes = Buffer.from(parts[0], 'base64url');
      payload = JSON.parse(payloadBytes.toString('utf8'));
    } catch {
      return { ...empty, error: 'Failed to decode license payload.' };
    }

    let valid = false;
    try {
      valid = verify(
        null,
        payloadBytes,
        this.getPublicKey(),
        Buffer.from(parts[1], 'base64url'),
      );
    } catch {
      valid = false;
    }

    if (!valid) {
      return {
        ...empty,
        customer: String(payload.customer ?? ''),
        plan: String(payload.plan ?? ''),
        maxDevices: Number(payload.maxDevices ?? 0),
        error: 'This key was signed by a different private key or was altered.',
      };
    }

    const issuedAt = new Date(String(payload.issuedAt));
    const expiresAt = new Date(String(payload.expiresAt));
    if (isNaN(issuedAt.getTime()) || isNaN(expiresAt.getTime())) {
      return { ...empty, error: 'Failed to parse license dates.' };
    }

    const daysLeft = Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000));
    const deviceId = String(payload.deviceHashes?.guid ?? '').substring(0, 8).toUpperCase();

    return {
      valid: true,
      payload,
      customer: String(payload.customer),
      plan: String(payload.plan),
      issuedAt,
      expiresAt,
      daysLeft,
      maxDevices: Number(payload.maxDevices),
      deviceId,
    };
  }

  /** Raw Ed25519 signature over arbitrary bytes, base64url encoded. */
  signData(data: Buffer | string): string {
    const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    return sign(null, bytes, this.getPrivateKey()).toString('base64url');
  }

  /** Verify a raw Ed25519 signature produced by signData. */
  verifyData(data: Buffer | string, signature: string): boolean {
    try {
      const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
      return verify(null, bytes, this.getPublicKey(), Buffer.from(signature, 'base64url'));
    } catch {
      return false;
    }
  }

  /**
   * Sign an offline license payload. The signature covers the canonical JSON
   * bytes, and `signedData` is stored in the file so the client can verify the
   * exact bytes that were signed.
   */
  signLicenseFile(payload: OfflineLicensePayload): SignedLicenseFile {
    const json = canonicalJson(payload);
    const signedBytes = Buffer.from(json, 'utf8');
    const signedData = signedBytes.toString('base64url');
    return {
      format: 'LMS-LICENSE/1',
      payloadEncoding: 'base64url-json-canonical',
      payload,
      signedData,
      signature: this.signData(signedBytes),
    };
  }

  /**
   * Verify an offline license file: canonical integrity + Ed25519 signature.
   * Returns the verified payload or a machine-readable error code.
   */
  verifyLicenseFile(file: SignedLicenseFile):
    | { valid: true; payload: OfflineLicensePayload }
    | { valid: false; code: 'MALFORMED' | 'TAMPERED' | 'INVALID_SIGNATURE'; error: string } {
    if (
      !file ||
      file.format !== 'LMS-LICENSE/1' ||
      file.payloadEncoding !== 'base64url-json-canonical' ||
      !file.payload ||
      typeof file.signedData !== 'string' ||
      typeof file.signature !== 'string'
    ) {
      return { valid: false, code: 'MALFORMED', error: 'The license file format is invalid.' };
    }

    let signedBytes: Buffer;
    try {
      signedBytes = Buffer.from(file.signedData, 'base64url');
      const recomputed = canonicalJson(file.payload);
      if (signedBytes.toString('utf8') !== recomputed) {
        return { valid: false, code: 'TAMPERED', error: 'License file payload was modified.' };
      }
    } catch {
      return { valid: false, code: 'MALFORMED', error: 'License file data could not be decoded.' };
    }

    if (!this.verifyData(signedBytes, file.signature)) {
      return { valid: false, code: 'INVALID_SIGNATURE', error: 'License file signature is invalid.' };
    }
    return { valid: true, payload: file.payload };
  }

  /**
   * Generate a human-friendly license key: DIG-XXXX-XXXX-XXXX
   * Uses uppercase letters and digits (example: DIG-8K29-XP71-MQ45).
   */
  generateLicenseKey(): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const group = () =>
      Array.from({ length: 4 }, () => alphabet[this.randomIndex(alphabet.length)]).join('');
    return `DIG-${group()}-${group()}-${group()}`;
  }

  private randomIndex(max: number): number {
    // randomInt is unbiased; fall back to Math.random for compatibility.
    try {
      return randomInt(max);
    } catch {
      return Math.floor(Math.random() * max);
    }
  }

  /** SHA-256 hash of a license key for storage. */
  hashLicenseKey(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }

  /** Deterministic fingerprint for a device string. */
  fingerprint(value: string): string {
    return createHash('sha256').update(value).digest('hex').toUpperCase();
  }

  /** Decode a device request code (PWPOS1-...). */
  decodeRequestCode(code: string): { mac: string[]; guid: string; board: string; count: number } {
    const cleaned = String(code)
      .trim()
      .toUpperCase()
      .replace(new RegExp(`^${PREFIX}`), '')
      .replace(/[^A-Z2-7]/g, '');
    if (!cleaned) throw new Error('Device Request Code is incomplete or mistyped.');

    const bytes = this.decodeBase32(cleaned);
    if (bytes.length < 20) {
      throw new Error(`Device Request Code is incomplete. Got ${bytes.length} bytes.`);
    }
    const payload = bytes.subarray(0, bytes.length - 2);
    const checksum = bytes.subarray(bytes.length - 2);
    const expected = createHash('sha256').update(payload).digest().subarray(0, 2);
    if (!checksum.equals(expected)) throw new Error('Device Request Code checksum is invalid.');
    if (payload[0] !== 1) throw new Error('Unsupported Device Request Code version.');

    const guid = payload.subarray(1, 9).toString('hex').toUpperCase();
    const board = payload.subarray(9, 17).toString('hex').toUpperCase();
    const count = payload[17];
    if (payload.length !== 18 + count * 8) throw new Error('Device Request Code length is invalid.');

    const mac: string[] = [];
    for (let i = 0; i < count; i += 1) {
      mac.push(payload.subarray(18 + i * 8, 26 + i * 8).toString('hex').toUpperCase());
    }
    if (count === 0) throw new Error('This Device Request Code has no readable MAC hash.');
    return { mac, guid, board, count };
  }

  /** Generate a device request code (useful for testing). */
  generateRequestCode(guidHex: string, boardHex: string, macHexes: string[]): string {
    const guid = Buffer.from(guidHex.replace(/[^0-9a-f]/gi, '').padEnd(16, '0').slice(0, 16), 'hex');
    const board = Buffer.from(boardHex.replace(/[^0-9a-f]/gi, '').padEnd(16, '0').slice(0, 16), 'hex');
    const payload = Buffer.alloc(18 + macHexes.length * 8);
    payload[0] = 1;
    guid.copy(payload, 1);
    board.copy(payload, 9);
    payload[17] = macHexes.length;
    macHexes.forEach((m, i) => {
      const b = Buffer.from(m.replace(/[^0-9a-f]/gi, '').padEnd(16, '0').slice(0, 16), 'hex');
      b.copy(payload, 18 + i * 8);
    });
    const checksum = createHash('sha256').update(payload).digest().subarray(0, 2);
    return `${PREFIX}${this.formatBase32(this.encodeBase32(Buffer.concat([payload, checksum])))}`;
  }

  private decodeBase32(text: string): Buffer {
    let bits = 0;
    let value = 0;
    const output: number[] = [];
    for (const character of text) {
      const index = ALPHABET.indexOf(character);
      if (index === -1) throw new Error('Invalid Device Request Code characters.');
      value = (value << 5) | index;
      bits += 5;
      if (bits >= 8) {
        bits -= 8;
        output.push((value >> bits) & 0xff);
      }
    }
    return Buffer.from(output);
  }

  private encodeBase32(data: Buffer): string {
    let bits = 0;
    let value = 0;
    const out: string[] = [];
    for (const byte of data) {
      value = (value << 8) | byte;
      bits += 8;
      while (bits >= 5) {
        bits -= 5;
        out.push(ALPHABET[(value >> bits) & 31]);
      }
    }
    if (bits > 0) out.push(ALPHABET[(value << (5 - bits)) & 31]);
    return out.join('');
  }

  private formatBase32(b32: string): string {
    const groups: string[] = [];
    for (let i = 0; i < b32.length; i += 8) groups.push(b32.substring(i, i + 8));
    return groups.join('-');
  }
}
