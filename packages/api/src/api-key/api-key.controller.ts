import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyService } from './api-key.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

export interface CreateApiKeyDto {
  name: string;
  scopes?: string;
  isActive?: boolean;
  expiresAt?: string | null;
  createdById?: string | null;
}

export type UpdateApiKeyDto = Partial<CreateApiKeyDto> & {
  lastUsed?: string | null;
  usageCount?: number;
};

@UseGuards(JwtAuthGuard)
@Controller('api/v1/api-keys')
export class ApiKeyController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  @Get()
  async findAll() {
    return this.apiKeyService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.apiKeyService.findOne(id);
  }

  @Post()
  async create(@Body() dto: CreateApiKeyDto) {
    return this.apiKeyService.create(dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateApiKeyDto) {
    return this.apiKeyService.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.apiKeyService.remove(id);
  }
}
