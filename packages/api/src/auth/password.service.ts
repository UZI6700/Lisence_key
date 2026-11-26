import { Injectable } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { argon2idAsync } from '@noble/hashes/argon2.js';

/**
 * argon2id password hashing in pure JavaScript.
 *
 * Uses the standard PHC string format ($argon2id$v=19$m=…,t=…,p=…$salt$hash),
 * so hashes produced by native argon2 implementations remain verifiable.
 * Pure JS is required because Wasmer Edge runs Node.js inside WebAssembly,
 * where native N-API modules cannot load.
 */
@Injectable()
export class PasswordService {
  private static readonly M = 19456; // 19 MiB
  private static readonly T = 2;
  private static readonly P = 1;
  private static readonly DKLEN = 32;

  private b64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64').replace(/=+$/, '');
  }

  async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = await argon2idAsync(password, salt, {
      m: PasswordService.M,
      t: PasswordService.T,
      p: PasswordService.P,
      dkLen: PasswordService.DKLEN,
      version: 0x13,
    });
    const { M, T, P } = PasswordService;
    return `$argon2id$v=19$m=${M},t=${T},p=${P}$${this.b64(salt)}$${this.b64(derived)}`;
  }

  async verifyPassword(stored: string, password: string): Promise<boolean> {
    try {
      const parts = stored.split('$');
      if (parts.length !== 6 || parts[1] !== 'argon2id') return false;
      const version = parts[2];
      if (version !== 'v=19') return false;

      const params: Record<string, number> = {};
      for (const pair of parts[3].split(',')) {
        const [key, value] = pair.split('=');
        params[key] = Number(value);
      }
      const { m, t, p } = params;
      if (!m || !t || !p) return false;

      const salt = Buffer.from(parts[4], 'base64');
      const expected = Buffer.from(parts[5], 'base64');
      const derived = await argon2idAsync(password, salt, { m, t, p, dkLen: expected.length, version: 0x13 });
      return expected.length === derived.length && timingSafeEqual(expected, Buffer.from(derived));
    } catch {
      return false;
    }
  }
}
