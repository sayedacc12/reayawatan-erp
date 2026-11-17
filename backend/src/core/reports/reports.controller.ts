import { BadRequestException, Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthUser, CurrentUser } from '../auth/decorators';
import { renderCsv, renderXlsx } from './report-files';
import { renderReportHtml } from './report-html';
import { ReportPdfService } from './report-pdf.service';
import { ReportsRegistry } from './reports.registry';

const FORMATS = ['pdf', 'xlsx', 'csv', 'html'] as const;
type Format = (typeof FORMATS)[number];
const MIME: Record<Format, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
  html: 'text/html; charset=utf-8',
};

/** اسم ملف آمن: عنوان التقرير وتاريخ اليوم */
const fileName = (title: string, ext: string) =>
  `${title.replace(/[\\/:*?"<>|]+/g, ' ').trim()} - ${new Date().toISOString().slice(0, 10)}.${ext}`;

/**
 * واجهة التقارير الموحدة لكل الأنظمة:
 *   GET /api/reports/catalog/:module       قائمة تقارير النظام المتاحة للمستخدم
 *   GET /api/reports/def/:code             تعريف التقرير وفلاتره وخياراتها
 *   GET /api/reports/run/:code?...         تشغيل التقرير (JSON للمعاينة)
 *   GET /api/reports/export/:code?format=pdf|xlsx|csv|html&...
 * الصلاحيات تُفحص لكل تقرير حسب تعريفه في السجل.
 */
@Controller('reports')
export class ReportsController {
  constructor(private readonly registry: ReportsRegistry, private readonly pdf: ReportPdfService) {}

  @Get('catalog/:module')
  catalog(@CurrentUser() user: AuthUser, @Param('module') module: string) {
    return { reports: this.registry.catalog(user, module), pdf: this.pdf.available };
  }

  @Get('def/:code')
  describe(@CurrentUser() user: AuthUser, @Param('code') code: string) {
    return this.registry.describe(user, code);
  }

  @Get('run/:code')
  run(@CurrentUser() user: AuthUser, @Param('code') code: string, @Query() q: Record<string, unknown>) {
    return this.registry.run(user, code, q);
  }

  @Get('export/:code')
  async export(@CurrentUser() user: AuthUser, @Param('code') code: string, @Query() q: Record<string, unknown>, @Res() res: Response) {
    const format = String(q.format ?? 'pdf') as Format;
    if (!FORMATS.includes(format)) throw new BadRequestException('صيغة التصدير غير مدعومة');
    const { format: _f, ...filters } = q;
    const out = await this.registry.run(user, code, filters);
    let body: Buffer | string;
    if (format === 'pdf') {
      body = await this.pdf.render(renderReportHtml(out), {
        landscape: out.orientation === 'landscape',
        footerLeft: [out.title, out.organizationName].filter(Boolean).join(' · '),
      });
    } else if (format === 'xlsx') body = await renderXlsx(out);
    else if (format === 'csv') body = renderCsv(out);
    else body = renderReportHtml(out, { print: true });
    const name = fileName(out.title, format);
    res.setHeader('Content-Type', MIME[format]);
    res.setHeader('Content-Disposition', `${format === 'html' ? 'inline' : 'attachment'}; filename="report.${format}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(body);
  }
}
