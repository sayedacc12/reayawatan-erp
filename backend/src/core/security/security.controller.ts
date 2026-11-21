import { Body, Controller, Get, HttpCode, Ip, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { AuthUser, CurrentUser, RequirePermissions } from '../auth/decorators';
import { PLATFORM_PERMISSIONS } from '../core.manifest';
import { SecurityService } from './security.service';

class ThresholdsDto {
  @IsInt() @Min(3) @Max(1000) bruteForce!: number;
  @IsInt() @Min(10) @Max(5000) scan!: number;
  @IsInt() @Min(5) @Max(1000) probe!: number;
  @IsInt() @Min(3) @Max(1000) exports!: number;
  @IsInt() @Min(3) @Max(5000) errors!: number;
}

export class SecuritySettingsDto {
  @IsBoolean() enabled!: boolean;
  @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(254, { each: true }) recipients!: string[];
  @IsBoolean() autoActions!: boolean;
  @IsBoolean() dailyReport!: boolean;
  @IsInt() @Min(0) @Max(23) dailyHour!: number;
  @IsInt() @Min(5) @Max(7 * 24 * 60) blockMinutes!: number;
  @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(64, { each: true }) trustedIps!: string[];
  @ValidateNested() @Type(() => ThresholdsDto) thresholds!: ThresholdsDto;
}

class BlockDto {
  @IsString() @MaxLength(64) ip!: string;
  @IsInt() @Min(5) @Max(30 * 24 * 60) minutes!: number;
  @IsString() @MinLength(3) @MaxLength(300) reason!: string;
}

class ResolveDto {
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

class ListQuery {
  @IsOptional() @IsIn(['active', 'open', 'acknowledged', 'resolved']) status?: string;
  @IsOptional() @IsIn(['1', 'true', '0', 'false']) active?: string;
  @IsOptional() @IsString() @MaxLength(40) type?: string;
  @IsOptional() @IsString() @MaxLength(64) ip?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10_000) page?: number;
}

/** شاشة المراقب الأمني «سيد» لمدير المنصة: الحوادث، والحظر المؤقت، وسجل الأحداث، والإعدادات، والتقرير اليومي */
@Controller('platform/security')
@RequirePermissions(PLATFORM_PERMISSIONS.securityManage)
export class SecurityController {
  constructor(private readonly security: SecurityService) {}

  @Get()
  overview() {
    return this.security.overview();
  }

  @Get('incidents')
  incidents(@Query() q: ListQuery) {
    return this.security.incidents(q);
  }

  @Post('incidents/:id/ack') @HttpCode(200)
  ack(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.security.acknowledge(id, user);
  }

  @Post('incidents/:id/resolve') @HttpCode(200)
  resolve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveDto, @CurrentUser() user: AuthUser) {
    return this.security.resolve(id, user, dto.note);
  }

  @Post('incidents/:id/approve-suspend') @HttpCode(200)
  approveSuspend(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.security.approveSuspend(id, user);
  }

  @Post('incidents/:id/dismiss-suspend') @HttpCode(200)
  dismissSuspend(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.security.dismissSuspend(id, user);
  }

  @Post('incidents/:id/reactivate') @HttpCode(200)
  reactivate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.security.reactivate(id, user);
  }

  @Get('blocks')
  blocks(@Query() q: ListQuery) {
    return this.security.blocks(q);
  }

  @Post('blocks')
  addBlock(@Body() dto: BlockDto, @CurrentUser() user: AuthUser, @Ip() ip: string) {
    return this.security.addBlock(dto, user, ip ?? null);
  }

  @Post('blocks/:id/lift') @HttpCode(200)
  lift(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.security.liftBlock(id, user);
  }

  @Get('events')
  events(@Query() q: ListQuery) {
    return this.security.events(q);
  }

  @Put('settings')
  settings(@Body() dto: SecuritySettingsDto) {
    return this.security.updateSettings(dto);
  }

  @Get('reports')
  reports() {
    return this.security.reportsList();
  }

  @Post('reports/send') @HttpCode(200)
  sendReport() {
    return this.security.sendReport();
  }
}
