import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ActivityService } from './activity.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('api/v1/activity')
export class ActivityController {
  constructor(private activityService: ActivityService) {}

  @Get()
  list(@Query() query: any) {
    return this.activityService.list(query);
  }
}
