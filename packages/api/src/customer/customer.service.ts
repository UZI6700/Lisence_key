import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CustomerService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(active?: boolean) {
    return this.prisma.customer.findMany({
      where: active === undefined ? undefined : { isActive: active },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        _count: { select: { licenses: true } },
      },
    });
    if (!customer) throw new NotFoundException(`Customer with ID "${id}" not found`);
    return customer;
  }

  async create(data: Prisma.CustomerUncheckedCreateInput) {
    try {
      return await this.prisma.customer.create({ data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A customer with this email already exists');
      }
      throw error;
    }
  }

  async update(id: string, data: Prisma.CustomerUncheckedUpdateInput) {
    await this.ensureExists(id);
    try {
      return await this.prisma.customer.update({ where: { id }, data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A customer with this email already exists');
      }
      throw error;
    }
  }

  async remove(id: string) {
    await this.ensureExists(id);
    await this.prisma.customer.delete({ where: { id } });
    return { deleted: true, id };
  }

  private async ensureExists(id: string): Promise<void> {
    const customer = await this.prisma.customer.findUnique({ where: { id }, select: { id: true } });
    if (!customer) throw new NotFoundException(`Customer with ID "${id}" not found`);
  }
}
