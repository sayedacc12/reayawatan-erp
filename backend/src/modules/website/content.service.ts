import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { NewsStatus, ProgramStatus, ProgramStore, WebNews, WebProgram } from './entities/website.entity';
import { DecisionDto, NewsDto, OrderDto, ProgramDecisionDto, ProgramDto } from './website.dto';
import { WEBSITE_PERMISSIONS as P } from './website.manifest';
import { DEFAULT_PROGRAM_STORE } from './website-defaults';
import { UUID, WebCore, webToday } from './web-core.service';

export const NEWS_STATUS: Record<NewsStatus, string> = { draft: 'مسودة', pending: 'بانتظار الاعتماد', returned: 'معاد للتعديل', published: 'منشور' };
export const PROGRAM_STATUS: Record<ProgramStatus, string> = { draft: 'مسودة', pending: 'بانتظار الاعتماد', returned: 'معاد للتعديل', approved: 'معتمد', rejected: 'مرفوض' };
const clean = (s: string | null | undefined) => (s ?? '').trim() || null;
const can = (u: OrgUser, p: string) => u.permissions.includes(p);

/** سبب عدم قبول التبرع للبرنامج الآن ('' = يقبل) */
export function storeBlock(p: WebProgram, today = webToday()) {
  const s = p.store;
  if (p.status !== 'approved' || !p.showOnSite || !s?.on) return 'البرنامج غير متاح للتبرع';
  if (s.endDate && s.endDate < today) return 'انتهت حملة التبرع لهذا البرنامج';
  if (s.stop && s.goal && p.raised >= s.goal) return 'اكتمل المستهدف لهذا البرنامج، جزاكم الله خيرًا';
  return '';
}

/** الأخبار والبرامج: الإنشاء والتعديل ومسار الاعتماد والنشر */
@Injectable()
export class ContentService {
  constructor(private readonly db: DataSource, private readonly core: WebCore) {}

  // ---------------- الأخبار ----------------

  private newsRow(n: WebNews, slug: string) {
    return {
      id: n.id, title: n.title, summary: n.summary, newsDate: n.newsDate, ticker: n.ticker, status: n.status, statusLabel: NEWS_STATUS[n.status],
      imageId: n.imageId, imageUrl: this.core.mediaUrl(slug, n.imageId), reviewNote: n.reviewNote, views: n.views,
      createdByName: n.createdByName, publishedByName: n.publishedByName, publishedAt: n.publishedAt, updatedAt: n.updatedAt,
    };
  }

  async newsList(u: OrgUser, status?: string) {
    const where: Record<string, unknown> = { organizationId: u.organizationId };
    if (status && status in NEWS_STATUS) where.status = status;
    const rows = await this.db.getRepository(WebNews).find({ where, order: { newsDate: 'DESC', createdAt: 'DESC' }, take: 1000 });
    return rows.map((n) => this.newsRow(n, u.organizationSlug ?? ''));
  }

  private async loadNews(org: string, id: string, em: EntityManager = this.db.manager) {
    if (!UUID.test(id)) throw new NotFoundException('الخبر غير موجود');
    const n = await em.getRepository(WebNews).findOne({ where: { id, organizationId: org } });
    if (!n) throw new NotFoundException('الخبر غير موجود');
    return n;
  }

  /** المحرر يعدّل أخباره غير المنشورة فقط، ومن يملك الاعتماد يعدّل أي خبر */
  private canEditNews(u: OrgUser, n: WebNews) {
    if (can(u, P.publish)) return true;
    return can(u, P.edit) && n.createdById === u.id && n.status !== 'published' && n.status !== 'pending';
  }

  async newsGet(u: OrgUser, id: string) {
    const n = await this.loadNews(u.organizationId, id);
    return {
      ...this.newsRow(n, u.organizationSlug ?? ''), body: n.body,
      can: { edit: this.canEditNews(u, n), decide: can(u, P.publish) && n.status === 'pending', unpublish: can(u, P.publish) && n.status === 'published', remove: this.canEditNews(u, n) && (n.status !== 'published' || can(u, P.publish)) },
    };
  }

