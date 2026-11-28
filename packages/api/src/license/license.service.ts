import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService, LicensePayload } from '../crypto/crypto.service';

const DAY = 86_400_000;
const GRACE_PERIOD_DAYS = 7;

@Injectable()
export class LicenseService {
  constructor(private prisma: PrismaService, private crypto: CryptoService) {}

  /**
   * Resolve a user-facing license key to its full Ed25519 token.
   * New keys are short DIG- codes whose signed token is stored server-side;
   * legacy raw tokens remain valid for backwards compatibility.
   */
  private async resolveToken(key: string): Promise<string | null> {
    if (!key) return null;
    if (key.toUpperCase().startsWith('DIG-')) {
      const license = await this.prisma.license.findUnique({
        where: { licenseKey: key.toUpperCase() },
      });
      return license?.signaturePayload || null;
    }
    return key;
  }

  private findLicenseByKey(key: string, include?: any) {
    const normalized = key.toUpperCase().startsWith('DIG-') ? key.toUpperCase() : key;
    return this.prisma.license.findUnique({
      where: { licenseKey: normalized },
      ...(include ? { include } : {}),
    });
  }

  async issue(dto: {
    productId?: string;
    productCode?: string;
    customerId?: string;
    customerName?: string;
    customerEmail?: string;
    company?: string;
    plan?: string;
    days?: number;
    maxDevices?: number;
    requestCode?: string;
    expiresAt?: string;
  }) {
    // Resolve product
    const product = dto.productId
      ? await this.prisma.product.findUnique({ where: { id: dto.productId } })
      : dto.productCode
        ? await this.prisma.product.findUnique({ where: { code: dto.productCode } })
        : await this.prisma.product.findFirst({ where: { isActive: true } });
    if (!product) throw new NotFoundException('Product not found');

    // Resolve or create customer
    let customerId: string | undefined = dto.customerId;
    if (!customerId && dto.customerEmail) {
      const existing = await this.prisma.customer.findUnique({ where: { email: dto.customerEmail } });
      if (existing) customerId = existing.id;
      else {
        const created = await this.prisma.customer.create({
          data: {
            name: dto.customerName || dto.customerEmail.split('@')[0],
            email: dto.customerEmail,
            company: dto.company,
          },
        });
        customerId = created.id;
      }
    }
    if (!customerId && dto.customerName) {
      const created = await this.prisma.customer.create({
        data: { name: dto.customerName, email: `${Date.now()}@placeholder.local`, company: dto.company },
      });
      customerId = created.id;
    }

    // Device hashes from request code, or placeholders
    let deviceHashes: LicensePayload['deviceHashes'] = {
      mac: [],
      guid: this.crypto.fingerprint(`${Date.now()}-${Math.random()}`).slice(0, 16),
      board: this.crypto.fingerprint(`${Math.random()}-board`).slice(0, 16),
    };
    if (dto.requestCode) {
      try {
        const decoded = this.crypto.decodeRequestCode(dto.requestCode);
        deviceHashes = { mac: decoded.mac, guid: decoded.guid, board: decoded.board };
      } catch (e: any) {
        throw new BadRequestException(`Invalid request code: ${e.message}`);
      }
    }

    const days = Math.min(Math.max(Number(dto.days) || 365, 1), 3650);
    const maxDevices = Math.min(Math.max(Number(dto.maxDevices) || product.defaultDeviceLimit, 1), 100);
    const issuedAt = new Date();
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : new Date(issuedAt.getTime() + days * DAY);
    if (isNaN(expiresAt.getTime())) throw new BadRequestException('Invalid expiresAt date');

    const licenseKey = this.crypto.generateLicenseKey();
    const licenseDraft = await this.prisma.license.create({
      data: {
        licenseKey,
        licenseKeyHash: this.crypto.hashLicenseKey(licenseKey),
        status: 'PENDING',
        productId: product.id,
        customerId,
        expiresAt,
        durationDays: days,
        plan: dto.plan || 'standard',
        maxDevices,
      },
    });

    const payload: LicensePayload = {
      v: 1,
      customer: dto.customerName || (await this.prisma.customer.findUnique({ where: { id: customerId! } }))?.name || 'Customer',
      deviceHashes,
      plan: dto.plan || 'standard',
      maxDevices,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      licenseId: licenseDraft.id,
      productId: product.id,
      productCode: product.code,
      customerId: customerId || undefined,
      durationDays: days,
    };

    const token = this.crypto.issueToken(payload);
    const license = await this.prisma.license.update({
      where: { id: licenseDraft.id },
      data: {
        signaturePayload: token,
        status: 'ACTIVE',
        expiresAt,
      },
      include: { product: true, customer: true },
    });

    return { license, licenseKey, token, payload };
  }

