import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { LicenseService } from './license.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/v1/licenses')
export class LicenseController {
  constructor(private licenseService: LicenseService) {}

  @UseGuards(JwtAuthGuard)
  @Get('stats')
  stats() {
    return this.licenseService.stats();
  }

  @Get('key/:key')
  findByKey(@Param('key') key: string) {
    return this.licenseService.findByKey(key);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  list(@Query() query: any) {
    return this.licenseService.list(query);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.licenseService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
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

  @UseGuards(JwtAuthGuard)
  @Post(':id/deactivate')
  deactivate(@Param('id') id: string, @Body() body: any) {
    return this.licenseService.deactivate(id, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/revoke')
  revoke(@Param('id') id: string) {
    return this.licenseService.revoke(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/renew')
  renew(@Param('id') id: string, @Body('days') days: number) {
    return this.licenseService.renew(id, Number(days) || 365);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.licenseService.update(id, body);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.licenseService.remove(id);
  }
}
