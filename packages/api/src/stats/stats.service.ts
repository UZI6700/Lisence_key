import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DAY = 86_400_000;

@Injectable()
export class StatsService {
  constructor(private prisma: PrismaService) {}

  private pctChange(current: number, previous: number): number {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 1000) / 10;
  }

  async dashboard() {
    const now = Date.now();
    const weekAgo = new Date(now - 7 * DAY);
    const fortnightAgo = new Date(now - 14 * DAY);

    const [
      licenses, activeLicenses, expiredLicenses, pendingLicenses, revokedLicenses,
      licensesThisWeek, licensesLastWeek,
      products, customers, customersThisWeek, customersLastWeek,
      devices, activeDevices, devicesThisWeek, devicesLastWeek,
      subscriptions, activeSubscriptions,
      expiringSoon, recentActivity, recentLicenses,
      activeSubscriptionsWithPlans,
    ] = await Promise.all([
      this.prisma.license.count(),
      this.prisma.license.count({ where: { status: 'ACTIVE' } }),
      this.prisma.license.count({ where: { status: 'EXPIRED' } }),
      this.prisma.license.count({ where: { status: 'PENDING' } }),
      this.prisma.license.count({ where: { status: 'REVOKED' } }),
      this.prisma.license.count({ where: { createdAt: { gte: weekAgo } } }),
      this.prisma.license.count({ where: { createdAt: { gte: fortnightAgo, lt: weekAgo } } }),
      this.prisma.product.count(),
      this.prisma.customer.count(),
      this.prisma.customer.count({ where: { createdAt: { gte: weekAgo } } }),
      this.prisma.customer.count({ where: { createdAt: { gte: fortnightAgo, lt: weekAgo } } }),
      this.prisma.device.count(),
      this.prisma.device.count({ where: { status: 'ACTIVE' } }),
      this.prisma.device.count({ where: { createdAt: { gte: weekAgo } } }),
      this.prisma.device.count({ where: { createdAt: { gte: fortnightAgo, lt: weekAgo } } }),
      this.prisma.subscription.count(),
      this.prisma.subscription.count({ where: { status: 'ACTIVE' } }),
      this.prisma.license.count({
        where: { status: 'ACTIVE', expiresAt: { lte: new Date(now + 30 * DAY) } },
      }),
      this.prisma.activityLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.license.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { product: true, customer: true },
      }),
      this.prisma.subscription.findMany({
        where: { status: 'ACTIVE' },
        include: { subscriptionPlan: true },
      }),
    ]);

    // Real 7-day trend from issued licenses and recorded activations
    const trend: { name: string; activated: number; renewed: number }[] = [];
    for (let i = 6; i >= 0; i -= 1) {
      const start = new Date(now - (i + 1) * DAY);
      const end = new Date(now - i * DAY);
      const [issued, activated] = await Promise.all([
        this.prisma.license.count({ where: { createdAt: { gte: start, lt: end } } }),
        this.prisma.licenseActivation.count({ where: { activatedAt: { gte: start, lt: end }, success: true } }),
      ]);
      trend.push({
        name: start.toLocaleDateString(undefined, { weekday: 'short' }),
        activated: issued,
        renewed: activated,
      });
    }

    const revenue = activeSubscriptionsWithPlans.reduce((sum, s) => sum + (s.subscriptionPlan?.price || 0), 0);

    return {
      licenses: { total: licenses, active: activeLicenses, expired: expiredLicenses, pending: pendingLicenses, revoked: revokedLicenses, expiringSoon },
      products: { total: products },
      customers: { total: customers },
      devices: { total: devices, active: activeDevices },
      subscriptions: { total: subscriptions, active: activeSubscriptions },
      revenue: { total: revenue, currency: 'USD' },
      changes: {
        licenses: this.pctChange(licensesThisWeek, licensesLastWeek),
        devices: this.pctChange(devicesThisWeek, devicesLastWeek),
        customers: this.pctChange(customersThisWeek, customersLastWeek),
        revenue: this.pctChange(licensesThisWeek, licensesLastWeek),
      },
      trend,
      recentActivity,
      recentLicenses: recentLicenses.map((l) => ({
        id: l.id,
        licenseKey: l.licenseKey,
        customer: l.customer?.name || null,
        product: l.product?.name || null,
        status: l.status,
        expiresAt: l.expiresAt,
      })),
      generatedAt: new Date().toISOString(),
    };
  }
}
