import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PerfCollector } from './perf-collector.service';
import { PerformanceController } from './performance.controller';
import { PerfEndpointStat, PerfSnapshot } from './performance.entity';
import { PerformanceService } from './performance.service';
import { RequestTimingInterceptor } from './request-timing.interceptor';

/**
 * مراقبة الأداء وحجم البيانات: يقيس زمن كل طلب، ويأخذ قياسًا يوميًا لحجم البيانات لكل جمعية ونظام،
 * ويحفظ أول قياس خطَّ أساس رسميًا للمقارنة.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PerfSnapshot, PerfEndpointStat])],
  controllers: [PerformanceController],
  providers: [PerfCollector, PerformanceService, { provide: APP_INTERCEPTOR, useClass: RequestTimingInterceptor }],
})
export class PerformanceModule {}
