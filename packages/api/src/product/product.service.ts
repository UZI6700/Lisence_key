import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(active?: boolean) {
    return this.prisma.product.findMany({
      where: active === undefined ? undefined : { isActive: active },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Lists available subscription plans (product-related catalog data). */
  async findPlans() {
    return this.prisma.subscriptionPlan.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        _count: { select: { licenses: true, subscriptions: true } },
      },
    });
    if (!product) throw new NotFoundException(`Product with ID "${id}" not found`);
    return product;
  }

  async create(data: Prisma.ProductUncheckedCreateInput) {
    try {
      return await this.prisma.product.create({ data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A product with this code already exists');
      }
      throw error;
    }
  }

  async update(id: string, data: Prisma.ProductUncheckedUpdateInput) {
    await this.ensureExists(id);
    try {
      return await this.prisma.product.update({ where: { id }, data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A product with this code already exists');
      }
      throw error;
    }
  }

  async remove(id: string) {
    await this.ensureExists(id);
    await this.prisma.product.delete({ where: { id } });
    return { deleted: true, id };
  }

  private async ensureExists(id: string): Promise<void> {
    const product = await this.prisma.product.findUnique({ where: { id }, select: { id: true } });
    if (!product) throw new NotFoundException(`Product with ID "${id}" not found`);
  }
}