  async activate(dto: {
    licenseKey: string;
    requestCode?: string;
    os?: string;
    browser?: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    if (!dto.licenseKey) throw new BadRequestException('licenseKey is required');
    const token = await this.resolveToken(dto.licenseKey);
    if (!token) {
      await this.recordFailedActivation(null, dto, 'License key not found');
      throw new NotFoundException('License key not found');
    }
    const verification = this.crypto.verifyToken(token);
    if (!verification.valid) {
      await this.recordFailedActivation(null, dto, verification.error || 'Invalid license key');
      throw new BadRequestException(verification.error || 'Invalid license key');
    }

    const license = await this.findLicenseByKey(dto.licenseKey, {
      product: true, customer: true, devices: true,
    });
    if (!license) {
      await this.recordFailedActivation(null, dto, 'License not found in database');
      throw new NotFoundException('License not found');
    }
    if (license.status === 'REVOKED' || license.status === 'SUSPENDED') {
      await this.recordFailedActivation(license.id, dto, `License is ${license.status.toLowerCase()}`);
      throw new BadRequestException(`License is ${license.status.toLowerCase()}`);
    }

    const graceCheck = this.checkExpiry(license.expiresAt, license.lastValidationAt, GRACE_PERIOD_DAYS);
    if (!graceCheck.usable) {
      await this.recordFailedActivation(license.id, dto, 'License has expired');
      throw new BadRequestException('License has expired');
    }

    let deviceHashes = verification.payload?.deviceHashes;
    if (dto.requestCode) {
      try {
        const decoded = this.crypto.decodeRequestCode(dto.requestCode);
        deviceHashes = { mac: decoded.mac, guid: decoded.guid, board: decoded.board };
      } catch {
        // fall back to token hashes
      }
    }
    const fingerprint = this.crypto.fingerprint(deviceHashes?.guid || verification.deviceId || dto.licenseKey);

    const device = await this.prisma.device.upsert({
      where: { fingerprint },
      create: {
        fingerprint,
        os: dto.os,
        browser: dto.browser,
        activatedAtIp: dto.ipAddress,
        userAgent: dto.userAgent,
        status: 'ACTIVE',
        activatedAt: new Date(),
        licenseId: license.id,
        lastValidation: new Date(),
      },
      update: {
        status: 'ACTIVE',
        activatedAt: new Date(),
        activatedAtIp: dto.ipAddress,
        userAgent: dto.userAgent,
        licenseId: license.id,
        lastValidation: new Date(),
      },
    });

    const activeCount = await this.prisma.device.count({
      where: { licenseId: license.id, status: 'ACTIVE' },
    });
    if (activeCount > license.maxDevices) {
      await this.prisma.device.update({ where: { id: device.id }, data: { status: 'BLOCKED' } });
      await this.recordFailedActivation(license.id, dto, 'Device limit exceeded', device.id);
      throw new ConflictException(`Device limit exceeded (max ${license.maxDevices})`);
    }

    await this.prisma.licenseActivation.create({
      data: {
        licenseId: license.id,
        deviceId: device.id,
        ipAddress: dto.ipAddress,
        userAgent: dto.userAgent,
        success: true,
      },
    });

    const updated = await this.prisma.license.update({
      where: { id: license.id },
      data: {
        status: 'ACTIVE',
        deviceId: fingerprint,
        activatedAt: license.activatedAt || new Date(),
        activatedFromIp: dto.ipAddress,
        activatedUserAgent: dto.userAgent,
        usesCount: { increment: 1 },
        lastValidationAt: new Date(),
        isInGracePeriod: graceCheck.inGrace,
      },
      include: { product: true, customer: true, devices: true },
    });

    return {
      activated: true,
      license: this.serialize(updated),
      device: { id: device.id, fingerprint: device.fingerprint, status: device.status },
      daysLeft: verification.daysLeft,
      inGracePeriod: graceCheck.inGrace,
    };
  }

  async validate(dto: {
    licenseKey: string;
    requestCode?: string;
    offline?: boolean;
    lastValidationAt?: string;
  }) {
    if (!dto.licenseKey) throw new BadRequestException('licenseKey is required');
    const token = await this.resolveToken(dto.licenseKey);
    if (!token) return { valid: false, reason: 'License key not found', code: 'NOT_FOUND' };
    const verification = this.crypto.verifyToken(token);
    if (!verification.valid) {
      return { valid: false, reason: verification.error || 'Invalid license key', code: 'INVALID_SIGNATURE' };
    }

    const license = await this.findLicenseByKey(dto.licenseKey, { product: true, customer: true });
    if (!license) return { valid: false, reason: 'License not found', code: 'NOT_FOUND' };
    if (license.status === 'REVOKED' || license.status === 'SUSPENDED') {
      return { valid: false, reason: `License is ${license.status.toLowerCase()}`, code: license.status };
    }

    const grace = this.checkExpiry(license.expiresAt, license.lastValidationAt, GRACE_PERIOD_DAYS);
    if (!grace.usable) {
      return { valid: false, reason: 'License has expired', code: 'EXPIRED', expiredAt: license.expiresAt };
    }

    // Offline grace: allow a limited window since last successful validation
    if (dto.offline && dto.lastValidationAt) {
      const last = new Date(dto.lastValidationAt);
      if (!isNaN(last.getTime()) && Date.now() - last.getTime() > GRACE_PERIOD_DAYS * DAY) {
        return { valid: false, reason: 'Offline grace period exceeded', code: 'OFFLINE_GRACE_EXCEEDED' };
      }
    }

    await this.prisma.license.update({
      where: { id: license.id },
      data: {
        lastValidationAt: new Date(),
        isInGracePeriod: false,
        gracePeriodEnd: null,
      },
    });

    return {
      valid: true,
      license: this.serialize(license),
      customer: verification.customer,
      plan: verification.plan,
      daysLeft: verification.daysLeft,
      maxDevices: verification.maxDevices,
      expiresAt: license.expiresAt,
      inGracePeriod: grace.inGrace,
      gracePeriodEnd: license.gracePeriodEnd,
    };
  }

  /**
   * Expiry is an absolute server-side boundary. Offline grace only limits how
   * long a client may go without a successful validation and is capped by the
   * real expiry — it can never authorize use past `expiresAt`.
   */
  private checkExpiry(expiresAt: Date, lastValidationAt: Date | null, graceDays: number) {
    const now = Date.now();
    if (now >= expiresAt.getTime()) return { usable: false, inGrace: false };
    const last = lastValidationAt?.getTime() ?? expiresAt.getTime() - graceDays * DAY;
    const offlineUntil = Math.min(expiresAt.getTime(), last + graceDays * DAY);
    return { usable: true, inGrace: now > offlineUntil };
  }

  private async recordFailedActivation(
    licenseId: string | null,
    dto: { requestCode?: string; ipAddress?: string; userAgent?: string },
    reason: string,
    deviceId?: string,
  ) {
    // Without a valid license/device we cannot always write an activation row (FK constraints).
    // Log to console instead; successful activations are fully audited in LicenseActivation.
    void licenseId; void dto; void deviceId;
    console.warn(`[license-activation-failed] ${reason}`);
  }

  async deactivate(id: string, dto?: { fingerprint?: string }) {
    const license = await this.prisma.license.findUnique({ where: { id } });
    if (!license) throw new NotFoundException('License not found');
    if (dto?.fingerprint) {
      const device = await this.prisma.device.findUnique({ where: { fingerprint: dto.fingerprint } });
      if (!device) throw new NotFoundException('Device not found');
      await this.prisma.device.update({ where: { id: device.id }, data: { status: 'SUSPENDED' } });
    } else {
      await this.prisma.device.updateMany({ where: { licenseId: id }, data: { status: 'SUSPENDED' } });
    }
    const updated = await this.prisma.license.update({
      where: { id },
      data: { deviceId: null, usesCount: 0 },
      include: { product: true, customer: true, devices: true },
    });
    return this.serialize(updated);
  }

  async revoke(id: string) {
    const license = await this.prisma.license.findUnique({ where: { id } });
    if (!license) throw new NotFoundException('License not found');
    const updated = await this.prisma.license.update({ where: { id }, data: { status: 'REVOKED' } });
    return this.serialize(updated);
  }

  async renew(
    id: string,
    dto: {
      days?: number;
      expiresAt?: string;
      maxDevices?: number;
      status?: string;
    } = {},
  ) {
    const license = await this.prisma.license.findUnique({ where: { id } });
    if (!license) throw new NotFoundException('License not found');

    const previousExpiry = license.expiresAt > new Date() ? license.expiresAt : new Date();

    // Custom absolute expiry wins; otherwise extend from the active expiry by N days.
    let newExpiry: Date;
    if (dto.expiresAt && Number.isFinite(Date.parse(dto.expiresAt))) {
      newExpiry = new Date(dto.expiresAt);
    } else {
      const days = Math.max(1, Math.floor(Number(dto.days) || 30));
      newExpiry = new Date(previousExpiry.getTime() + days * DAY);
    }

    // Ensure the new expiry is in the future.
    if (newExpiry.getTime() <= Date.now()) {
      throw new BadRequestException('New expiry must be in the future');
    }

    const durationDays = Math.max(1, Math.ceil((newExpiry.getTime() - Date.now()) / DAY));

    await this.prisma.licenseRenewal.create({
      data: { licenseId: id, previousExpiry, newExpiry, renewalType: 'MANUAL' },
    });

    const updated = await this.prisma.license.update({
      where: { id },
      data: {
        expiresAt: newExpiry,
        durationDays,
        status: dto.status || 'ACTIVE',
        ...(dto.maxDevices && Number(dto.maxDevices) > 0 ? { maxDevices: Math.floor(Number(dto.maxDevices)) } : {}),
        isInGracePeriod: false,
        gracePeriodEnd: null,
      },
      include: { product: true, customer: true },
    });
    return this.serialize(updated);
  }

  async list(query: {
    status?: string;
    productId?: string;
    customerId?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.productId) where.productId = query.productId;
    if (query.customerId) where.customerId = query.customerId;
    if (query.search) {
      where.OR = [
        { licenseKey: { contains: query.search } },
        { customer: { name: { contains: query.search } } },
        { product: { name: { contains: query.search } } },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.license.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { product: true, customer: true, _count: { select: { devices: true, activations: true } } },
      }),
      this.prisma.license.count({ where }),
    ]);
    return { data: items.map((l) => this.serialize(l)), total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const license = await this.prisma.license.findUnique({
      where: { id },
      include: {
        product: true,
        customer: true,
        devices: true,
        activations: { orderBy: { activatedAt: 'desc' }, take: 20 },
        renewals: { orderBy: { renewedAt: 'desc' } },
      },
    });
    if (!license) throw new NotFoundException('License not found');
    return this.serialize(license);
  }

