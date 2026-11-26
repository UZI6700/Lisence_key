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
import { CustomerService } from './customer.service';

export interface CreateCustomerDto {
  name: string;
  email: string;
  company?: string | null;
  phone?: string | null;
  taxId?: string | null;
  contactPerson?: string | null;
  address?: string | null;
  website?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

export type UpdateCustomerDto = Partial<CreateCustomerDto>;

function parseOptionalBoolean(value?: string): boolean | undefined {
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return undefined;
}

@Controller('api/v1/customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Get()
  async findAll(@Query('active') active?: string) {
    return this.customerService.findAll(parseOptionalBoolean(active));
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.customerService.findOne(id);
  }

  @Post()
  async create(@Body() dto: CreateCustomerDto) {
    return this.customerService.create(dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.customerService.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.customerService.remove(id);
  }
}