  private newsStatus(u: OrgUser, action: NewsDto['action']): NewsStatus {
    if (action === 'publish') {
      if (!can(u, P.publish)) throw new ForbiddenException('النشر المباشر لمن يملك صلاحية الاعتماد، أرسل الخبر للاعتماد');
      return 'published';
    }
    return action === 'submit' ? 'pending' : 'draft';
  }

  async newsCreate(u: OrgUser, dto: NewsDto) {
    const org = u.organizationId;
    const imageId = await this.core.assertMedia(org, dto.imageId);
    const status = this.newsStatus(u, dto.action);
    const n = await this.db.getRepository(WebNews).save({
      organizationId: org, title: dto.title, summary: dto.summary, body: dto.body, imageId, newsDate: dto.newsDate, ticker: dto.ticker, status,
      createdById: u.id, createdByName: u.fullName, ...(status === 'published' ? { publishedByName: u.fullName, publishedAt: new Date() } : {}),
    });
    await this.core.log(org, u.fullName, status === 'published' ? 'نشر خبر' : status === 'pending' ? 'إرسال خبر للاعتماد' : 'إضافة خبر (مسودة)', n.title);
    return this.newsGet(u, n.id);
  }

  async newsUpdate(u: OrgUser, id: string, dto: NewsDto) {
    const org = u.organizationId;
    const n = await this.loadNews(org, id);
    if (!this.canEditNews(u, n)) throw new ForbiddenException('لا يمكنك تعديل هذا الخبر');
    const imageId = await this.core.assertMedia(org, dto.imageId);
    const status = this.newsStatus(u, dto.action);
    await this.db.getRepository(WebNews).update({ id }, {
      title: dto.title, summary: dto.summary, body: dto.body, imageId, newsDate: dto.newsDate, ticker: dto.ticker, status, reviewNote: status === 'pending' ? null : n.reviewNote,
      ...(status === 'published' && n.status !== 'published' ? { publishedByName: u.fullName, publishedAt: new Date() } : {}),
    });
    await this.core.log(org, u.fullName, status === 'published' ? 'تعديل خبر منشور' : status === 'pending' ? 'إرسال خبر للاعتماد' : 'تعديل خبر', dto.title);
    return this.newsGet(u, id);
  }

  async newsDecide(u: OrgUser, id: string, dto: DecisionDto) {
    const org = u.organizationId;
    const n = await this.loadNews(org, id);
    const note = clean(dto.note);
    if (dto.decision === 'unpublish') {
      if (n.status !== 'published') throw new ConflictException('الخبر غير منشور');
      await this.db.getRepository(WebNews).update({ id }, { status: 'draft' });
      await this.core.log(org, u.fullName, 'إلغاء نشر خبر', n.title);
      return this.newsGet(u, id);
    }
    if (n.status !== 'pending') throw new ConflictException('الخبر ليس بانتظار الاعتماد');
    if (dto.decision !== 'approve' && !note) throw new BadRequestException('اكتب سبب الإرجاع ليعرف المحرر ما المطلوب');
    const status: NewsStatus = dto.decision === 'approve' ? 'published' : 'returned';
    await this.db.getRepository(WebNews).update({ id }, {
      status, reviewNote: note, ...(status === 'published' ? { publishedByName: u.fullName, publishedAt: new Date() } : {}),
    });
    await this.core.log(org, u.fullName, status === 'published' ? 'اعتماد ونشر خبر' : 'إرجاع خبر للتعديل', n.title);
    return this.newsGet(u, id);
  }

  async newsRemove(u: OrgUser, id: string) {
    const n = await this.loadNews(u.organizationId, id);
    if (!this.canEditNews(u, n) || (n.status === 'published' && !can(u, P.publish))) throw new ForbiddenException('لا يمكنك حذف هذا الخبر');
    await this.db.getRepository(WebNews).delete({ id });
    await this.core.log(u.organizationId, u.fullName, 'حذف خبر', n.title);
    return { ok: true };
  }

  // ---------------- البرامج ----------------

