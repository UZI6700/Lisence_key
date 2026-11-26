import { Controller, Get, Query } from '@nestjs/common';
import { ActivityService } from './activity.service';

@Controller('api/v1/activity')
export class ActivityController {
  constructor(private activityService: ActivityService) {}

  @Get()
  list(@Query() query: any) {
    return this.activityService.list(query);
  }
}
