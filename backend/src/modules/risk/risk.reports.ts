import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ar, org, selectFilter } from '../../core/reports/report-helpers';
import { ReportDefinition } from '../../core/reports/report.types';
import { ReportsRegistry } from '../../core/reports/reports.registry';
import { RiskChange, RiskControl, RiskItem, RiskObligation } from './entities/risk.entity';
import { levelOf } from './risk-calc';
import { RiskCore, today } from './risk-core.service';
import { RiskReportsService } from './reports.service';
import { RISK_PERMISSIONS as P } from './risk.manifest';

const SOURCE: Record<string, string> = { internal: 'داخلي', external: 'خارجي', product: 'منتج / خدمة' };
const TREATMENT: Record<string, string> = { avoid: 'تجنب', reduce: 'تخفيف', transfer: 'نقل', accept: 'قبول' };
const STATE: Record<string, string> = { open: 'مفتوح', treating: 'قيد المعالجة', monitoring: 'تحت المراقبة', closed: 'مغلق' };
const WF: Record<string, string> = { draft: 'مسودة', in_review: 'قيد الاعتماد', returned: 'مُرجع للتعديل', approved: 'معتمد', rejected: 'مرفوض' };
const CONTROL_TYPE: Record<string, string> = { preventive: 'وقائي', detective: 'كاشف', corrective: 'تصحيحي', directive: 'توجيهي' };
const EFFECT: Record<string, string> = { effective: 'فعّال', partial: 'فعّال جزئيًا', ineffective: 'غير فعّال', not_tested: 'لم يُختبر' };
const FREQ: Record<string, string> = { once: 'مرة واحدة', monthly: 'شهري', quarterly: 'ربع سنوي', semiannual: 'نصف سنوي', annual: 'سنوي', continuous: 'مستمر' };
const RESULT: Record<string, string> = { compliant: 'ممتثل', partial: 'ممتثل جزئيًا', non_compliant: 'غير ممتثل', not_applicable: 'لا ينطبق' };
const PHASE: Record<string, string> = { request: 'طلب', implementing: 'قيد التنفيذ', completed: 'مكتمل', closed: 'مغلق' };
const PRIORITY: Record<string, string> = { low: 'منخفضة', medium: 'متوسطة', high: 'عالية', urgent: 'عاجلة' };
const CLASS: Record<string, string> = { standard: 'قياسي', normal: 'عادي', emergency: 'طارئ' };
const yes = (b: unknown) => (b ? 'نعم' : null);

/** تقارير المخاطر والالتزام والتغيير والاستمرارية في البنية الموحدة */
@Injectable()
export class RiskReports implements OnModuleInit {
  constructor(private readonly registry: ReportsRegistry, private readonly reports: RiskReportsService, private readonly core: RiskCore, private readonly db: DataSource) {}

