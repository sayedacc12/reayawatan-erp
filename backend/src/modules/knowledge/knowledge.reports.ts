import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ar, org, selectFilter } from '../../core/reports/report-helpers';
import { ReportDefinition } from '../../core/reports/report.types';
import { ReportsRegistry } from '../../core/reports/reports.registry';
import { DOC_STATUS, DOC_TYPES, DOC_VISIBILITY } from './entities/knowledge.entity';
import { KNOWLEDGE_PERMISSIONS as P } from './knowledge.manifest';
import { knToday } from './knowledge.service';

/** تقارير أرشيف المعرفة في البنية الموحدة */
@Injectable()
export class KnowledgeReports implements OnModuleInit {
  constructor(private readonly registry: ReportsRegistry, private readonly db: DataSource) {}

  onModuleInit() {
    const base = { module: 'knowledge', permission: P.reports };
    const defs: ReportDefinition[] = [
      {
        ...base, code: 'knowledge.register', category: 'الوثائق', title: 'سجل الوثائق', description: 'كل وثائق الأرشيف برموزها وإصداراتها وحالة نشرها',
        filters: [selectFilter('status', 'الحالة', DOC_STATUS), selectFilter('type', 'النوع', DOC_TYPES), selectFilter('visibility', 'الإتاحة', DOC_VISIBILITY)],
        link: '/knowledge/{id}', orientation: 'landscape',
        columns: [
          { key: 'code', label: 'الرمز' }, { key: 'title', label: 'العنوان' }, { key: 'category', label: 'التصنيف' }, { key: 'type', label: 'النوع' },
          { key: 'version', label: 'الإصدار' }, { key: 'issuedOn', label: 'تاريخ الإصدار', type: 'date' }, { key: 'reviewOn', label: 'موعد المراجعة', type: 'date' },
          { key: 'owner', label: 'الجهة المالكة' }, { key: 'status', label: 'الحالة' }, { key: 'visibility', label: 'الإتاحة' }, { key: 'views', label: 'المشاهدات', type: 'number', total: true },
        ],
        run: async (u, f) => {
          const rows = await this.db.query(
            `SELECT d.id, d.code, d.title, c.name AS category, d.doc_type, d.version, d.issued_on::text AS "issuedOn", d.review_on::text AS "reviewOn",
                    d.owner_name AS owner, d.status, d.visibility, d.views
               FROM kn_documents d LEFT JOIN kn_categories c ON c.id = d.category_id
              WHERE d.organization_id = $1 AND ($2::text IS NULL OR d.status = $2) AND ($3::text IS NULL OR d.doc_type = $3) AND ($4::text IS NULL OR d.visibility = $4)
              ORDER BY c.sort_order NULLS LAST, d.code NULLS LAST, d.title`,
            [org(u).organizationId, f.status ?? null, f.type ?? null, f.visibility ?? null]);
          return rows.map((r: Record<string, string>) => ({ ...r, type: ar(DOC_TYPES, r.doc_type), status: ar(DOC_STATUS, r.status), visibility: ar(DOC_VISIBILITY, r.visibility) }));
        },
      },
      {
        ...base, code: 'knowledge.review', category: 'الوثائق', title: 'الوثائق المستحقة للمراجعة', description: 'الوثائق المنشورة التي حل موعد مراجعتها أو يحل خلال 60 يومًا',
        filters: [], link: '/knowledge/{id}',
        columns: [
          { key: 'code', label: 'الرمز' }, { key: 'title', label: 'العنوان' }, { key: 'owner', label: 'الجهة المالكة' }, { key: 'version', label: 'الإصدار' },
          { key: 'reviewOn', label: 'موعد المراجعة', type: 'date' }, { key: 'days', label: 'الأيام المتبقية', type: 'number' },
        ],
        run: async (u) => {
          const t = knToday();
          const rows = await this.db.query(
            `SELECT id, code, title, owner_name AS owner, version, review_on::text AS "reviewOn", (review_on - $2::date)::int AS days
               FROM kn_documents WHERE organization_id = $1 AND status = 'published' AND review_on IS NOT NULL AND review_on <= $2::date + 60
              ORDER BY review_on`, [org(u).organizationId, t]);
          return rows.map((r: { days: number }) => ({ ...r, _style: r.days < 0 ? 'strong' : undefined }));
        },
      },
      {
        ...base, code: 'knowledge.by_category', category: 'الإحصاءات', title: 'الوثائق حسب التصنيف والنوع', description: 'عدد الوثائق المنشورة في كل تصنيف وكل نوع، والمتاح منها في الموقع',
        filters: [],
        columns: [
          { key: 'category', label: 'التصنيف' }, { key: 'published', label: 'منشورة', type: 'number', total: true }, { key: 'public', label: 'في الموقع', type: 'number', total: true },
          { key: 'drafts', label: 'مسودات', type: 'number', total: true }, { key: 'views', label: 'المشاهدات', type: 'number', total: true }, { key: 'downloads', label: 'التنزيلات', type: 'number', total: true },
        ],
        run: async (u) => this.db.query(
          `SELECT COALESCE(c.name, 'بدون تصنيف') AS category,
                  count(*) FILTER (WHERE d.status = 'published')::int AS published,
                  count(*) FILTER (WHERE d.status = 'published' AND d.visibility = 'public')::int AS public,
                  count(*) FILTER (WHERE d.status = 'draft')::int AS drafts, COALESCE(sum(d.views), 0)::int AS views, COALESCE(sum(d.downloads), 0)::int AS downloads
             FROM kn_documents d LEFT JOIN kn_categories c ON c.id = d.category_id
            WHERE d.organization_id = $1 GROUP BY c.name, c.sort_order ORDER BY c.sort_order NULLS LAST`, [org(u).organizationId]),
      },
    ];
    this.registry.register(defs);
  }
}
