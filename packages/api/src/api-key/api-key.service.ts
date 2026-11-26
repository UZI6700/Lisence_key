import { createHash, randomBytes } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Never expose keyHash: every read uses this explicit select. */
const apiKeySelect: Prisma.ApiKeySelect = {
  id: true,
  name: true,
  keyPrefix: true,
  scopes: true,
  isActive: true,
  lastUsed: true,
  usageCount: true,
  expiresAt: true,
  createdAt: true,
};

type ApiKeyCreateData = Omit<Prisma.ApiKeyUncheckedCreateInput, 'keyHash' | 'keyPrefix'>;
type ApiKeyUpdateData = Omit<Prisma.ApiKeyUncheckedUpdateInput, 'keyHash' | 'keyPrefix'>;

@Injectable()
export class ApiKeyService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.apiKey.findMany({
      select: apiKeySelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { id },
      select: apiKeySelect,
    });
    if (!apiKey) throw new NotFoundException(`API key with ID "${id}" not found`);
    return apiKey;
  }

  async create(data: ApiKeyCreateData) {
    // The full key is returned to the caller exactly once; only its hash is stored.
    const key = `lmk_${randomBytes(32).toString('hex')}`;
    const keyHash = createHash('sha256').update(key).digest('hex');
    const keyPrefix = key.slice(0, 8);

    const record = await this.prisma.apiKey.create({
      data: { ...data, keyHash, keyPrefix },
      select: apiKeySelect,
    });
    return { ...record, key };
  }

  async update(id: string, data: ApiKeyUpdateData) {
    await this.ensureExists(id);
    return this.prisma.apiKey.update({
      where: { id },
      data,
      select: apiKeySelect,
    });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    await this.prisma.apiKey.delete({ where: { id } });
    return { deleted: true, id };
  }

  private async ensureExists(id: string): Promise<void> {
    const apiKey = await this.prisma.apiKey.findUnique({ where: { id }, select: { id: true } });
    if (!apiKey) throw new NotFoundException(`API key with ID "${id}" not found`);
  }
}
