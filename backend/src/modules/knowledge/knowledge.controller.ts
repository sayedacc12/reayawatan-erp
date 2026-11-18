import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentOrgUser, OrgUser, RequireAnyPermission, RequirePermissions } from '../../core/auth/decorators';
import { MAX_UPLOAD_BYTES } from '../../core/files/file-store.service';
import { CategoriesDto, DocumentDto, StatusDto, VersionDto } from './knowledge.dto';
import { KNOWLEDGE_PERMISSIONS as P } from './knowledge.manifest';
import { KnowledgeService } from './knowledge.service';

const upload = () => UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }));
export function sendFile(res: Response, f: { stream: NodeJS.ReadableStream; mime: string; name: string }, download = false) {
  res.setHeader('Cache-Control', 'private, no-store');
  return new StreamableFile(f.stream as never, { type: f.mime, disposition: `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.name)}` });
}

@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly kn: KnowledgeService) {}

  @Get('lookups')
  @RequirePermissions(P.read)
  lookups(@CurrentOrgUser() u: OrgUser) {
    return this.kn.lookups(u.organizationId);
  }

  @Get('overview')
  @RequirePermissions(P.read)
  overview(@CurrentOrgUser() u: OrgUser) {
    return this.kn.overview(u);
  }

  @Get('pick')
  pick(@CurrentOrgUser() u: OrgUser) {
    return this.kn.pickList(u);
  }

  @Get('documents')
  @RequirePermissions(P.read)
  list(@CurrentOrgUser() u: OrgUser, @Query() q: Record<string, string>) {
    return this.kn.list(u, q);
  }

  @Post('documents')
  @RequirePermissions(P.manage)
  create(@CurrentOrgUser() u: OrgUser, @Body() dto: DocumentDto) {
    return this.kn.create(u, dto);
  }

  @Get('documents/:id')
  @RequirePermissions(P.read)
  get(@CurrentOrgUser() u: OrgUser, @Param('id') id: string) {
    return this.kn.get(u, id);
  }

  @Put('documents/:id')
  @RequirePermissions(P.manage)
  update(@CurrentOrgUser() u: OrgUser, @Param('id') id: string, @Body() dto: DocumentDto) {
    return this.kn.update(u, id, dto);
  }

  @Delete('documents/:id')
  @RequirePermissions(P.manage)
  remove(@CurrentOrgUser() u: OrgUser, @Param('id') id: string) {
    return this.kn.remove(u, id);
  }

  @Post('documents/:id/file')
  @RequirePermissions(P.manage)
  @upload()
  attach(@CurrentOrgUser() u: OrgUser, @Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    return this.kn.attach(u, id, file);
  }

  @Post('documents/:id/version')
  @RequirePermissions(P.manage)
  @upload()
  version(@CurrentOrgUser() u: OrgUser, @Param('id') id: string, @Body() dto: VersionDto, @UploadedFile() file?: Express.Multer.File) {
    return this.kn.newVersion(u, id, dto, file);
  }

  @Post('documents/:id/status')
  @RequirePermissions(P.publish)
  status(@CurrentOrgUser() u: OrgUser, @Param('id') id: string, @Body() dto: StatusDto) {
    return this.kn.setStatus(u, id, dto);
  }

  @Get('documents/:id/file')
  @RequirePermissions(P.read)
  async file(@CurrentOrgUser() u: OrgUser, @Param('id') id: string, @Res({ passthrough: true }) res: Response, @Query('v') v?: string) {
    let idx: number | undefined;
    if (v !== undefined) {
      idx = Number(v);
      if (!Number.isInteger(idx) || idx < 0) throw new BadRequestException('الإصدار غير صحيح');
    }
    return sendFile(res, await this.kn.file(u, id, idx));
  }

  @Get('categories')
  @RequireAnyPermission(P.read, P.settings)
  categories(@CurrentOrgUser() u: OrgUser) {
    return this.kn.categories(u.organizationId);
  }

  @Put('categories')
  @RequirePermissions(P.settings)
  saveCategories(@CurrentOrgUser() u: OrgUser, @Body() dto: CategoriesDto) {
    return this.kn.saveCategories(u, dto);
  }
}