  async findByKey(key: string) {
    const license = await this.findLicenseByKey(key, { product: true, customer: true, devices: true });
    if (!license) throw new NotFoundException('License not found');
    return this.serialize(license);
  }

  async update(id: string, dto: { status?: string; expiresAt?: string; maxDevices?: number; notes?: string }) {
    const license = await this.prisma.license.findUnique({ where: { id } });
    if (!license) throw new NotFoundException('License not found');
    const data: any = {};
    if (dto.status) data.status = dto.status;
    if (dto.expiresAt) {
      const date = new Date(dto.expiresAt);
      if (isNaN(date.getTime())) throw new BadRequestException('Invalid expiresAt date');
      data.expiresAt = date;
    }
    if (dto.maxDevices) data.maxDevices = Math.max(1, Number(dto.maxDevices));
    const updated = await this.prisma.license.update({
      where: { id },
      data,
      include: { product: true, customer: true, devices: true },
    });
    return this.serialize(updated);
  }

  async remove(id: string) {
    const license = await this.prisma.license.findUnique({ where: { id } });
    if (!license) throw new NotFoundException('License not found');

    // Child records with RESTRICT foreign keys must be removed first.
    // LicenseValidation already cascades; activations, renewals and device
    // bindings do not, so clean them up explicitly.
    await this.prisma.$transaction([
      this.prisma.licenseActivation.deleteMany({ where: { licenseId: id } }),
      this.prisma.licenseRenewal.deleteMany({ where: { licenseId: id } }),
      this.prisma.device.updateMany({ where: { licenseId: id }, data: { licenseId: null, status: 'SUSPENDED' } }),
      this.prisma.licenseValidation.deleteMany({ where: { licenseId: id } }),
      this.prisma.license.delete({ where: { id } }),
    ]);
    return { deleted: true, id };
  }

