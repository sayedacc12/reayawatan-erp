import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { DEFAULT_DEPARTMENTS, DEFAULT_PREFIXES, DOC_TYPES, DocType, QmsContext, QmsDocument, QmsProcessMap, QmsSettings, QmsStep } from './entities/quality.entity';
import { ContextDto, SettingsDto } from './quality.dto';

/** اليوم بتوقيت الرياض */
export const today = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const addMonths = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x.toISOString().slice(0, 10);
};
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86400000);
export const shortId = () => randomBytes(4).toString('hex');
export const step = (actor: OrgUser, action: string, note?: string | null, revision?: number): QmsStep => ({
  action, byName: actor.fullName, at: new Date().toISOString(), note: note ?? null, ...(revision !== undefined ? { revision } : {}),
});
export const rev = (n: number) => `Rev.${String(n).padStart(2, '0')}`;

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  manual: 'دليل', policy: 'سياسة', procedure: 'إجراء', instruction: 'تعليمات عمل', form: 'نموذج', record: 'سجل', plan: 'خطة', external: 'وثيقة خارجية',
};

/** وثيقة مرمّزة من نظام آخر تظهر في السجل الموحد (نماذج العملاء، الأوصاف الوظيفية) */
export interface ExternalDoc { id: string; code: string; title: string; docType: DocType; revision: number; status: string; source: string; sourceLabel: string; path: string; updatedAt: Date }

const EMPTY_CONTEXT: QmsContext = {
  scope: '', exclusions: '', issues: [], parties: [], processes: [], policy: { text: '', approvedBy: '', date: null }, responsibilities: [],
};

/** الإعدادات والترميز الموحد والسياق: مشتركة بين خدمات الجودة */
@Injectable()
export class QmsCore {
  constructor(readonly db: DataSource) {}

  async settings(org: string, em: EntityManager = this.db.manager) {
    const repo = em.getRepository(QmsSettings);
    let s = await repo.findOne({ where: { organizationId: org } });
    if (!s) {
      await repo.createQueryBuilder().insert().values({ organizationId: org, departments: DEFAULT_DEPARTMENTS, prefixes: DEFAULT_PREFIXES }).orIgnore().execute();
      s = await repo.findOneOrFail({ where: { organizationId: org } });
    }
    return s;
  }

  prefixes(s: QmsSettings): Record<DocType, string> {
    return { ...DEFAULT_PREFIXES, ...s.prefixes };
  }

  async getSettings(actor: OrgUser) {
    const s = await this.settings(actor.organizationId);
    return {
      prefixes: this.prefixes(s), departments: s.departments, seqDigits: s.seqDigits, reviewMonths: s.reviewMonths,
      complaintDays: s.complaintDays, ncrDays: s.ncrDays, docTypes: DOC_TYPES.map((t) => ({ value: t, label: DOC_TYPE_LABELS[t] })),
      example: `${this.prefixes(s).procedure}-${s.departments[0]?.code ?? 'QMS'}-${'1'.padStart(s.seqDigits, '0')}`,
    };
  }

  async saveSettings(actor: OrgUser, dto: SettingsDto) {
    const prefixes: Partial<Record<DocType, string>> = {};
    for (const t of DOC_TYPES) {
      const p = String(dto.prefixes[t] ?? DEFAULT_PREFIXES[t]).trim().toUpperCase();
      if (!/^[A-Z]{1,5}$/.test(p)) throw new BadRequestException(`بادئة "${DOC_TYPE_LABELS[t]}" من 1 إلى 5 حروف إنجليزية`);
      prefixes[t] = p;
    }
    if (new Set(Object.values(prefixes)).size !== DOC_TYPES.length) throw new BadRequestException('لكل نوع وثيقة بادئة مختلفة');
    const departments = dto.departments.map((d) => ({ code: d.code.toUpperCase(), name: d.name }));
    if (!departments.length) throw new BadRequestException('أضف إدارة واحدة على الأقل');
    if (new Set(departments.map((d) => d.code)).size !== departments.length) throw new BadRequestException('رموز الإدارات مكررة');
    // لا يُحذف رمز إدارة مستخدم في وثائق أو سجلات
    const s = await this.settings(actor.organizationId);
    const removed = s.departments.filter((d) => !departments.some((x) => x.code === d.code)).map((d) => d.code);
    if (removed.length) {
      const [{ n }] = await this.db.query(
        `SELECT (SELECT COUNT(*) FROM quality_documents WHERE organization_id = $1 AND department = ANY($2))
          + (SELECT COUNT(*) FROM quality_ncrs WHERE organization_id = $1 AND department = ANY($2))
          + (SELECT COUNT(*) FROM quality_risks WHERE organization_id = $1 AND department = ANY($2)) AS n`, [actor.organizationId, removed]);
      if (Number(n) > 0) throw new BadRequestException(`الرمز ${removed.join('، ')} مستخدم في وثائق أو سجلات، فلا يمكن حذفه`);
    }
    Object.assign(s, { prefixes, departments, seqDigits: dto.seqDigits, reviewMonths: dto.reviewMonths, complaintDays: dto.complaintDays, ncrDays: dto.ncrDays });
    await this.db.getRepository(QmsSettings).save(s);
    return this.getSettings(actor);
  }

