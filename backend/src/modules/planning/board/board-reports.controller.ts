import { Controller, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentOrgUser, OrgUser, RequireAnyPermission } from '../../../core/auth/decorators';
import { ReportPdfService } from '../../../core/reports/report-pdf.service';
import { PLANNING_PERMISSIONS as P } from '../planning.manifest';
import { renderBoardDoc } from './board-doc';
import { BoardReportQueryDto } from './board-reports.dto';
import { BOARD_TYPES, BoardReportsService, BoardType } from './board-reports.service';

/**
 * تقارير مجلس المديرين (اعتماد وتقييم أداء) للخطط والموازنات:
 *   GET /api/planning/board-reports              النماذج والخطط والموازنات المتاحة للمستخدم
 *   GET /api/planning/board-reports/:type?...    الوثيقة بصيغة html (للمعاينة والطباعة) أو pdf
 */
@Controller('planning/board-reports')
export class BoardReportsController {
  constructor(private readonly reports: BoardReportsService, private readonly pdf: ReportPdfService) {}

  @Get() @RequireAnyPermission(P.reports, P.budgets)
  catalog(@CurrentOrgUser() a: OrgUser) {
    return this.reports.catalog(a).then((c) => ({ ...c, pdf: this.pdf.available }));
  }

  @Get(':type') @RequireAnyPermission(P.reports, P.budgets)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async render(@CurrentOrgUser() a: OrgUser, @Param('type') type: string, @Query() q: BoardReportQueryDto, @Res() res: Response) {
    if (!(BOARD_TYPES as readonly string[]).includes(type)) throw new NotFoundException('التقرير غير موجود');
    const doc = await this.reports.build(a, type as BoardType, q);
    const format = q.format ?? 'html';
    const name = `${doc.title} - ${doc.subject} - ${new Date().toISOString().slice(0, 10)}.${format}`.replace(/[\\/:*?"<>|]+/g, ' ');
    res.setHeader('Cache-Control', 'no-store');
    if (format === 'pdf') {
      const body = await this.pdf.render(renderBoardDoc(doc), { landscape: false, footerLeft: `${doc.docNo} · ${doc.organizationName}` });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="board-report.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`);
      res.send(body);
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="board-report.html"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:");
    res.send(renderBoardDoc(doc, { print: true }));
  }
}
