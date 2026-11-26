import { Controller, Get, UseGuards } from '@nestjs/common';
import { StatsService } from './stats.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('api/v1/stats')
export class StatsController {
  constructor(private statsService: StatsService) {}

  @Get('dashboard')
  dashboard() {
    return this.statsService.dashboard();
  }
}
