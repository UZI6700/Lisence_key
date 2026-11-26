import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { LicenseService } from './license.service';

@Controller('api/v1/licenses')
export class LicenseController {
  constructor(private licenseService: LicenseService) {}

  @Get('stats')
  stats() {
    return this.licenseService.stats();
  }

  @Get('key/:key')
  findByKey(@Param('key') key: string) {
    return this.licenseService.findByKey(key);
  }

  @Get()
  list(@Query() query: any) {
    return this.licenseService.list(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.licenseService.findOne(id);
  }

  @Post('issue')
  issue(@Body() body: any) {
    return this.licenseService.issue(body);
  }

  @Post('activate')
  activate(@Body() body: any) {
    return this.licenseService.activate(body);
  }

  @Post('validate')
  validate(@Body() body: any) {
    return this.licenseService.validate(body);
  }

  @Post(':id/deactivate')
  deactivate(@Param('id') id: string, @Body() body: any) {
    return this.licenseService.deactivate(id, body);
  }

  @Post(':id/revoke')
  revoke(@Param('id') id: string) {
    return this.licenseService.revoke(id);
  }

  @Post(':id/renew')
  renew(@Param('id') id: string, @Body('days') days: number) {
    return this.licenseService.renew(id, Number(days) || 365);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.licenseService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.licenseService.remove(id);
  }
}
