import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const deviceInclude: Prisma.DeviceInclude = {
  license: { include: { product: true, customer: true } },
};

@Injectable()
export class DeviceService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(status?: string) {
    return this.prisma.device.findMany({
      where: status ? { status } : undefined,
      include: deviceInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const device = await this.prisma.device.findUnique({
      where: { id },
      include: deviceInclude,
    });
    if (!device) throw new NotFoundException(`Device with ID "${id}" not found`);
    return device;
  }

  async create(data: Prisma.DeviceUncheckedCreateInput) {
    try {
      return await this.prisma.device.create({ data, include: deviceInclude });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A device with this fingerprint already exists');
      }
      throw error;
    }
  }

  async update(id: string, data: Prisma.DeviceUncheckedUpdateInput) {
    await this.ensureExists(id);
    try {
      return await this.prisma.device.update({ where: { id }, data, include: deviceInclude });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A device with this fingerprint already exists');
      }
      throw error;
    }
  }

  async remove(id: string) {
    await this.ensureExists(id);
    await this.prisma.device.delete({ where: { id } });
    return { deleted: true, id };
  }

  private async ensureExists(id: string): Promise<void> {
    const device = await this.prisma.device.findUnique({ where: { id }, select: { id: true } });
    if (!device) throw new NotFoundException(`Device with ID "${id}" not found`);
  }
}
