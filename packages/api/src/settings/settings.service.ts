import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';

export interface PublicSettings {
  publicKey: string;
  publicKeyFingerprint: string;
  offlineGraceDays: number;
  licenseFileVersion: number;
  apiBaseUrl: string;
  version: string;
}

const DEFAULTS = {
  offlineGraceDays: '7',
  licenseFileVersion: '1',
  apiBaseUrl: '/api/v1',
};

@Injectable()
export class SettingsService {
  constructor(private crypto: CryptoService, private prisma: PrismaService) {}

  /** Read configuration from the database, falling back to safe defaults. */
  async get(): Promise<PublicSettings> {
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { in: Object.keys(DEFAULTS) } },
    });
    const values: Record<string, string> = { ...DEFAULTS };
    for (const row of rows) values[row.key] = row.value;
    const publicKey = this.crypto.getPublicKeyPem();
    const graceDays = this.parseGrace(values.offlineGraceDays);

    return {
      publicKey,
      publicKeyFingerprint: createHash('sha256')
        .update(publicKey)
        .digest('hex')
        .toUpperCase()
        .match(/.{1,2}/g)
        ?.slice(0, 8)
        .join(':') || '',
      offlineGraceDays: graceDays,
      licenseFileVersion: Number(values.licenseFileVersion) || 1,
      apiBaseUrl: values.apiBaseUrl || '/api/v1',
      version: '1.0.0',
    };
  }

  /** Configuration that a desktop client needs before it has a license file. */
  async publicConfig() {
    const settings = await this.get();
    return {
      apiBaseUrl: settings.apiBaseUrl,
      publicKey: settings.publicKey,
      publicKeyFingerprint: settings.publicKeyFingerprint,
      offlineGraceDays: settings.offlineGraceDays,
      licenseFileVersion: settings.licenseFileVersion,
      serverTime: new Date().toISOString(),
    };
  }

  /** Admin-only: update runtime configuration. 0 disables offline grace. */
  async update(dto: { offlineGraceDays?: number; licenseFileVersion?: number; apiBaseUrl?: string }) {
    const data: Array<{ key: string; value: string; description?: string }> = [];

    if (dto.offlineGraceDays !== undefined) {
      const days = this.parseGrace(String(dto.offlineGraceDays));
      data.push({
        key: 'offlineGraceDays',
        value: String(days),
        description: 'Days a desktop client may run offline after its last server validation (0 = disabled)',
      });
    }
    if (dto.licenseFileVersion !== undefined) {
      const version = Number(dto.licenseFileVersion);
      if (!Number.isInteger(version) || version < 1 || version > 100) {
        throw new BadRequestException('licenseFileVersion must be an integer between 1 and 100');
      }
      data.push({ key: 'licenseFileVersion', value: String(version) });
    }
    if (dto.apiBaseUrl !== undefined) {
      if (!/^https:\/\//.test(dto.apiBaseUrl) && !dto.apiBaseUrl.startsWith('/')) {
        throw new BadRequestException('apiBaseUrl must be an absolute HTTPS URL or a same-origin path');
      }
      data.push({ key: 'apiBaseUrl', value: dto.apiBaseUrl });
    }

    for (const entry of data) {
      await this.prisma.systemSetting.upsert({
        where: { key: entry.key },
        create: { key: entry.key, value: entry.value, description: entry.description },
        update: { value: entry.value, ...(entry.description ? { description: entry.description } : {}) },
      });
    }
    return this.get();
  }

  /** Used by OfflineService when signing a license file. */
  async offlineGraceDays(): Promise<number> {
    return (await this.get()).offlineGraceDays;
  }

  private parseGrace(value: string | number | null | undefined): number {
    const days = Number(value ?? DEFAULTS.offlineGraceDays);
    if (!Number.isFinite(days) || days < 0) return Number(DEFAULTS.offlineGraceDays);
    return Math.min(3650, Math.floor(days));
  }
}
