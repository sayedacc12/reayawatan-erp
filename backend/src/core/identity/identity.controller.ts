import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CORE_PERMISSIONS } from '../core.manifest';
import { CurrentOrgUser, OrgUser, Public, RequirePermissions } from '../auth/decorators';
import { IdentityDto } from './identity.dto';
import { IdentityService, LogoKind } from './identity.service';

const KINDS: LogoKind[] = ['logo', 'logoLight'];
const kindOf = (k: string) => {
  if (!KINDS.includes(k as LogoKind)) throw new BadRequestException('نوع الشعار غير معروف');
  return k as LogoKind;
};

/** هوية الجمعية داخل النظام: يقرؤها كل موظف (لتطبيق الألوان والشعار)، ويعدّلها من يملك صلاحية الهوية */
@Controller('identity')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Get()
  get(@CurrentOrgUser() u: OrgUser) {
    return this.identity.view(u.organizationId);
  }

  @Put()
  @RequirePermissions(CORE_PERMISSIONS.identityManage)
  save(@CurrentOrgUser() u: OrgUser, @Body() dto: IdentityDto) {
    return this.identity.save(u, dto);
  }

  @Post(':kind')
  @RequirePermissions(CORE_PERMISSIONS.identityManage)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } }))
  upload(@CurrentOrgUser() u: OrgUser, @Param('kind') kind: string, @UploadedFile() file: Express.Multer.File) {
    return this.identity.uploadLogo(u, kindOf(kind), file);
  }

  @Delete(':kind')
  @RequirePermissions(CORE_PERMISSIONS.identityManage)
  remove(@CurrentOrgUser() u: OrgUser, @Param('kind') kind: string) {
    return this.identity.removeLogo(u, kindOf(kind));
  }
}

/** الهوية والشعار للصفحات العامة (الموقع الإلكتروني وصفحة دخول الموظفين) */
@Controller('public/identity')
export class PublicIdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Public()
  @Get(':slug')
  get(@Param('slug') slug: string) {
    return this.identity.publicView(slug);
  }

  @Public()
  @Get(':slug/:kind')
  async logo(@Param('slug') slug: string, @Param('kind') kind: string, @Res({ passthrough: true }) res: Response) {
    const f = await this.identity.logoFile(slug, kindOf(kind));
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return new StreamableFile(f.stream as never, { type: f.mime });
  }
}