  private programRow(p: WebProgram, slug: string) {
    const s = { ...DEFAULT_PROGRAM_STORE, ...p.store };
    return {
      id: p.id, slug: p.slug, name: p.name, tagline: p.tagline, summary: p.summary, icon: p.icon, imageId: p.imageId, imageUrl: this.core.mediaUrl(slug, p.imageId),
      status: p.status, statusLabel: PROGRAM_STATUS[p.status], showOnSite: p.showOnSite, featured: p.featured, store: s, raised: p.raised,
      donationsCount: p.donationsCount, progress: s.goal ? Math.min(100, Math.round((p.raised / s.goal) * 100)) : null,
      storeBlock: p.status === 'approved' ? storeBlock({ ...p, store: s }) : null, sortOrder: p.sortOrder, reviewNote: p.reviewNote,
      activityId: p.activityId, kitDocId: p.kitDocId, createdByName: p.createdByName, approvedByName: p.approvedByName, updatedAt: p.updatedAt,
    };
  }

  async programs(u: OrgUser) {
    const rows = await this.db.getRepository(WebProgram).find({ where: { organizationId: u.organizationId }, order: { sortOrder: 'ASC', createdAt: 'ASC' } });
    return rows.map((p) => this.programRow(p, u.organizationSlug ?? ''));
  }

  private async loadProgram(org: string, id: string, em: EntityManager = this.db.manager) {
    if (!UUID.test(id)) throw new NotFoundException('البرنامج غير موجود');
    const p = await em.getRepository(WebProgram).findOne({ where: { id, organizationId: org } });
    if (!p) throw new NotFoundException('البرنامج غير موجود');
    return p;
  }

  /** المحرر يعدّل البرنامج وهو مسودة أو معاد، والمعتمد يعدّله في أي وقت */
  private canEditProgram(u: OrgUser, p: WebProgram) {
    return can(u, P.publish) || (can(u, P.edit) && ['draft', 'returned'].includes(p.status));
  }

  async program(u: OrgUser, id: string) {
    const p = await this.loadProgram(u.organizationId, id);
    const [activity] = p.activityId ? await this.db.query('SELECT name FROM activities WHERE id = $1', [p.activityId]) : [];
    const [kit] = p.kitDocId ? await this.db.query('SELECT title FROM kn_documents WHERE id = $1', [p.kitDocId]) : [];
    return {
      ...this.programRow(p, u.organizationSlug ?? ''), about: p.about, audience: p.audience, timing: p.timing, services: p.services, points: p.points,
      activityName: activity?.name ?? null, kitTitle: kit?.title ?? null, log: [...p.log].reverse(),
      can: { edit: this.canEditProgram(u, p), decide: can(u, P.publish) && p.status === 'pending', store: can(u, P.publish) && p.status === 'approved', remove: can(u, P.publish) ? p.donationsCount === 0 : can(u, P.edit) && p.status === 'draft' },
    };
  }

  private async programFields(em: EntityManager, org: string, dto: ProgramDto, id?: string) {
    const [dup] = await em.query('SELECT name FROM web_programs WHERE organization_id = $1 AND slug = $2 AND id <> $3', [org, dto.slug, id ?? '00000000-0000-0000-0000-000000000000']);
    if (dup) throw new ConflictException(`الرمز ${dto.slug} مستخدم في برنامج «${dup.name}»`);
    if (dto.activityId) {
      const [a] = await em.query('SELECT id FROM activities WHERE id = $1 AND organization_id = $2', [dto.activityId, org]);
      if (!a) throw new BadRequestException('المشروع المرتبط غير موجود في إدارة المشاريع');
    }
    if (dto.kitDocId) {
      const [d] = await em.query(`SELECT visibility, status FROM kn_documents WHERE id = $1 AND organization_id = $2`, [dto.kitDocId, org]);
      if (!d) throw new BadRequestException('الحقيبة التعريفية غير موجودة في أرشيف المعرفة');
      if (d.status !== 'published' || d.visibility !== 'public') throw new BadRequestException('الحقيبة التعريفية يجب أن تكون منشورة في الموقع من أرشيف المعرفة');
    }
    return {
      slug: dto.slug, name: dto.name, tagline: clean(dto.tagline), summary: dto.summary, about: clean(dto.about), audience: clean(dto.audience), timing: clean(dto.timing),
      services: dto.services.map((s) => ({ icon: s.icon, title: s.title, text: s.text })), points: dto.points.map((x) => x.trim()).filter(Boolean),
      icon: dto.icon, imageId: await this.core.assertMedia(org, dto.imageId, em), kitDocId: dto.kitDocId ?? null, activityId: dto.activityId ?? null,
    };
  }