  onModuleInit() {
    const base = { module: 'risk', permission: P.reports };
    const data = (u: Parameters<ReportDefinition['run']>[0]) => this.reports.reports(org(u));
    const defs: ReportDefinition[] = [
      {
        ...base, code: 'risk.register', category: 'المخاطر', title: 'سجل المخاطر', description: 'كل المخاطر مع الدرجة الأصلية والمتبقية والمعالجة والمالك، مرتبة حسب الدرجة المتبقية',
        filters: [selectFilter('state', 'حالة الخطر', STATE), selectFilter('source', 'المصدر', SOURCE)], link: '/risk/register/{id}', orientation: 'landscape',
        columns: [
          { key: 'code', label: 'الرمز' }, { key: 'title', label: 'الخطر' }, { key: 'category', label: 'الفئة' }, { key: 'source', label: 'المصدر' },
          { key: 'unitName', label: 'الوحدة' }, { key: 'ownerName', label: 'المالك' }, { key: 'inherentScore', label: 'الأصلية', type: 'number' },
          { key: 'residualScore', label: 'المتبقية', type: 'number' }, { key: 'level', label: 'المستوى' }, { key: 'treatment', label: 'المعالجة' },
          { key: 'state', label: 'الحالة' }, { key: 'nextReviewDate', label: 'المراجعة القادمة', type: 'date' },
        ],
        run: async (u, f) => {
          const o = org(u).organizationId;
          const cfg = await this.core.config(o);
          const cat = new Map(cfg.categories.map((c) => [c.code, c.name]));
          const rows = await this.db.getRepository(RiskItem).find({ where: { organizationId: o }, order: { residualScore: 'DESC', code: 'ASC' } });
          return rows.filter((r) => r.status !== 'rejected' && (!f.state || r.riskState === f.state) && (!f.source || r.source === f.source)).map((r) => ({
            id: r.id, code: r.code, title: r.title, category: cat.get(r.category) ?? r.category, source: ar(SOURCE, r.source), unitName: r.unitName, ownerName: r.ownerName,
            inherentScore: r.inherentScore, residualScore: r.residualScore, level: levelOf(cfg, r.residualScore).name, treatment: ar(TREATMENT, r.treatment),
            state: ar(STATE, r.riskState), nextReviewDate: r.nextReviewDate,
          }));
        },
      },
      {
        ...base, code: 'risk.above-appetite', category: 'المخاطر', title: 'المخاطر فوق حد القابلية', description: 'المخاطر التي تتجاوز درجتها المتبقية حد قابلية الجمعية للمخاطر',
        link: '/risk/register/{id}',
        columns: [
          { key: 'code', label: 'الرمز' }, { key: 'title', label: 'الخطر' }, { key: 'score', label: 'الدرجة المتبقية', type: 'number' }, { key: 'level', label: 'المستوى' },
          { key: 'treatment', label: 'المعالجة' }, { key: 'ownerName', label: 'المالك' },
        ],
        run: async (u) => {
          const d = await data(u);
          return {
            rows: d.risks.aboveAppetite.map((r) => ({ ...r, level: r.level.name, treatment: ar(TREATMENT, r.treatment) })),
            summary: [{ label: 'حد القابلية', value: d.config.appetite, type: 'number' }, { label: 'المخاطر القائمة', value: d.risks.total, type: 'number' }, { label: 'نسبة خفض المخاطر', value: d.risks.reduction, type: 'percent' }],
          };
        },
      },
      {
        ...base, code: 'risk.overdue', category: 'المخاطر', title: 'المتأخرات في معالجة المخاطر', description: 'إجراءات المعالجة المتأخرة، والمخاطر التي تجاوزت موعد مراجعتها، ومؤشرات الإنذار المتجاوزة',
        columns: [{ key: 'kind', label: 'النوع' }, { key: 'code', label: 'رمز الخطر' }, { key: 'item', label: 'البند' }, { key: 'ownerName', label: 'المسؤول' }, { key: 'date', label: 'الموعد', type: 'date' }],
        run: async (u) => {
          const r = (await data(u)).risks;
          return [
            ...r.overdueActions.map((x) => ({ kind: 'إجراء معالجة متأخر', code: x.code, item: x.title, ownerName: x.ownerName, date: x.dueDate })),
            ...r.reviewOverdue.map((x) => ({ kind: 'مراجعة متأخرة', code: x.code, item: x.title, ownerName: x.ownerName, date: x.nextReviewDate })),
            ...r.kriBreaches.map((x) => ({ kind: 'مؤشر إنذار متجاوز', code: x.code, item: `${x.kri}: ${x.current ?? '—'} (الحد ${x.threshold})`, ownerName: null, date: null })),
          ];
        },
      },
      {
        ...base, code: 'risk.controls', category: 'الضوابط', title: 'سجل الضوابط وفاعليتها', description: 'الضوابط النشطة ونوعها وتكرارها وآخر اختبار لفاعليتها',
        link: '/risk/controls', filters: [selectFilter('effectiveness', 'الفاعلية', EFFECT)],
        columns: [
          { key: 'code', label: 'الرمز' }, { key: 'name', label: 'الضابط' }, { key: 'type', label: 'النوع' }, { key: 'frequency', label: 'التكرار' }, { key: 'ownerName', label: 'المالك' },
          { key: 'effectiveness', label: 'الفاعلية' }, { key: 'lastTestDate', label: 'آخر اختبار', type: 'date' }, { key: 'risks', label: 'المخاطر المرتبطة', type: 'number' },
          { key: 'untested', label: 'لم يُختبر خلال سنة' },
        ],
        run: async (u, f) => {
          const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
          const rows = await this.db.getRepository(RiskControl).find({ where: { organizationId: org(u).organizationId, isActive: true }, order: { code: 'ASC' } });
          return rows.filter((c) => !f.effectiveness || c.effectiveness === f.effectiveness).map((c) => ({
            code: c.code, name: c.name, type: ar(CONTROL_TYPE, c.type), frequency: ar(FREQ, c.frequency), ownerName: c.ownerName, effectiveness: ar(EFFECT, c.effectiveness),
            lastTestDate: c.lastTestDate, risks: c.riskIds.length, untested: yes(!c.lastTestDate || c.lastTestDate < yearAgo),
          }));
        },
      },
      {
        ...base, code: 'risk.compliance', category: 'الالتزام', title: 'الالتزام حسب الجهة', description: 'المتطلبات النظامية لكل جهة ونتائج آخر تقييم ونسبة الالتزام',
        link: '/risk/compliance',
        columns: [
          { key: 'authority', label: 'الجهة' }, { key: 'total', label: 'المتطلبات', type: 'number', total: true }, { key: 'compliant', label: 'ممتثل', type: 'number', total: true },
          { key: 'partial', label: 'جزئي', type: 'number', total: true }, { key: 'non', label: 'غير ممتثل', type: 'number', total: true },
          { key: 'notAssessed', label: 'لم يُقيّم', type: 'number', total: true }, { key: 'rate', label: 'نسبة الالتزام', type: 'percent' },
        ],
        run: async (u) => (await data(u)).compliance.byAuthority,
      },
      {
        ...base, code: 'risk.obligations', category: 'الالتزام', title: 'سجل المتطلبات النظامية', description: 'كل متطلب نظامي وجهته ومرجعه وآخر نتيجة تقييم وموعد التقييم القادم',
        link: '/risk/compliance', filters: [selectFilter('result', 'آخر نتيجة', RESULT)], orientation: 'landscape',
        columns: [
          { key: 'code', label: 'الرمز' }, { key: 'title', label: 'المتطلب' }, { key: 'authority', label: 'الجهة' }, { key: 'reference', label: 'المرجع' }, { key: 'ownerName', label: 'المسؤول' },
          { key: 'frequency', label: 'التكرار' }, { key: 'lastResult', label: 'آخر نتيجة' }, { key: 'lastAssessedAt', label: 'آخر تقييم', type: 'date' },
          { key: 'nextDueDate', label: 'التقييم القادم', type: 'date' }, { key: 'due', label: 'مستحق' },
        ],
        run: async (u, f) => {
          const t = today();
          const rows = await this.db.getRepository(RiskObligation).find({ where: { organizationId: org(u).organizationId, isActive: true }, order: { code: 'ASC' } });
          return rows.filter((o) => !f.result || o.lastResult === f.result).map((o) => ({
            code: o.code, title: o.title, authority: o.authority, reference: o.reference, ownerName: o.ownerName, frequency: ar(FREQ, o.frequency),
            lastResult: o.lastResult ? ar(RESULT, o.lastResult) : 'لم يُقيّم', lastAssessedAt: o.lastAssessedAt, nextDueDate: o.nextDueDate, due: yes(!!o.nextDueDate && o.nextDueDate < t),
          }));
        },
      },
      {
        ...base, code: 'risk.compliance-gaps', category: 'الالتزام', title: 'فجوات الالتزام المفتوحة', description: 'المتطلبات غير الممتثلة أو الممتثلة جزئيًا وإجراءات معالجتها ومواعيدها',
        link: '/risk/compliance',
        columns: [
          { key: 'code', label: 'الرمز' }, { key: 'title', label: 'المتطلب' }, { key: 'gaps', label: 'الفجوات' }, { key: 'actionOwner', label: 'المسؤول' },
          { key: 'actionDueDate', label: 'الموعد', type: 'date' }, { key: 'overdue', label: 'متأخر' },
        ],
        run: async (u) => (await data(u)).compliance.openGaps.map((g) => ({ ...g, overdue: yes(g.overdue) })),
      },
      {
        ...base, code: 'risk.changes', category: 'التغيير', title: 'سجل طلبات التغيير', description: 'طلبات التغيير وتصنيفها وأولويتها ومرحلتها وحالة اعتمادها',
        link: '/risk/changes/{id}', filters: [selectFilter('phase', 'المرحلة', PHASE)], orientation: 'landscape',
        columns: [
          { key: 'code', label: 'الرمز' }, { key: 'title', label: 'التغيير' }, { key: 'changeClass', label: 'التصنيف' }, { key: 'priority', label: 'الأولوية' },
          { key: 'requestedBy', label: 'مقدم الطلب' }, { key: 'plannedStart', label: 'البداية', type: 'date' }, { key: 'plannedEnd', label: 'النهاية', type: 'date' },
          { key: 'costEstimate', label: 'التكلفة التقديرية', type: 'money', total: true }, { key: 'phase', label: 'المرحلة' }, { key: 'status', label: 'الاعتماد' },
        ],
        run: async (u, f) => {
          const rows = await this.db.getRepository(RiskChange).find({ where: { organizationId: org(u).organizationId }, order: { code: 'DESC' } });
          return rows.filter((c) => !f.phase || c.phase === f.phase).map((c) => ({
            id: c.id, code: c.code, title: c.title, changeClass: ar(CLASS, c.changeClass), priority: ar(PRIORITY, c.priority), requestedBy: c.requestedBy,
            plannedStart: c.plannedStart, plannedEnd: c.plannedEnd, costEstimate: c.costEstimate === null ? null : Number(c.costEstimate), phase: ar(PHASE, c.phase), status: ar(WF, c.status),
          }));
        },
      },
      {
        ...base, code: 'risk.continuity', category: 'الاستمرارية', title: 'تحليل أثر الأعمال (BIA)', description: 'الأنشطة الحرجة وزمن الاستعادة المستهدف وأقصى توقف محتمل وآخر اختبار لخطة الاستمرارية',
        link: '/risk/continuity/{id}',
        columns: [
          { key: 'code', label: 'الرمز' }, { key: 'activity', label: 'النشاط' }, { key: 'criticality', label: 'الأهمية' }, { key: 'rtoHours', label: 'زمن الاستعادة (ساعة)', type: 'number' },
          { key: 'mtpdHours', label: 'أقصى توقف (ساعة)', type: 'number' }, { key: 'lastTestDate', label: 'آخر اختبار', type: 'date' }, { key: 'untested', label: 'لم يُختبر خلال سنة' },
          { key: 'status', label: 'الاعتماد' },
        ],
        run: async (u) => (await data(u)).continuity.activities.map((a) => ({ ...a, criticality: a.criticality.name, untested: yes(a.untested), status: ar(WF, a.status) })),
      },
    ];
    this.registry.register(defs);
  }
}
