import { Controller, Get, Logger, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import type { Response } from 'express';
import { DataSource } from 'typeorm';
import { CurrentOrgUser, OrgUser, RequireAnyPermission } from '../../../core/auth/decorators';
import { FileStore } from '../../../core/files/file-store.service';
import { renderBoardDoc } from '../../../core/reports/board-doc';
import { docBrand } from '../../../core/reports/doc-brand';
import { ReportPdfService } from '../../../core/reports/report-pdf.service';
import { ACC_PERMISSIONS as A } from '../../accounting/accounting.manifest';
import { PLANNING_PERMISSIONS as P } from '../planning.manifest';
import { BudgetVariance, VarSpan } from './budget-variance.service';

export class VarianceQueryDto {
  @IsIn(['M', 'Q', 'H', 'Y'], { message: 'نوع الفترة: شهري أو ربعي أو نصفي أو سنوي' })
  span!: VarSpan;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12)
  part?: number;

  @IsOptional() @IsIn(['period', 'ytd'])
  basis?: 'period' | 'ytd';

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  threshold?: number;

  @IsOptional() @IsIn(['json', 'html', 'pdf', 'xlsx'])
  format?: 'json' | 'html' | 'pdf' | 'xlsx';
}

/** من يتابع الموازنة في التخطيط، أو يقرأ تقارير النظام المالي ويعد قوائمه */
const READERS = [P.reports, P.budgets, A.reports, A.statements];

/**
 * تقرير انحرافات الموازنة (ربط الموازنة والتخطيط بالنظام المالي):
 *   GET /api/planning/variance/budgets                 الموازنات المعتمدة
 *   GET /api/planning/variance/:budgetId?span&part&basis&threshold&format=json|html|pdf|xlsx
 */
@Controller('planning/variance')
export class VarianceController {
  private readonly log = new Logger('BudgetVariance');
  constructor(private readonly v: BudgetVariance, private readonly pdf: ReportPdfService, private readonly db: DataSource, private readonly files: FileStore) {}

  @Get('budgets') @RequireAnyPermission(...READERS)
  async budgets(@CurrentOrgUser() a: OrgUser) { return { budgets: await this.v.budgets(a), pdf: this.pdf.available }; }

  @Get(':budgetId') @RequireAnyPermission(...READERS)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async report(@CurrentOrgUser() a: OrgUser, @Param('budgetId', ParseUUIDPipe) id: string, @Query() q: VarianceQueryDto, @Res() res: Response) {
    const data = await this.v.build(a, { budgetId: id, span: q.span, part: q.part, basis: q.basis, threshold: q.threshold });
    const format = q.format ?? 'json';
    res.setHeader('Cache-Control', 'no-store');
    if (format === 'json') { res.json(data); return; }
    const brand = await docBrand(this.db, this.files, a.organizationId, this.log);
    const name = `انحرافات الموازنة - ${data.budget.code} - ${data.period.label}`.replace(/[\\/:*?"<>|]+/g, ' ');
    if (format === 'xlsx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="budget-variance.xlsx"; filename*=UTF-8''${encodeURIComponent(`${name}.xlsx`)}`);
      res.send(await this.v.xlsx(data, brand.organizationName));
      return;
    }
    const doc = this.v.doc(data, brand, a.fullName);
    if (format === 'pdf') {
      const body = await this.pdf.render(renderBoardDoc(doc), { landscape: false, footerLeft: `${doc.docNo} · ${doc.organizationName}` });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="budget-variance.pdf"; filename*=UTF-8''${encodeURIComponent(`${name}.pdf`)}`);
      res.send(body);
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="budget-variance.html"');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:");
    res.send(renderBoardDoc(doc, { print: true }));
  }
}
