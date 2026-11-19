import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser, RequirePermissions } from '../auth/decorators';
import { PLATFORM_PERMISSIONS } from '../core.manifest';
import { PerformanceService } from './performance.service';

export class SnapshotDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;
}

/** شاشة «الأداء وحجم البيانات» لمدير المنصة */
@Controller('platform/performance')
@RequirePermissions(PLATFORM_PERMISSIONS.reportsRead)
export class PerformanceController {
  constructor(private readonly perf: PerformanceService) {}

  @Get()
  overview() {
    return this.perf.overview();
  }

  @Get('snapshots/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.perf.get(id);
  }

  /** أخذ قياس الآن (يُحفظ في التاريخ ويُقارن بخط الأساس) */
  @Post('snapshots')
  take(@Body() dto: SnapshotDto, @CurrentUser() user: AuthUser) {
    return this.perf.take('manual', dto.label?.trim() || null, user);
  }

  /** اعتماد قياس خطَّ أساس جديدًا بدل السابق */
  @Post('snapshots/:id/baseline')
  @RequirePermissions(PLATFORM_PERMISSIONS.reportsRead, PLATFORM_PERMISSIONS.organizationsManage)
  baseline(@Param('id', ParseUUIDPipe) id: string) {
    return this.perf.setBaseline(id);
  }
}
