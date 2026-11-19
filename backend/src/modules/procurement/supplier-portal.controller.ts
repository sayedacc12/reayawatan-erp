import { Body, Controller, Delete, Get, HttpCode, Ip, Param, ParseUUIDPipe, Patch, Post, Put, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { memoryStorage } from 'multer';
import { AllowWithTempPassword, Public } from '../../core/auth/decorators';
import { MAX_UPLOAD_BYTES } from '../../core/files/file-store.service';
import { sendFile } from './procurement.controller';
import {
  BankDto, DocMetaDto, PortalChangePasswordDto, PortalForgotDto, PortalLoginDto, PortalRegisterDto, PortalResetDto, PortalUserDto, PortalUserUpdateDto, SupplierDto,
} from './procurement.dto';
import { CurrentSupplier, SupplierPortalGuard, SupplierPortalUser } from './supplier-portal.guard';
import { SupplierPortalService } from './supplier-portal.service';

const uuid = new ParseUUIDPipe();
const upload = FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

/**
 * بوابة الموردين ومزودي الخدمات:
 * /supplier-portal/o/:slug/...  عام لكل جمعية (المعلومات، التسجيل، الدخول، الاستعادة)
 * /supplier-portal/...          بعد دخول مستخدم المورد
 */
@Public()
@Controller('supplier-portal')
export class SupplierPortalController {
  constructor(private readonly portal: SupplierPortalService) {}

  @Get('o/:slug')
  info(@Param('slug') slug: string) { return this.portal.info(slug); }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('o/:slug/register')
  register(@Param('slug') slug: string, @Body() dto: PortalRegisterDto, @Ip() ip: string) { return this.portal.register(slug, dto, ip ?? null); }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('o/:slug/login') @HttpCode(200)
  login(@Param('slug') slug: string, @Body() dto: PortalLoginDto, @Ip() ip: string) { return this.portal.login(slug, dto, ip ?? null); }

  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @Post('o/:slug/forgot') @HttpCode(200)
  forgot(@Param('slug') slug: string, @Body() dto: PortalForgotDto, @Ip() ip: string) { return this.portal.forgot(slug, dto, ip ?? null); }

  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  @Post('o/:slug/reset') @HttpCode(200)
  reset(@Param('slug') slug: string, @Body() dto: PortalResetDto, @Ip() ip: string) { return this.portal.reset(slug, dto, ip ?? null); }

  @UseGuards(SupplierPortalGuard) @AllowWithTempPassword()
  @Post('change-password') @HttpCode(200)
  changePassword(@CurrentSupplier() p: SupplierPortalUser, @Body() dto: PortalChangePasswordDto) { return this.portal.changePassword(p, dto); }

  @UseGuards(SupplierPortalGuard) @AllowWithTempPassword()
  @Get('me')
  me(@CurrentSupplier() p: SupplierPortalUser) { return this.portal.me(p); }

  @UseGuards(SupplierPortalGuard)
  @Put('me')
  update(@CurrentSupplier() p: SupplierPortalUser, @Body() dto: SupplierDto) { return this.portal.updateProfile(p, dto); }

  @UseGuards(SupplierPortalGuard)
  @Post('submit') @HttpCode(200)
  submit(@CurrentSupplier() p: SupplierPortalUser) { return this.portal.submit(p); }

  @UseGuards(SupplierPortalGuard)
  @Post('docs') @HttpCode(200) @UseInterceptors(upload)
  addDoc(@CurrentSupplier() p: SupplierPortalUser, @Body() dto: DocMetaDto, @UploadedFile() file: Express.Multer.File) { return this.portal.addDoc(p, dto, file); }

  @UseGuards(SupplierPortalGuard)
  @Delete('docs/:id')
  removeDoc(@CurrentSupplier() p: SupplierPortalUser, @Param('id', uuid) id: string) { return this.portal.removeDoc(p, id); }

  @UseGuards(SupplierPortalGuard)
  @Get('docs/:id/file')
  async docFile(@CurrentSupplier() p: SupplierPortalUser, @Param('id', uuid) id: string, @Res({ passthrough: true }) res: Response) {
    return sendFile(res, await this.portal.docFile(p, id));
  }

  @UseGuards(SupplierPortalGuard)
  @Post('banks') @HttpCode(200) @UseInterceptors(upload)
  addBank(@CurrentSupplier() p: SupplierPortalUser, @Body() dto: BankDto, @UploadedFile() file: Express.Multer.File) { return this.portal.addBank(p, dto, file); }

  @UseGuards(SupplierPortalGuard)
  @Post('users') @HttpCode(200)
  addUser(@CurrentSupplier() p: SupplierPortalUser, @Body() dto: PortalUserDto) { return this.portal.addUser(p, dto); }

  @UseGuards(SupplierPortalGuard)
  @Patch('users/:id')
  updateUser(@CurrentSupplier() p: SupplierPortalUser, @Param('id', uuid) id: string, @Body() dto: PortalUserUpdateDto) { return this.portal.updateUser(p, id, dto); }
}
