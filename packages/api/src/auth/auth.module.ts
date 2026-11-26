import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PasswordService } from './password.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { NeonModule } from '../neon/neon.module';

@Module({
  imports: [
    PrismaModule,
    NeonModule,
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'license-management-secret-key',
      signOptions: { expiresIn: '15m' },
    }),
  ],
  providers: [AuthService, PasswordService, JwtAuthGuard],
  controllers: [AuthController],
  exports: [AuthService, PasswordService, JwtAuthGuard],
})
export class AuthModule {}
