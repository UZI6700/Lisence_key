import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const subscriptionInclude: Prisma.SubscriptionInclude = {
  product: true,
  subscriptionPlan: true,
};

@Injectable()
export class SubscriptionService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(status?: string) {
    return this.prisma.subscription.findMany({
      where: status ? { status } : undefined,
      include: subscriptionInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
      include: subscriptionInclude,
    });
    if (!subscription) throw new NotFoundException(`Subscription with ID "${id}" not found`);
    return subscription;
  }

  async create(data: Prisma.SubscriptionUncheckedCreateInput) {
    return this.prisma.subscription.create({ data, include: subscriptionInclude });
  }

  async update(id: string, data: Prisma.SubscriptionUncheckedUpdateInput) {
    await this.ensureExists(id);
    return this.prisma.subscription.update({ where: { id }, data, include: subscriptionInclude });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    await this.prisma.subscription.delete({ where: { id } });
    return { deleted: true, id };
  }

  private async ensureExists(id: string): Promise<void> {
    const subscription = await this.prisma.subscription.findUnique({ where: { id }, select: { id: true } });
    if (!subscription) throw new NotFoundException(`Subscription with ID "${id}" not found`);
  }
}
