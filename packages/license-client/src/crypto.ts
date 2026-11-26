import { canonicalJson } from './canonical';
import type { OfflineLicensePayload, SignedLicenseFile } from './types';

export type FileVerification =
  | { valid: true; payload: OfflineLicensePayload }
  | { valid: false; code: 'MALFORMED' | 'TAMPERED' | 'INVALID_SIGNATURE' | 'NO_CRYPTO'; error: string };

const encoder = new TextEncoder();

function base64urlToBytes(value: string): Uint8Array {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  return base64urlToBytes(body.replace(/\+/g, '-').replace(/\//g, '_'));
}

/**
 * Verify a `license.lic` file using the embedded Ed25519 PUBLIC key.
 * Uses WebCrypto (available in browsers, Electron, Node 20+); no private key is
 * ever loaded by the desktop application.
 */
export async function verifyLicenseFile(
  file: SignedLicenseFile,
  publicKeyPem: string,
): Promise<FileVerification> {
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

  let signedBytes: Uint8Array;
  try {
    signedBytes = base64urlToBytes(file.signedData);
    const decoded = new TextDecoder().decode(signedBytes);
    if (decoded !== canonicalJson(file.payload)) {
      return { valid: false, code: 'TAMPERED', error: 'License file contents were modified.' };
    }
  } catch {
    return { valid: false, code: 'MALFORMED', error: 'License file data could not be decoded.' };
  }

  const subtle = (globalThis as any)?.crypto?.subtle;
  if (!subtle) {
    return { valid: false, code: 'NO_CRYPTO', error: 'WebCrypto Ed25519 is not available in this runtime.' };
  }

  try {
    const key = await subtle.importKey(
      'spki',
      pemToDer(publicKeyPem),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    const ok = await subtle.verify('Ed25519', key, base64urlToBytes(file.signature), signedBytes);
    if (!ok) {
      return { valid: false, code: 'INVALID_SIGNATURE', error: 'License file signature is invalid.' };
    }
    return { valid: true, payload: file.payload };
  } catch (e: any) {
    return { valid: false, code: 'INVALID_SIGNATURE', error: e?.message || 'Signature verification failed.' };
  }
}