  async stats() {
    const [total, active, expired, pending, revoked, suspended, recent] = await Promise.all([
      this.prisma.license.count(),
      this.prisma.license.count({ where: { status: 'ACTIVE' } }),
      this.prisma.license.count({ where: { status: 'EXPIRED' } }),
      this.prisma.license.count({ where: { status: 'PENDING' } }),
      this.prisma.license.count({ where: { status: 'REVOKED' } }),
      this.prisma.license.count({ where: { status: 'SUSPENDED' } }),
      this.prisma.license.findMany({ orderBy: { createdAt: 'desc' }, take: 5, include: { product: true, customer: true } }),
    ]);
    return {
      total,
      active,
      expired,
      pending,
      revoked,
      suspended,
      expiringSoon: await this.prisma.license.count({
        where: { expiresAt: { lte: new Date(Date.now() + 30 * DAY) }, status: 'ACTIVE' },
      }),
      recent: recent.map((l) => this.serialize(l)),
    };
  }

  private serialize(license: any) {
    const {
      licenseKeyHash: _hash,
      signaturePayload: _payload,
      ...rest
    } = license;
    return {
      ...rest,
      keyPrefix: typeof license.licenseKey === 'string' ? license.licenseKey : '',
      daysLeft: Math.max(0, Math.ceil((new Date(license.expiresAt).getTime() - Date.now()) / DAY)),
    };
  }
}
