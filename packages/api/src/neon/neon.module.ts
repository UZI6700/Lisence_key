import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NeonController } from './neon.controller';
import { NeonService } from './neon.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [NeonService],
  controllers: [NeonController],
  exports: [NeonService],
})
export class NeonModule {}
