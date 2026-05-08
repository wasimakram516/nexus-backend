import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CurrentUserContextInterceptor } from './common/interceptors/current-user-context.interceptor';
import { envSchema } from './config/env.schema';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { AppLoggerService } from './common/services/app-logger.service';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CampusesModule } from './modules/campuses/campuses.module';
import { AcademicsModule } from './modules/academics/academics.module';
import { PeopleModule } from './modules/people/people.module';
import { PlatformModule } from './modules/platform/platform.module';
import { CustomFieldsModule } from './modules/custom-fields/custom-fields.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { FinanceModule } from './modules/finance/finance.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { RecycleBinModule } from './modules/recycle-bin/recycle-bin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config) => envSchema.parse(config),
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 60,
      },
    ]),
    PrismaModule,
    HealthModule,
    PlatformModule,
    AuthModule,
    UsersModule,
    CampusesModule,
    AcademicsModule,
    PeopleModule,
    AttendanceModule,
    FinanceModule,
    CustomFieldsModule,
    RealtimeModule,
    AuditLogsModule,
    RecycleBinModule,
  ],
  providers: [
    AppLoggerService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: CurrentUserContextInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