  private entry(action: string, by: string, note: string | null = null) {
    return { action, note, byName: by, at: new Date().toISOString() };
  }

  async programCreate(u: OrgUser, dto: ProgramDto) {
    const org = u.organizationId;
    const id = await this.db.transaction(async (em) => {
      const f = await this.programFields(em, org, dto);
      const [{ n }] = await em.query('SELECT COALESCE(max(sort_order), 0) + 1 AS n FROM web_programs WHERE organization_id = $1', [org]);
      const status: ProgramStatus = dto.action === 'submit' ? 'pending' : 'draft';
      const p = await em.getRepository(WebProgram).save(em.create(WebProgram, {
        ...f, organizationId: org, status, store: DEFAULT_PROGRAM_STORE, sortOrder: n, createdByName: u.fullName,
        log: [this.entry(status === 'pending' ? 'إنشاء وإرسال للاعتماد' : 'إنشاء مسودة', u.fullName)],
      }));
      await this.core.log(org, u.fullName, status === 'pending' ? 'إضافة برنامج وإرساله للاعتماد' : 'إضافة برنامج (مسودة)', p.name, em);
      return p.id;
    });
    return this.program(u, id);
  }

  async programUpdate(u: OrgUser, id: string, dto: ProgramDto) {
    const org = u.organizationId;
    await this.db.transaction(async (em) => {
      const p = await this.loadProgram(org, id, em);
      if (!this.canEditProgram(u, p)) throw new ForbiddenException('لا يمكنك تعديل البرنامج في حالته الحالية');
      const f = await this.programFields(em, org, dto, id);
      // البرنامج المعتمد يبقى معتمدًا عند تعديل المعتمد له، والمسودة تُرسل للاعتماد عند الطلب
      const status: ProgramStatus = p.status === 'approved' ? 'approved' : dto.action === 'submit' ? 'pending' : p.status === 'returned' ? 'returned' : 'draft';
      await em.getRepository(WebProgram).update({ id }, {
        ...f, status, reviewNote: status === 'pending' ? null : p.reviewNote,
        log: [...p.log, this.entry(status === 'pending' && p.status !== 'pending' ? 'تعديل وإرسال للاعتماد' : 'تعديل', u.fullName)],
      });
      await this.core.log(org, u.fullName, status === 'pending' ? 'إرسال برنامج للاعتماد' : 'تعديل برنامج', f.name, em);
    });
    return this.program(u, id);
  }

  private async storeData(org: string, s: ProgramDecisionDto['store'] | undefined, current: ProgramStore): Promise<ProgramStore> {
    if (!s) return { ...DEFAULT_PROGRAM_STORE, ...current };
    if (s.on && !s.goal && s.kind === 'project') throw new BadRequestException('حدد المستهدف المالي للبرنامج قبل نشره في المتجر');
    if (s.max && s.min && s.max < s.min) throw new BadRequestException('الحد الأعلى للتبرع أقل من الحد الأدنى');
    if (s.revenueAccountId) {
      const [a] = await this.db.query(`SELECT kind FROM acc_accounts WHERE id = $1 AND organization_id = $2`, [s.revenueAccountId, org]);
      if (!a || a.kind !== 'sub') throw new BadRequestException('حساب الإيراد يجب أن يكون حسابًا فرعيًا من دليل الحسابات');
    }
    return {
      on: s.on, kind: s.kind, goal: s.goal, endDate: s.endDate || null, min: s.min, max: s.max, presets: [...new Set(s.presets)].sort((a, b) => a - b),
      stop: s.stop, monthly: s.monthly, gift: s.gift, revenueAccountId: s.revenueAccountId ?? null,
    };
  }

