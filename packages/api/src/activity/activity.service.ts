import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ActivityService {
  constructor(private prisma: PrismaService) {}

  async list(query: { limit?: number; action?: string }) {
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 30));
    const where: any = {};
    if (query.action) where.action = query.action;
    const items = await this.prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { user: { select: { name: true, email: true } } },
    });
    return items.map((log) => ({
      ...log,
      userEmail: log.user?.email || 'system',
      userName: log.user?.name || 'System',
    }));
  }
}
