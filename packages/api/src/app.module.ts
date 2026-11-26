import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { NeonModule } from './neon/neon.module';
import { CryptoModule } from './crypto/crypto.module';
import { AuthModule } from './auth/auth.module';
import { ProductModule } from './product/product.module';
import { CustomerModule } from './customer/customer.module';
import { LicenseModule } from './license/license.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { DeviceModule } from './device/device.module';
import { ApiKeyModule } from './api-key/api-key.module';
import { StatsModule } from './stats/stats.module';
import { ActivityModule } from './activity/activity.module';
import { SettingsModule } from './settings/settings.module';
import { OfflineModule } from './offline/offline.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
    }),
    PrismaModule,
    NeonModule,
    CryptoModule,
    AuthModule,
    ProductModule,
    CustomerModule,
    LicenseModule,
    SubscriptionModule,
    DeviceModule,
    ApiKeyModule,
    StatsModule,
    ActivityModule,
    SettingsModule,
    OfflineModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
