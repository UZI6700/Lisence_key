import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { SubscriptionService } from './subscription.service';

/** ISO-8601 date strings are accepted directly by Prisma DateTime fields. */
export interface CreateSubscriptionDto {
  userId: string;
  productId: string;
  planId: string;
  startDate: string;
  expiryDate: string;
  currentPeriodEnd: string;
  currentPeriodStart?: string;
  status?: string;
  cancelAt?: string | null;
  canceledAt?: string | null;
  trialEnd?: string | null;
  autoRenew?: boolean;
}

export type UpdateSubscriptionDto = Partial<CreateSubscriptionDto>;

@Controller('api/v1/subscriptions')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Get()
  async findAll(@Query('status') status?: string) {
    return this.subscriptionService.findAll(status);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.subscriptionService.findOne(id);
  }

  @Post()
  async create(@Body() dto: CreateSubscriptionDto) {
    return this.subscriptionService.create(dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateSubscriptionDto) {
    return this.subscriptionService.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.subscriptionService.remove(id);
  }
}
