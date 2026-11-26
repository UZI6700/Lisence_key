import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { assertRole } from '../auth/roles';
import { SettingsService } from './settings.service';

@Controller('api/v1/settings')
export class SettingsController {
  constructor(private settingsService: SettingsService) {}

  /** Authenticated settings view used by the admin dashboard. */
  @Get()
  @UseGuards(JwtAuthGuard)
  get() {
    return this.settingsService.get();
  }

  /** Public bootstrap data for desktop clients (public key only, never private). */
  @Get('public')
  publicConfig() {
    return this.settingsService.publicConfig();
  }

  /** Admin-only configuration updates. */
  @Patch()
  @UseGuards(JwtAuthGuard)
  update(@Req() req: any, @Body() body: any) {
    assertRole(req, 'ADMIN');
    return this.settingsService.update(body || {});
  }
}
