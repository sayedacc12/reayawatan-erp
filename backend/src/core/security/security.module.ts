import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { jwtOptionsFor } from '../auth/token-keys';
import { BackupsModule } from '../backups/backups.module';
import { CoreModule } from '../core.module';
import { SECURITY_ENTITIES } from './security.entity';
import { SecurityController } from './security.controller';
import { SecurityDetector } from './security-detector.service';
import { SecurityBlockMiddleware, SecurityExceptionFilter, SecurityInterceptor } from './security-http';
import { SecurityMonitor } from './security-monitor.service';
import { SecurityReports } from './security-report.service';
import { SecurityService } from './security.service';

/**
 * المراقب الأمني «سيد»: يسجل الأحداث الأمنية، ويرصد السلوك الشاذ، وينبه فورًا بالبريد،
 * ويتخذ إجراءات موضعية على المصدر المهاجم وحده (حظر عنوان مؤقتًا، إنهاء جلسات حساب)،
 * ويرسل تقريرًا يوميًا. لا يوقف أي نظام، وإيقاف حساب موظف يحتاج موافقة الإدارة.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature(SECURITY_ENTITIES), CoreModule, BackupsModule,
    // للتحقق من رمز دخول الموظف فقط (لا يُصدر رموزًا)
    JwtModule.registerAsync({ inject: [ConfigService], useFactory: jwtOptionsFor('staff') }),
  ],
  controllers: [SecurityController],
  providers: [
    SecurityMonitor, SecurityDetector, SecurityReports, SecurityService,
    { provide: APP_FILTER, useClass: SecurityExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: SecurityInterceptor },
  ],
  exports: [SecurityMonitor, SecurityDetector, SecurityReports],
})
export class SecurityModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SecurityBlockMiddleware).forRoutes('*');
  }
}
