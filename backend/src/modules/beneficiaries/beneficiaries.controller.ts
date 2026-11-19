import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, StreamableFile,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentOrgUser, OrgUser, RequirePermissions } from '../../core/auth/decorators';
import {
  AidDto, AidLogQuery, CreateBeneficiaryDto, FamilyMemberDto, ListBeneficiariesQuery, ResearchDto,
  UpdateBeneficiaryDto, UpdateFamilyMemberDto, UploadDocumentDto,
} from './beneficiaries.dto';
import { BENEFICIARY_PERMISSIONS as P } from './beneficiaries.manifest';
import { BeneficiariesService } from './beneficiaries.service';
import { MAX_DOCUMENT_BYTES } from './constants';
import { PortalAccessDto } from './portal.dto';

const uuid = new ParseUUIDPipe();

@Controller('beneficiaries')
export class BeneficiariesController {
  constructor(private readonly service: BeneficiariesService) {}

  // المسارات الثابتة قبل :id
  @Get('stats')
  @RequirePermissions(P.read)
  stats(@CurrentOrgUser() actor: OrgUser) {
    return this.service.stats(actor);
  }

  @Get('aid-log')
  @RequirePermissions(P.read)
  aidLog(@CurrentOrgUser() actor: OrgUser, @Query() q: AidLogQuery) {
    return this.service.aidLog(actor, q);
  }

  @Get()
  @RequirePermissions(P.read)
  list(@CurrentOrgUser() actor: OrgUser, @Query() q: ListBeneficiariesQuery) {
    return this.service.list(actor, q);
  }

  @Post()
  @RequirePermissions(P.manage)
  create(@CurrentOrgUser() actor: OrgUser, @Body() dto: CreateBeneficiaryDto) {
    return this.service.create(actor, dto);
  }

  @Get(':id')
  @RequirePermissions(P.read)
  get(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.service.get(actor, id);
  }

  @Patch(':id')
  @RequirePermissions(P.manage)
  update(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: UpdateBeneficiaryDto) {
    return this.service.update(actor, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(P.delete)
  remove(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.service.remove(actor, id);
  }

  @Post(':id/portal-access')
  @HttpCode(204)
  @RequirePermissions(P.manage)
  portalAccess(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: PortalAccessDto) {
    return this.service.setPortalAccess(actor, id, dto.password);
  }

  /** كلمة مرور مؤقتة للبوابة تظهر مرة واحدة لترسل لجوال المستفيد المسجل */
  @Post(':id/portal-temp-password')
  @RequirePermissions(P.manage)
  portalTempPassword(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.service.portalTempPassword(actor, id);
  }

  @Delete(':id/portal-access')
  @HttpCode(204)
  @RequirePermissions(P.manage)
  revokePortal(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.service.setPortalAccess(actor, id, null);
  }

  // ---- الأسرة ----
  @Post(':id/family')
  @RequirePermissions(P.manage)
  addFamily(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: FamilyMemberDto) {
    return this.service.addFamilyMember(actor, id, dto);
  }

  @Patch(':id/family/:memberId')
  @RequirePermissions(P.manage)
  updateFamily(
    @CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Param('memberId', uuid) memberId: string,
    @Body() dto: UpdateFamilyMemberDto,
  ) {
    return this.service.updateFamilyMember(actor, id, memberId, dto);
  }

  @Delete(':id/family/:memberId')
  @HttpCode(204)
  @RequirePermissions(P.manage)
  removeFamily(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Param('memberId', uuid) memberId: string) {
    return this.service.removeFamilyMember(actor, id, memberId);
  }

  // ---- البحث الاجتماعي ----
  @Post(':id/researches')
  @RequirePermissions(P.research)
  addResearch(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: ResearchDto) {
    return this.service.addResearch(actor, id, dto);
  }

  @Delete(':id/researches/:researchId')
  @HttpCode(204)
  @RequirePermissions(P.research)
  removeResearch(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Param('researchId', uuid) rid: string) {
    return this.service.removeResearch(actor, id, rid);
  }

  // ---- المساعدات ----
  @Post(':id/aids')
  @RequirePermissions(P.aid)
  addAid(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: AidDto) {
    return this.service.addAid(actor, id, dto);
  }

  @Delete(':id/aids/:aidId')
  @HttpCode(204)
  @RequirePermissions(P.aid)
  removeAid(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Param('aidId', uuid) aidId: string) {
    return this.service.removeAid(actor, id, aidId);
  }

  // ---- المستندات ----
  @Post(':id/documents')
  @RequirePermissions(P.documents)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 } }))
  upload(
    @CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: UploadDocumentDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.uploadDocument(actor, id, dto, file);
  }

  @Get(':id/documents/:docId/file')
  @RequirePermissions(P.read)
  async download(
    @CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Param('docId', uuid) docId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { doc, stream } = await this.service.openDocument(actor, id, docId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(stream, {
      type: doc.mimeType,
      length: doc.size,
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(doc.originalName)}`,
    });
  }

  @Delete(':id/documents/:docId')
  @HttpCode(204)
  @RequirePermissions(P.documents)
  removeDocument(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Param('docId', uuid) docId: string) {
    return this.service.removeDocument(actor, id, docId);
  }
}
