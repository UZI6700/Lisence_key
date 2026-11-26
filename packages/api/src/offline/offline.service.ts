import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CryptoService,
  LicensePayload,
  OfflineLicensePayload,
  SignedLicenseFile,
} from '../crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

const DAY = 86_400_000;
const CLOCK_TOLERANCE_MS = 5 * 60 * 1000;

export interface ActivateOfflineDto {
  licenseKey: string;
  deviceFingerprint?: string;
  deviceId?: string;
  fingerprint?: string;
  requestCode?: string;
  productId?: string;
  productCode?: string;
  os?: string;
  browser?: string;
  appVersion?: string;
  clientTime?: string;
  clockSequence?: number;
  ipAddress?: string;
  userAgent?: string;
}

export interface ValidateOfflineDto {
  licenseKey: string;
  deviceFingerprint?: string;
  deviceId?: string;
  fingerprint?: string;
  requestCode?: string;
  productId?: string;
  productCode?: string;
  clientTime?: string;
  clockSequence?: number;
  refresh?: boolean;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class OfflineService {
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private settings: SettingsService,
  ) {}

  // ----------------------------------------------------------------
  // Public desktop-client endpoints
  // ----------------------------------------------------------------

  /**
   * First-time online activation. Verifies every dimension of the license and
   * returns an Ed25519-signed license file that the desktop app writes to its
   * OS-specific application data directory as `license.lic`.
   */
  async activate(dto: ActivateOfflineDto) {
    if (!dto?.licenseKey) throw new BadRequestException('licenseKey is required');

    const { license, verification } = await this.lookup(dto.licenseKey);
    const now = new Date();

    await this.assertUsable(license, verification, dto, now);

    const fingerprint = this.resolveFingerprint(dto, verification.payload);
    await this.assertDeviceBinding(license, fingerprint);

    // Subscription starts on the FIRST SUCCESSFUL ACTIVATION, not on issue.
    const firstActivation = license.firstActivatedAt || now;
    const expiresAt = license.firstActivatedAt
      ? license.expiresAt
      : new Date(firstActivation.getTime() + Math.max(1, license.durationDays) * DAY);

    let device = await this.prisma.device.findUnique({ where: { fingerprint } });
    if (!device) {
      device = await this.prisma.device.create({
        data: {
          fingerprint,
          os: dto.os,
          browser: dto.browser,
          userAgent: dto.userAgent || dto.appVersion,
          activatedAtIp: dto.ipAddress,
          activatedAt: now,
          lastValidation: now,
          status: 'ACTIVE',
          licenseId: license.id,
        },
      });
    } else {
      if (device.status === 'BLOCKED') {
        throw new ConflictException('This device is blocked. Contact your administrator.');
      }
      device = await this.prisma.device.update({
        where: { id: device.id },
        data: {
          status: 'ACTIVE',
          activatedAt: now,
          lastValidation: now,
          activatedAtIp: dto.ipAddress,
          userAgent: dto.userAgent || dto.appVersion || device.userAgent,
          licenseId: license.id,
        },
      });
    }

    const activeCount = await this.prisma.device.count({
      where: { licenseId: license.id, status: 'ACTIVE' },
    });
    if (activeCount > license.maxDevices) {
      await this.prisma.device.update({ where: { id: device.id }, data: { status: 'BLOCKED' } });
      await this.recordValidation(license.id, fingerprint, 'DEVICE_LIMIT', 'Device limit exceeded', now, dto.clientTime);
      throw new ConflictException(`Device limit exceeded (max ${license.maxDevices}); transfer a device in the admin console`);
    }

    await this.prisma.licenseActivation.create({
      data: {
        licenseId: license.id,
        deviceId: device.id,
        ipAddress: dto.ipAddress,
        userAgent: dto.userAgent || dto.appVersion,
        success: true,
      },
    });

    const updated = await this.prisma.license.update({
      where: { id: license.id },
      data: {
        status: 'ACTIVE',
        deviceId: fingerprint,
        activatedAt: license.activatedAt || now,
        firstActivatedAt: firstActivation,
        expiresAt,
        activatedFromIp: dto.ipAddress,
        activatedUserAgent: dto.userAgent || dto.appVersion,
        usesCount: { increment: 1 },
        lastValidationAt: now,
        isInGracePeriod: false,
        gracePeriodEnd: null,
      },
      include: { product: true, customer: true },
    });

    await this.recordValidation(license.id, fingerprint, 'VALID', 'Activated', now, dto.clientTime);

    const licenseFile = await this.buildLicenseFile(updated, fingerprint, now, dto, dto.clockSequence ?? 1);
    const posDeviceId = dto.deviceId || dto.fingerprint || fingerprint;
    return {
      activated: true,
      valid: true,                       // POS app checks valid === false
      licenseKey: this.buildPosToken(updated, posDeviceId, expiresAt),  // POS findToken()
      token: this.buildPosToken(updated, posDeviceId, expiresAt),
      licenseFile,
      license: this.serialize(updated),
      device: { id: device.id, fingerprint: device.fingerprint, status: device.status },
      serverTime: now.toISOString(),
      daysLeft: Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / DAY)),
    };
  }

  /**
   * Online startup / synchronization. Returns a freshly signed license file
   * with a new server timestamp, current expiry (renewals included) and the
   * current grace configuration. Revocation and suspension are enforced here.
   */
  async validate(dto: ValidateOfflineDto) {
    const serverTime = new Date();
    if (!dto?.licenseKey) {
      return this.invalid('MISSING_KEY', 'licenseKey is required', serverTime);
    }

    let lookupResult;
    try {
      lookupResult = await this.lookup(dto.licenseKey);
    } catch (e: any) {
      return this.invalid(e?.code || 'NOT_FOUND', e?.message || 'License not found', serverTime);
    }
    const { license, verification } = lookupResult;

    try {
      // Subscription clocks start on first activation; never validate a key
      // that was issued but never activated.
      if (license.status === 'PENDING' || !license.firstActivatedAt) {
        return this.invalid('NOT_ACTIVATED', 'Activate this license first', serverTime);
      }
      await this.assertUsable(license, verification, dto, serverTime);
      const fingerprint = this.resolveFingerprint(dto, verification.payload);
      await this.assertDeviceBinding(license, fingerprint);

      await this.prisma.license.update({
        where: { id: license.id },
        data: { lastValidationAt: serverTime, status: license.status === 'PENDING' ? 'ACTIVE' : license.status },
      });
      if (fingerprint) {
        await this.prisma.device.updateMany({
          where: { fingerprint, licenseId: license.id },
          data: { lastValidation: serverTime, status: 'ACTIVE' },
        });
      }
      await this.recordValidation(license.id, fingerprint || null, 'VALID', 'Online validation', serverTime, dto.clientTime);

      const clockSkewDetected = this.isClockSuspicious(dto.clientTime, serverTime);
      const posDeviceId = dto.deviceId || dto.fingerprint || fingerprint;
      const licenseFile = dto.refresh === false
        ? undefined
        : await this.buildLicenseFile(
            { ...license, lastValidationAt: serverTime },
            fingerprint,
            serverTime,
            dto,
            dto.clockSequence ?? 1,
          );

      return {
        valid: true,
        code: 'VALID',
        reason: 'License is valid',
        licenseKey: this.buildPosToken(license, posDeviceId, new Date(license.expiresAt)),
        token: this.buildPosToken(license, posDeviceId, new Date(license.expiresAt)),
        expiresAt: new Date(license.expiresAt).toISOString(),
        licenseFile,
        license: this.serialize({ ...license, lastValidationAt: serverTime }),
        serverTime: serverTime.toISOString(),
        gracePeriodDays: await this.settings.offlineGraceDays(),
        daysLeft: Math.max(0, Math.ceil((license.expiresAt.getTime() - serverTime.getTime()) / DAY)),
        inGracePeriod: false,
        clockSkewDetected,
      };
    } catch (e: any) {
      const code = e?.code || 'INVALID';
      await this.recordValidation(license.id, dto.deviceFingerprint || null, code, e?.message || 'Validation failed', serverTime, dto.clientTime);
      return this.invalid(code, e?.message || 'Validation failed', serverTime);
    }
  }

  /** Trusted server clock for desktop clients that need to re-check time. */
  async clock() {
    const [settings] = await Promise.all([this.settings.publicConfig()]);
    return {
      serverTime: new Date().toISOString(),
      publicKeyFingerprint: settings.publicKeyFingerprint,
      gracePeriodDays: settings.offlineGraceDays,
    };
  }

  // ----------------------------------------------------------------
  // Administrative device transfer
  // ----------------------------------------------------------------

  /** Move a license binding to a new device fingerprint (admin only). */
  async transferDevice(licenseId: string, fingerprint: string) {
    const clean = this.normalizeFingerprint(fingerprint);
    const license = await this.prisma.license.findUnique({
      where: { id: licenseId },
      include: { product: true, customer: true, devices: true },
    });
    if (!license) throw new NotFoundException('License not found');

    await this.prisma.device.updateMany({
      where: { licenseId: license.id, fingerprint: { not: clean } },
      data: { status: 'SUSPENDED' },
    });
    const device = await this.prisma.device.upsert({
      where: { fingerprint: clean },
      create: {
        fingerprint: clean,
        licenseId: license.id,
        status: 'ACTIVE',
        activatedAt: new Date(),
        lastValidation: new Date(),
      },
      update: { licenseId: license.id, status: 'ACTIVE', activatedAt: new Date(), lastValidation: new Date() },
    });
    const updated = await this.prisma.license.update({
      where: { id: license.id },
      data: { deviceId: clean, usesCount: { increment: 1 } },
      include: { product: true, customer: true, devices: true },
    });
    await this.recordValidation(license.id, clean, 'DEVICE_TRANSFER', 'Device binding transferred', new Date(), undefined);
    return { transferred: true, device: { id: device.id, fingerprint: device.fingerprint }, license: this.serialize(updated) };
  }

  // ----------------------------------------------------------------
  // Internals
  // ----------------------------------------------------------------

  private async lookup(key: string) {
    const resolved = this.resolvePosKey(key);
    const normalized = resolved.toUpperCase().startsWith('DIG-') ? resolved.toUpperCase() : resolved;
    let license = await this.prisma.license.findFirst({
      where: { OR: [{ licenseKey: normalized }, { signaturePayload: key }] },
      include: { product: true, customer: true },
    });
    if (!license) throw this.fail('NOT_FOUND', 'License key not found', new NotFoundException('License key not found'));

    const token = normalized.startsWith('DIG-') ? license.signaturePayload : key;
    if (!token) throw this.fail('INVALID_TOKEN', 'License token is missing', new BadRequestException('License token is missing'));
    const verification = this.crypto.verifyToken(token);
    if (!verification.valid) {
      throw this.fail(
        'INVALID_SIGNATURE',
        verification.error || 'Invalid license key',
        new BadRequestException(verification.error || 'Invalid license key'),
      );
    }
    return { license, verification };
  }

  private async assertUsable(
    license: any,
    verification: { payload?: LicensePayload },
    dto: { productId?: string; productCode?: string },
    now: Date,
  ) {
    if (license.status === 'REVOKED' || license.status === 'SUSPENDED') {
      throw this.fail(license.status, `License is ${license.status.toLowerCase()}`, new BadRequestException(`License is ${license.status.toLowerCase()}`));
    }

    // Product identity: checked against BOTH the signed token and the database.
    const signedProductId = verification.payload?.productId;
    const signedProductCode = verification.payload?.productCode;
    if (dto.productId && dto.productId !== license.productId && dto.productId !== 'plywoods-pos') {
      throw this.fail('PRODUCT_MISMATCH', 'License is not valid for this product', new BadRequestException('Product ID does not match this license'));
    }
    if (dto.productCode && dto.productCode !== license.product?.code && dto.productCode !== 'plywoods-pos') {
      throw this.fail('PRODUCT_MISMATCH', 'License is not valid for this product', new BadRequestException('Product code does not match this license'));
    }
    if (signedProductId && signedProductId !== license.productId) {
      throw this.fail('PRODUCT_MISMATCH', 'Signed product identity does not match database', new BadRequestException('Signed product identity mismatch'));
    }
    if (signedProductCode && signedProductCode !== license.product?.code) {
      throw this.fail('PRODUCT_MISMATCH', 'Signed product identity does not match database', new BadRequestException('Signed product identity mismatch'));
    }

    // Subscription expiry is an absolute server-side boundary: grace NEVER extends it.
    if (now.getTime() >= new Date(license.expiresAt).getTime()) {
      throw this.fail('EXPIRED', 'Subscription has expired', new BadRequestException('Subscription has expired'));
    }
  }

  private async assertDeviceBinding(license: any, fingerprint: string) {
    if (license.deviceId && license.deviceId !== fingerprint) {
      throw this.fail(
        'DEVICE_MISMATCH',
        'This license is bound to a different device',
        new ConflictException('This license is bound to a different device. Ask your administrator to transfer it.'),
      );
    }
  }

  private resolveFingerprint(dto: ActivateOfflineDto | ValidateOfflineDto, payload?: LicensePayload): string {
    if (dto.deviceFingerprint) return this.normalizeFingerprint(dto.deviceFingerprint);
    // PLY Woods POS sends a persistent device UUID as `deviceId`/`fingerprint`.
    if (dto.deviceId) return this.normalizeFingerprint(dto.deviceId);
    if (dto.fingerprint) return this.normalizeFingerprint(dto.fingerprint);
    if (dto.requestCode) {
      try {
        const decoded = this.crypto.decodeRequestCode(dto.requestCode);
        return this.normalizeFingerprint(decoded.guid + decoded.board);
      } catch {
        // fall through to signed token hashes
      }
    }
    if (payload?.deviceHashes?.guid) return this.normalizeFingerprint(payload.deviceHashes.guid);
    throw this.fail('FINGERPRINT_REQUIRED', 'Device fingerprint is required', new BadRequestException('Device fingerprint or request code is required'));
  }

  private normalizeFingerprint(value: string): string {
    const cleaned = String(value || '').trim().toUpperCase().replace(/[^A-F0-9]/g, '');
    if (!cleaned) throw new BadRequestException('Device fingerprint is invalid');
    return cleaned.length <= 128 ? cleaned : this.crypto.fingerprint(cleaned);
  }

  private isClockSuspicious(clientTime: string | undefined, serverTime: Date): boolean {
    if (!clientTime) return false;
    const client = new Date(clientTime).getTime();
    if (!Number.isFinite(client)) return true;
    return Math.abs(client - serverTime.getTime()) > CLOCK_TOLERANCE_MS;
  }

  /** Build a token in the exact format the PLY Woods POS desktop app verifies. */
  private buildPosToken(license: any, posDeviceId: string, expiresAt: Date): string {
    return this.crypto.issuePosToken({
      v: 1,
      licenseId: license.id,
      licenseKey: license.licenseKey,
      productId: 'plywoods-pos',
      deviceId: posDeviceId,
      activationId: license.id,
      customer: license.customer?.name || '',
      plan: license.plan || 'standard',
      status: license.status === 'REVOKED' ? 'revoked' : license.status === 'SUSPENDED' ? 'suspended' : 'active',
      expiresAt: new Date(expiresAt).toISOString(),
      issuedAt: new Date(license.issuedAt).toISOString(),
      keyId: 'dig-cloud',
      maxDevices: license.maxDevices,
    });
  }

  /** Resolve a license key that may be a POS token carrying the DIG key. */
  private resolvePosKey(key: string): string {
    const clean = String(key || '').trim();
    if (!clean.includes('.')) return clean;
    try {
      const payloadPart = clean.split('.')[0];
      const decoded = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
      if (typeof decoded.licenseKey === 'string') return decoded.licenseKey.toUpperCase();
    } catch { /* fall through */ }
    return clean;
  }

  private async buildLicenseFile(
    license: any,
    fingerprint: string,
    serverTime: Date,
    dto: ActivateOfflineDto | ValidateOfflineDto,
    clockSequence: number,
  ): Promise<SignedLicenseFile> {
    const gracePeriodDays = await this.settings.offlineGraceDays();
    const clientTime = dto.clientTime && !isNaN(new Date(dto.clientTime).getTime())
      ? new Date(dto.clientTime).toISOString()
      : serverTime.toISOString();
    const seq = Number.isFinite(Number(clockSequence)) ? Math.max(1, Math.floor(Number(clockSequence))) : 1;

    const payload: OfflineLicensePayload = {
      v: 1,
      format: 'LMS-LICENSE/1',
      licenseVersion: 1,
      licenseId: license.id,
      licenseKey: license.licenseKey,
      customerId: license.customerId || '',
      customerName: license.customer?.name || '',
      productId: license.productId,
      productCode: license.product?.code || '',
      deviceFingerprint: fingerprint,
      plan: license.plan || 'standard',
      planId: '',
      maxDevices: license.maxDevices,
      durationDays: license.durationDays,
      issuedAt: new Date(license.issuedAt).toISOString(),
      activatedAt: new Date(license.activatedAt || serverTime).toISOString(),
      firstActivatedAt: new Date(license.firstActivatedAt || serverTime).toISOString(),
      expiresAt: new Date(license.expiresAt).toISOString(),
      lastValidatedAt: serverTime.toISOString(),
      serverTime: serverTime.toISOString(),
      trustedTime: serverTime.toISOString(),
      localTimeAtValidation: clientTime,
      clockSequence: seq,
      gracePeriodDays,
    };
    return this.crypto.signLicenseFile(payload);
  }

  private async recordValidation(
    licenseId: string,
    fingerprint: string | null,
    result: string,
    reason: string,
    serverTime: Date,
    clientTime?: string,
  ) {
    const parsed = clientTime ? new Date(clientTime) : null;
    await this.prisma.licenseValidation.create({
      data: {
        licenseId,
        deviceFingerprint: fingerprint,
        result,
        reason,
        serverTime,
        clientTime: parsed && !isNaN(parsed.getTime()) ? parsed : null,
      },
    });
  }

  private invalid(code: string, reason: string, serverTime: Date) {
    return {
      valid: false,
      code,
      reason,
      serverTime: serverTime.toISOString(),
      licenseFile: undefined,
    };
  }

  private fail(code: string, reason: string, error: Error): Error & { code: string; reason: string } {
    return Object.assign(error, { code, reason });
  }

  private serialize(license: any) {
    const {
      licenseKeyHash: _hash,
      signaturePayload: _payload,
      ...rest
    } = license;
    return {
      ...rest,
      daysLeft: Math.max(0, Math.ceil((new Date(license.expiresAt).getTime() - Date.now()) / DAY)),
    };
  }
}