  async department(org: string, code: string) {
    const s = await this.settings(org);
    const d = s.departments.find((x) => x.code === code);
    if (!d) throw new BadRequestException('اختر الإدارة من القائمة');
    return d;
  }

  async deptNames(org: string) {
    const s = await this.settings(org);
    return Object.fromEntries(s.departments.map((d) => [d.code, d.name])) as Record<string, string>;
  }

  // ---------------- السياق والسياسة (البندان 4 و5) ----------------

  async getContext(actor: OrgUser) {
    const s = await this.settings(actor.organizationId);
    return { ...EMPTY_CONTEXT, ...s.context, policy: { ...EMPTY_CONTEXT.policy, ...(s.context.policy ?? {}) } };
  }

  async saveContext(actor: OrgUser, dto: ContextDto) {
    const c = dto.context as Partial<QmsContext>;
    const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
    const list = <T>(v: unknown, map: (x: Record<string, unknown>) => T, max = 60) => (Array.isArray(v) ? v.slice(0, max).map((x) => map((x ?? {}) as Record<string, unknown>)) : []);
    const context: QmsContext = {
      scope: str(c.scope, 4000),
      exclusions: str(c.exclusions, 2000),
      issues: list(c.issues, (x) => ({ kind: x.kind === 'external' ? 'external' : 'internal', category: str(x.category, 80), text: str(x.text, 500) })).filter((x) => x.text) as QmsContext['issues'],
      parties: list(c.parties, (x) => ({ name: str(x.name, 120), needs: str(x.needs, 600), monitoring: str(x.monitoring, 300) })).filter((x) => x.name),
      processes: list(c.processes, (x) => ({ name: str(x.name, 120), owner: str(x.owner, 120), inputs: str(x.inputs, 400), outputs: str(x.outputs, 400), kpi: str(x.kpi, 200) })).filter((x) => x.name),
      policy: { text: str(c.policy?.text, 6000), approvedBy: str(c.policy?.approvedBy, 200), date: c.policy?.date && /^\d{4}-\d{2}-\d{2}$/.test(c.policy.date) ? c.policy.date : null },
      responsibilities: list(c.responsibilities, (x) => ({ role: str(x.role, 120), duties: str(x.duties, 1000) })).filter((x) => x.role),
    };
    const s = await this.settings(actor.organizationId);
    s.context = context;
    await this.db.getRepository(QmsSettings).save(s);
    return this.getContext(actor);
  }

  // ---------------- الترميز الموحد ----------------

