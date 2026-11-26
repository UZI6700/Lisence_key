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
import { ProductService } from './product.service';

export interface CreateProductDto {
  name: string;
  code: string;
  description?: string | null;
  version?: string;
  defaultDeviceLimit?: number;
  isActive?: boolean;
}

export type UpdateProductDto = Partial<CreateProductDto>;

function parseOptionalBoolean(value?: string): boolean | undefined {
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return undefined;
}

@Controller('api/v1/products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  // Declared before ':id' so /api/v1/products/plans is not captured as an id.
  @Get('plans')
  async listPlans() {
    return this.productService.findPlans();
  }

  @Get()
  async findAll(@Query('active') active?: string) {
    return this.productService.findAll(parseOptionalBoolean(active));
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.productService.findOne(id);
  }

  @Post()
  async create(@Body() dto: CreateProductDto) {
    return this.productService.create(dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productService.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.productService.remove(id);
  }
}
