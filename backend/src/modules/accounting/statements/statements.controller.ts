import { Body, Controller, Delete, Get, HttpCode, Logger, Param, ParseUUIDPipe, Post, Put, Query, Res, ServiceUnavailableException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { DataSource } from 'typeorm';
import { CurrentOrgUser, OrgUser, RequireAnyPermission, RequirePermissions } from '../../../core/auth/decorators';
import { FileStore } from '../../../core/files/file-store.service';
import { renderBoardDoc } from '../../../core/reports/board-doc';
import { boardBody, docBrand } from '../../../core/reports/doc-brand';
import { ReportPdfService } from '../../../core/reports/report-pdf.service';
import { ACC_PERMISSIONS as P } from '../accounting.manifest';
import { FsPeriod } from './fs-period';
import { AppropriationDto, FsDocumentQueryDto, FsMappingDto, FsPeriodQueryDto, FsYearQueryDto } from './statements.dto';
import { buildStatementsDoc } from './statements.doc';
import { StatementsService } from './statements.service';

/**
 * إعداد الميزانية والقوائم المالية للمراجع:
 *   GET  /api/accounting/statements/options            السنوات والفترات وبنود القوائم
 *   GET  /api/accounting/statements?yearId&span&part   القوائم للشاشة (معاينة مسموحة دائمًا)
 *   GET  /api/accounting/statements/document?...       الملف الموحد HTML للمعاينة والطباعة، بعلامة «مسودة» ما لم تُغلق الفترة
 *   POST /api/accounting/statements/issue              الإصدار النهائي PDF، بعد إغلاق الفترة وترحيل قيودها فقط، ويُسجَّل برقم وبصمة
 *   GET  /api/accounting/statements/issues             سجل الإصدارات
 *   GET/PUT /api/accounting/statements/mapping[/:id]   الدليل المحاسبي وفق بنود القوائم
 *   GET/PUT/DELETE /api/accounting/statements/appropriation  مشروع توزيع الأرباح للسنة
 */
@Controller('accounting/statements')
export class StatementsController {
  private readonly log = new Logger('Statements');
  constructor(private readonly st: StatementsService, private readonly pdf: ReportPdfService, private readonly db: DataSource, private readonly files: FileStore) {}

  @Get('options') @RequireAnyPermission(P.reports, P.statements)
  async options(@CurrentOrgUser() a: OrgUser) { return { ...(await this.st.options(a)), pdf: this.pdf.available }; }

  @Get('mapping') @RequireAnyPermission(P.reports, P.statements)
  mapping(@CurrentOrgUser() a: OrgUser) { return this.st.mapping(a); }

  @Put('mapping/:accountId') @RequirePermissions(P.statements)
  setMapping(@CurrentOrgUser() a: OrgUser, @Param('accountId', ParseUUIDPipe) id: string, @Body() dto: FsMappingDto) { return this.st.setMapping(a, id, dto.lineCode); }

  @Get('appropriation') @RequireAnyPermission(P.reports, P.statements)
  appropriation(@CurrentOrgUser() a: OrgUser, @Query() q: FsYearQueryDto) { return this.st.appropriation(a, q.yearId); }

  @Put('appropriation') @RequirePermissions(P.statements)
  saveAppropriation(@CurrentOrgUser() a: OrgUser, @Body() dto: AppropriationDto) { return this.st.saveAppropriation(a, dto.yearId, dto); }

  @Delete('appropriation/:yearId') @RequirePermissions(P.statements)
  deleteAppropriation(@CurrentOrgUser() a: OrgUser, @Param('yearId', ParseUUIDPipe) yearId: string) { return this.st.deleteAppropriation(a, yearId); }

  @Get('issues') @RequireAnyPermission(P.reports, P.statements)
  issues(@CurrentOrgUser() a: OrgUser) { return this.st.issues(a); }

  @Get('document') @RequireAnyPermission(P.reports, P.statements)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async document(@CurrentOrgUser() a: OrgUser, @Query() q: FsDocumentQueryDto, @Res() res: Response) {
    const p = await this.st.period(a.organizationId, q.yearId, q.span, q.part);
    const closure = await this.st.closure(a.organizationId, p);
    const html = renderBoardDoc(await this.doc(a, p, null, closure.closed), { print: true });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="financial-statements.html"');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:");
    res.send(html);
  }

  @Post('issue') @RequirePermissions(P.statements) @HttpCode(200)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  async issue(@CurrentOrgUser() a: OrgUser, @Body() q: FsPeriodQueryDto, @Res() res: Response) {
    const p = await this.st.period(a.organizationId, q.yearId, q.span, q.part);
    await this.st.assertClosed(a.organizationId, p);
    if (!this.pdf.available) throw new ServiceUnavailableException('تصدير PDF غير متاح على الخادم حاليًا');
    // الاحتساب والتوليد داخل معاملة الإصدار بعد تثبيت إغلاق الشهور، فلا يُفتح شهر أثناءه
    const { row, pdf } = await this.st.issue(a, p, async (no) => {
      const st = await this.st.compute(a.organizationId, p);
      const doc = await this.doc(a, p, no, true, st);
      return { pdf: await this.pdf.render(renderBoardDoc(doc), { landscape: false, footerLeft: `${doc.docNo} · ${doc.organizationName}` }), totals: st.totals };
    });
    const name = `القوائم المالية - ${p.label} - إصدار ${row.issueNo}.pdf`.replace(/[\\/:*?"<>|]+/g, ' ');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('X-Issue-No', String(row.issueNo));
    res.setHeader('Content-Disposition', `attachment; filename="financial-statements.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.send(pdf);
  }

  @Get() @RequireAnyPermission(P.reports, P.statements)
  preview(@CurrentOrgUser() a: OrgUser, @Query() q: FsPeriodQueryDto) { return this.st.preview(a, q); }

  private async doc(a: OrgUser, p: FsPeriod, issueNo: number | null, closed: boolean, computed?: Awaited<ReturnType<StatementsService['compute']>>) {
    const org = a.organizationId;
    const st = computed ?? await this.st.compute(org, p);
    const [customers, suppliers, dep, mapping, brand, board, appr] = await Promise.all([
      this.st.partners(org, p, 'customer'), this.st.partners(org, p, 'supplier'), this.st.depreciation(org, p), this.st.mapping(a),
      docBrand(this.db, this.files, org, this.log), boardBody(this.db, org, this.log),
      p.endsYear ? this.st.appropriation(a, p.year.id) : Promise.resolve(null),
    ]);
    return buildStatementsDoc({
      st, customers, suppliers, dep, mapping: mapping.rows, brand, board, actorName: a.fullName, issueNo, closed,
      appropriation: appr?.saved ? { inputs: appr.inputs, result: appr.result } : null,
    });
  }
}