  /** الوثائق المرمّزة في الأنظمة الأخرى (قراءة فقط) لتظهر في السجل الرئيسي ويُمنع تكرار أكوادها */
  async externalDocs(org: string): Promise<ExternalDoc[]> {
    const forms: { id: string; code: string; title: string; revision: number; status: string; updated_at: Date }[] = await this.db.query(
      `SELECT id, quality_code AS code, name AS title, revision, status, updated_at FROM dynamic_forms WHERE organization_id = $1 AND quality_code IS NOT NULL`, [org]);
    const jobs: { id: string; code: string; title: string; revision: number; status: string; updated_at: Date; is_active: boolean }[] = await this.db.query(
      `SELECT id, quality_code AS code, title, revision, status, updated_at, is_active FROM hr_jobs WHERE organization_id = $1 AND quality_code IS NOT NULL`, [org]);
    const formStatus: Record<string, string> = { draft: 'draft', review: 'review', reviewed: 'approval', approved: 'approved' };
    return [
      ...forms.map((f) => ({
        id: f.id, code: f.code, title: f.title, docType: 'form' as const, revision: f.revision, status: formStatus[f.status] ?? f.status,
        source: 'beneficiaries', sourceLabel: 'المساعدات الاجتماعية', path: '/beneficiaries/settings?tab=forms', updatedAt: f.updated_at,
      })),
      ...jobs.map((j) => ({
        id: j.id, code: j.code, title: `الوصف الوظيفي: ${j.title}`, docType: 'form' as const, revision: j.revision, status: j.is_active ? j.status : 'obsolete',
        source: 'hr', sourceLabel: 'الموارد البشرية', path: `/hr/jobs/${j.id}`, updatedAt: j.updated_at,
      })),
    ];
  }

  /** هل الكود مستخدم في أي نظام (وثائق الجودة، الخرائط، نماذج العملاء، الأوصاف الوظيفية) */
  async codeOwner(org: string, code: string, except?: { table: 'doc' | 'map'; id: string }): Promise<string | null> {
    const up = code.toUpperCase();
    const doc = await this.db.getRepository(QmsDocument).findOne({ where: { organizationId: org, code: up }, select: { id: true, title: true } });
    if (doc && !(except?.table === 'doc' && except.id === doc.id)) return `الوثيقة "${doc.title}"`;
    const map = await this.db.getRepository(QmsProcessMap).findOne({ where: { organizationId: org, code: up }, select: { id: true, title: true } });
    if (map && !(except?.table === 'map' && except.id === map.id)) return `خريطة الإجراء "${map.title}"`;
    const ext = (await this.externalDocs(org)).find((e) => e.code.toUpperCase() === up);
    return ext ? `${ext.title} (${ext.sourceLabel})` : null;
  }

  async ensureFreeCode(org: string, code: string, except?: { table: 'doc' | 'map'; id: string }) {
    const owner = await this.codeOwner(org, code, except);
    if (owner) throw new ConflictException(`الكود ${code.toUpperCase()} مستخدم في ${owner}`);
    return code.toUpperCase();
  }

  /** الكود التالي بالشكل البادئة-الإدارة-التسلسل، مثل QP-QMS-03 */
  async nextCode(org: string, prefix: string, dept: string) {
    const s = await this.settings(org);
    const base = `${prefix}-${dept}-`;
    const used = new Set<string>([
      ...(await this.db.query(`SELECT code FROM quality_documents WHERE organization_id = $1 AND code LIKE $2`, [org, `${base}%`])).map((r: { code: string }) => r.code),
      ...(await this.db.query(`SELECT code FROM quality_process_maps WHERE organization_id = $1 AND code LIKE $2`, [org, `${base}%`])).map((r: { code: string }) => r.code),
      ...(await this.externalDocs(org)).map((e) => e.code.toUpperCase()).filter((c) => c.startsWith(base)),
    ]);
    let max = 0;
    for (const c of used) {
      const n = Number(c.slice(base.length));
      if (Number.isInteger(n) && n > max) max = n;
    }
    return `${base}${String(max + 1).padStart(s.seqDigits, '0')}`;
  }

  async suggestCode(actor: OrgUser, docType: DocType, dept: string) {
    const s = await this.settings(actor.organizationId);
    if (!DOC_TYPES.includes(docType)) throw new BadRequestException('نوع الوثيقة غير صحيح');
    await this.department(actor.organizationId, dept);
    return { code: await this.nextCode(actor.organizationId, this.prefixes(s)[docType], dept) };
  }

  /** الرقم التسلسلي التالي لجدول (الشكاوى وعدم المطابقة والمراجعات...) */
  async nextNo(em: EntityManager, table: string, column: string, org: string) {
    // قفل صف الإعدادات يمنع تكرار الرقم مع الحفظ المتزامن
    await this.settings(org, em);
    await em.query('SELECT organization_id FROM quality_settings WHERE organization_id = $1 FOR UPDATE', [org]);
    const [{ n }] = await em.query(`SELECT COALESCE(MAX(${column}), 0) + 1 AS n FROM ${table} WHERE organization_id = $1`, [org]);
    return Number(n);
  }
}
