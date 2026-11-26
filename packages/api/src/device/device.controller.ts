import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { DeviceService } from './device.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

/** ISO-8601 date strings are accepted directly by Prisma DateTime fields. */
export interface CreateDeviceDto {
  fingerprint: string;
  os?: string | null;
  browser?: string | null;
  lastValidation?: string;
  status?: string;
  activatedAt?: string | null;
  activatedAtIp?: string | null;
  userAgent?: string | null;
  licenseId?: string | null;
  userId?: string | null;
  notes?: string | null;
}

export type UpdateDeviceDto = Partial<CreateDeviceDto>;

@UseGuards(JwtAuthGuard)
@Controller('api/v1/devices')
export class DeviceController {
  constructor(private readonly deviceService: DeviceService) {}

  @Get()
  async findAll(@Query('status') status?: string) {
    return this.deviceService.findAll(status);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.deviceService.findOne(id);
  }

  @Post()
  async create(@Body() dto: CreateDeviceDto) {
    return this.deviceService.create(dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateDeviceDto) {
    return this.deviceService.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.deviceService.remove(id);
  }
}
