import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { assertRole } from '../auth/roles';
import { SettingsService } from '../settings/settings.service';
import { OfflineService } from './offline.service';

/**
 * Endpoints used by desktop applications for online activation, startup
 * validation and synchronization. These are key-authenticated (the DIG license
 * key + device fingerprint), not JWT-authenticated.
 */
@Controller('api/v1/offline')
export class OfflineController {
  constructor(private offline: OfflineService, private settings: SettingsService) {}

  @Get('config')
  config() {
    return this.settings.publicConfig();
  }

  @Get('time')
  clock() {
    return this.offline.clock();
  }

  @Post('activate')
  activate(@Body() body: any) {
    return this.offline.activate(body || {});
  }

  @Post('validate')
  validate(@Body() body: any) {
    return this.offline.validate(body || {});
  }

  /** Alias used by desktop clients on reconnect. */
  @Post('sync')
  sync(@Body() body: any) {
    return this.offline.validate({ ...(body || {}), refresh: true });
  }

  /** Admin-only: rebind a license to a replacement device. */
  @Post('transfer/:licenseId')
  @UseGuards(JwtAuthGuard)
  transfer(@Req() req: any, @Param('licenseId') licenseId: string, @Body() body: any) {
    assertRole(req, 'ADMIN');
    return this.offline.transferDevice(licenseId, String(body?.fingerprint || ''));
  }
}