  /** قرار المعتمد: اعتماد مع تحديد الظهور والمتجر، أو إرجاع، أو رفض، أو تحديث بيانات المتجر لبرنامج معتمد */
  async programDecide(u: OrgUser, id: string, dto: ProgramDecisionDto) {
    const org = u.organizationId;
    const p = await this.loadProgram(org, id);
    const note = clean(dto.note);
    const repo = this.db.getRepository(WebProgram);
    if (dto.decision === 'unpublish') {
      if (p.status !== 'approved') throw new ConflictException('البرنامج غير معتمد');
      await repo.update({ id }, { showOnSite: false, store: { ...p.store, on: false }, log: [...p.log, this.entry('إخفاء من الموقع والمتجر', u.fullName, note)] });
      await this.core.log(org, u.fullName, 'إخفاء برنامج من الموقع', p.name);
      return this.program(u, id);
    }
    if (dto.decision === 'approve') {
      if (!['pending', 'approved'].includes(p.status)) throw new ConflictException('البرنامج ليس بانتظار الاعتماد');
      const store = await this.storeData(org, dto.store, p.store);
      const first = p.status === 'pending';
      await repo.update({ id }, {
        status: 'approved', reviewNote: note, showOnSite: dto.showOnSite ?? p.showOnSite, featured: dto.featured ?? p.featured, store,
        approvedByName: first ? u.fullName : p.approvedByName,
        log: [...p.log, this.entry(first ? `اعتماد${store.on ? ' والنشر في المتجر' : ''}` : 'تحديث بيانات النشر والمتجر', u.fullName, note)],
      });
      await this.core.log(org, u.fullName, first ? 'اعتماد برنامج' : 'تحديث بيانات متجر برنامج', p.name);
      return this.program(u, id);
    }
    if (p.status !== 'pending') throw new ConflictException('البرنامج ليس بانتظار الاعتماد');
    if (!note) throw new BadRequestException(dto.decision === 'reject' ? 'اكتب سبب الرفض' : 'اكتب سبب الإرجاع ليعرف المحرر ما المطلوب');
    const status: ProgramStatus = dto.decision === 'reject' ? 'rejected' : 'returned';
    await repo.update({ id }, { status, reviewNote: note, log: [...p.log, this.entry(status === 'rejected' ? 'رفض' : 'إرجاع للتعديل', u.fullName, note)] });
    await this.core.log(org, u.fullName, status === 'rejected' ? 'رفض برنامج' : 'إرجاع برنامج للتعديل', p.name);
    return this.program(u, id);
  }

  async programRemove(u: OrgUser, id: string) {
    const p = await this.loadProgram(u.organizationId, id);
    if (p.donationsCount > 0) throw new ConflictException('لا يُحذف برنامج وصلته تبرعات، أخفه من الموقع بدلًا من ذلك');
    if (!can(u, P.publish) && p.status !== 'draft') throw new ForbiddenException('يحذف المحرر المسودات فقط');
    await this.db.getRepository(WebProgram).delete({ id });
    await this.core.log(u.organizationId, u.fullName, 'حذف برنامج', p.name);
    return { ok: true };
  }

  async programOrder(u: OrgUser, dto: OrderDto) {
    await this.db.transaction(async (em) => {
      for (const [i, id] of dto.ids.entries()) await em.update(WebProgram, { id, organizationId: u.organizationId }, { sortOrder: i + 1 });
    });
    await this.core.log(u.organizationId, u.fullName, 'ترتيب البرامج');
    return this.programs(u);
  }

  /** قوائم الاختيار في نموذج البرنامج: مشاريع إدارة المشاريع ووثائق الأرشيف العامة والحسابات */
  async programLookups(u: OrgUser) {
    const org = u.organizationId;
    const [activities, docs, accounts] = await Promise.all([
      this.db.query(`SELECT id, name, level FROM activities WHERE organization_id = $1 AND is_active ORDER BY level, sort_order, name`, [org]),
      this.db.query(`SELECT id, code, title FROM kn_documents WHERE organization_id = $1 AND status = 'published' AND visibility = 'public' ORDER BY title`, [org]),
      this.db.query(`SELECT id, code, name FROM acc_accounts WHERE organization_id = $1 AND kind = 'sub' AND is_active AND nature = 'revenue' ORDER BY code`, [org]).catch(() => []),
    ]);
    return { activities, docs, accounts, today: webToday() };
  }
}
