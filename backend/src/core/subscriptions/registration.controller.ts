import { Body, Controller, Get, HttpCode, Param, Post, Put, Req, UploadedFile } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../auth/decorators';
import { ApplicationsService } from './applications.service';
import { ContractsService } from './contracts.service';
import { licenseUpload } from './subscriptions.controller';
import { ApplicationDto, NoteDto, SignContractDto, UpdateApplicationDto } from './subscriptions.dto';

/**
 * صفحات الشركة العامة (بدون تسجيل دخول):
 * تقديم طلب الاشتراك، ومتابعته برابط سري، ومراجعة العقد الإلكتروني وتوقيعه.
 */
@Controller('public')
@Public()
export class RegistrationController {
  constructor(private readonly apps: ApplicationsService, private readonly contracts: ContractsService) {}

  @Post('registrations')
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @licenseUpload()
  submit(@Body() dto: ApplicationDto, @UploadedFile() file: Express.Multer.File) {
    return this.apps.submit(dto, file);
  }

  @Get('registrations/:token')
  track(@Param('token') token: string) {
    return this.apps.track(token);
  }

  @Put('registrations/:token')
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @licenseUpload()
  resubmit(@Param('token') token: string, @Body() dto: UpdateApplicationDto, @UploadedFile() file?: Express.Multer.File) {
    return this.apps.resubmit(token, dto, file);
  }

  @Get('contracts/:token')
  contract(@Param('token') token: string) {
    return this.contracts.publicView(token);
  }

  @Post('contracts/:token/sign')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  sign(@Param('token') token: string, @Body() dto: SignContractDto, @Req() req: Request) {
    return this.contracts.sign(token, dto, req.ip ?? '');
  }

  @Post('contracts/:token/request-changes')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  requestChanges(@Param('token') token: string, @Body() dto: NoteDto) {
    return this.contracts.requestChanges(token, dto.note);
  }
}
