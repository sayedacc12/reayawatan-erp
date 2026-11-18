import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { FileStore } from '../../core/files/file-store.service';
import { CategoriesDto, DocumentDto, StatusDto, VersionDto } from './knowledge.dto';
import { KNOWLEDGE_PERMISSIONS as P } from './knowledge.manifest';
import {
  DOC_STATUS, DOC_TYPES, DOC_VISIBILITY, DocFile, DocStatus, DocType, DocVisibility, KnCategory, KnDocument,
} from './entities/knowledge.entity';

const UUID = /^[0-9a-f-]{36}$/i;
export const knToday = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
const clean = (s: string | null | undefined) => (s ?? '').trim() || null;

export const DEFAULT_CATEGORIES = [
  { name: 'الحوكمة واللوائح', color: '#0f766e', description: 'اللائحة الأساسية ولوائح المجلس واللجان والسياسات المعتمدة' },
  { name: 'الموارد البشرية', color: '#7c3aed', description: 'لائحة الموارد البشرية والأدلة والنماذج' },
  { name: 'المالية والمشتريات', color: '#b45309', description: 'اللائحة المالية والمشتريات والعقود' },
  { name: 'البرامج والمستفيدون', color: '#0369a1', description: 'أدلة البرامج والدراسات وتقارير الأثر' },
  { name: 'الجودة والتميز المؤسسي', color: '#be123c', description: 'الإجراءات والنماذج والدروس المستفادة' },
  { name: 'التقارير والإفصاح', color: '#4d7c0f', description: 'التقارير السنوية والقوائم المالية المنشورة' },
];

/** أرشيف المعرفة: الوثائق وإصداراتها وتصنيفاتها، ويستخدمه الموقع الإلكتروني لعرض الوثائق العامة */
@Injectable()
export class KnowledgeService {
  constructor(private readonly db: DataSource, private readonly files: FileStore) {}

  private canManage(u: OrgUser) {
    return u.permissions.includes(P.manage) || u.permissions.includes(P.publish);
  }

  // ---------------- التصنيفات ----------------

  async categories(org: string, em: EntityManager = this.db.manager) {
    const repo = em.getRepository(KnCategory);
    let list = await repo.find({ where: { organizationId: org }, order: { sortOrder: 'ASC', name: 'ASC' } });
    if (!list.length) {
      const [{ n }] = await em.query('SELECT count(*)::int AS n FROM kn_documents WHERE organization_id = $1', [org]);
      if (!n) {
        await repo.save(DEFAULT_CATEGORIES.map((c, i) => repo.create({ ...c, organizationId: org, sortOrder: i })));
        list = await repo.find({ where: { organizationId: org }, order: { sortOrder: 'ASC', name: 'ASC' } });
      }
    }
    return list;
  }

  async saveCategories(actor: OrgUser, dto: CategoriesDto) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const repo = em.getRepository(KnCategory);
      const existing = await repo.find({ where: { organizationId: org } });
      const keep = new Set<string>();
      for (const [i, c] of dto.categories.entries()) {
        const data = { name: c.name.trim(), description: clean(c.description), color: c.color.toLowerCase(), isActive: c.isActive, sortOrder: i };
        if (c.id) {
          const row = existing.find((x) => x.id === c.id);
          if (!row) throw new BadRequestException('تصنيف غير موجود');
          await repo.update({ id: c.id }, data);
          keep.add(c.id);
        } else {
          const row = await repo.save(repo.create({ ...data, organizationId: org }));
          keep.add(row.id);
        }
      }
      for (const row of existing.filter((x) => !keep.has(x.id))) {
        const [{ n }] = await em.query('SELECT count(*)::int AS n FROM kn_documents WHERE category_id = $1', [row.id]);
        if (n) throw new ConflictException(`لا يمكن حذف التصنيف «${row.name}» لأن فيه ${n} وثيقة. أوقفه بدلًا من ذلك أو انقل وثائقه`);
        await repo.delete({ id: row.id });
      }
    });
    return this.categories(org);
  }

  async lookups(org: string) {
    return { categories: await this.categories(org), types: DOC_TYPES, statuses: DOC_STATUS, visibility: DOC_VISIBILITY };
  }

  // ---------------- الوثائق ----------------

  private async load(org: string, id: string, em: EntityManager = this.db.manager) {
    if (!UUID.test(id)) throw new NotFoundException('الوثيقة غير موجودة');
    const d = await em.getRepository(KnDocument).findOne({ where: { id, organizationId: org } });
    if (!d) throw new NotFoundException('الوثيقة غير موجودة');
    return d;
  }

  /** الوثيقة المسودة أو المؤرشفة لا يراها إلا من يدير الأرشيف */
  private visibleTo(u: OrgUser, d: KnDocument) {
    return d.status === 'published' || this.canManage(u);
  }

  private row(d: KnDocument, cats: Map<string, KnCategory>) {
    const c = d.categoryId ? cats.get(d.categoryId) : null;
    return {
      id: d.id, code: d.code, title: d.title, docType: d.docType, typeLabel: DOC_TYPES[d.docType] ?? d.docType, categoryId: d.categoryId,
      categoryName: c?.name ?? null, categoryColor: c?.color ?? '#64748b', summary: d.summary, tags: d.tags, version: d.version,
      issuedOn: d.issuedOn, reviewOn: d.reviewOn, ownerName: d.ownerName, status: d.status, statusLabel: DOC_STATUS[d.status],
      visibility: d.visibility, hasFile: !!d.file, fileName: d.file?.name ?? null, fileMime: d.file?.mime ?? null, externalUrl: d.externalUrl,
      hasContent: !!d.content, views: d.views, downloads: d.downloads, updatedAt: d.updatedAt,
      reviewDue: d.status === 'published' && !!d.reviewOn && d.reviewOn <= knToday(),
    };
  }

  async list(u: OrgUser, f: { q?: string; category?: string; type?: string; status?: string; visibility?: string; review?: string }) {
    const org = u.organizationId;
    const cats = new Map((await this.categories(org)).map((c) => [c.id, c]));
    const qb = this.db.getRepository(KnDocument).createQueryBuilder('d').where('d.organization_id = :org', { org });
    if (!this.canManage(u)) qb.andWhere(`d.status = 'published'`);
    else if (f.status && f.status in DOC_STATUS) qb.andWhere('d.status = :st', { st: f.status });
    if (f.category && UUID.test(f.category)) qb.andWhere('d.category_id = :c', { c: f.category });
    if (f.type && f.type in DOC_TYPES) qb.andWhere('d.doc_type = :t', { t: f.type });
    if (f.visibility && f.visibility in DOC_VISIBILITY) qb.andWhere('d.visibility = :v', { v: f.visibility });
    if (f.review === '1') qb.andWhere(`d.status = 'published' AND d.review_on <= :today`, { today: knToday() });
    const q = (f.q ?? '').trim();
    if (q) {
      qb.andWhere(`(d.title ILIKE :q OR d.code ILIKE :q OR d.summary ILIKE :q OR d.content ILIKE :q OR d.owner_name ILIKE :q OR d.tags::text ILIKE :q)`, { q: `%${q.replace(/[%_]/g, '')}%` });
    }
    const rows = await qb.orderBy('d.updated_at', 'DESC').take(1000).getMany();
    return rows.map((d) => this.row(d, cats));
  }

  async overview(u: OrgUser) {
    const org = u.organizationId;
    const all = await this.list(u, {});
    const cats = await this.categories(org);
    const published = all.filter((d) => d.status === 'published');
    return {
      total: all.length, published: published.length, drafts: all.filter((d) => d.status === 'draft').length,
      archived: all.filter((d) => d.status === 'archived').length, public: published.filter((d) => d.visibility === 'public').length,
      reviewDue: all.filter((d) => d.reviewDue).length,
      byCategory: cats.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name, color: c.color, count: published.filter((d) => d.categoryId === c.id).length })),
      byType: Object.entries(DOC_TYPES).map(([k, l]) => ({ key: k, label: l, count: published.filter((d) => d.docType === k).length })).filter((x) => x.count),
      recent: published.slice(0, 6), popular: [...published].sort((a, b) => b.views - a.views).slice(0, 5),
    };
  }

  async get(u: OrgUser, id: string) {
    const d = await this.load(u.organizationId, id);
    if (!this.visibleTo(u, d)) throw new NotFoundException('الوثيقة غير موجودة');
    await this.db.query('UPDATE kn_documents SET views = views + 1 WHERE id = $1', [id]);
    const cats = new Map((await this.categories(u.organizationId)).map((c) => [c.id, c]));
    return {
      ...this.row({ ...d, views: d.views + 1 } as KnDocument, cats), content: d.content, approvedBy: d.approvedBy,
      versions: d.versions.map((v, i) => ({ index: i, version: v.version, issuedOn: v.issuedOn, note: v.note, byName: v.byName, at: v.at, hasFile: !!v.file, fileName: v.file?.name ?? null })),
      log: [...d.log].reverse(), createdByName: d.createdByName, createdAt: d.createdAt, publishedAt: d.publishedAt,
      can: { edit: u.permissions.includes(P.manage), publish: u.permissions.includes(P.publish), remove: u.permissions.includes(P.manage) && d.status === 'draft' },
    };
  }

  private async fields(em: EntityManager, org: string, dto: DocumentDto, id?: string) {
    const code = clean(dto.code);
    if (code) {
      const [dup] = await em.query('SELECT id, title FROM kn_documents WHERE organization_id = $1 AND code = $2 AND id <> $3', [org, code, id ?? '00000000-0000-0000-0000-000000000000']);
      if (dup) throw new ConflictException(`الرمز ${code} مستخدم في وثيقة «${dup.title}»`);
    }
    if (dto.categoryId) {
      const [c] = await em.query('SELECT id FROM kn_categories WHERE id = $1 AND organization_id = $2', [dto.categoryId, org]);
      if (!c) throw new BadRequestException('التصنيف غير موجود');
    }
    const url = clean(dto.externalUrl);
    if (url && !/^https:\/\/[^\s"'<>]+$/.test(url)) throw new BadRequestException('الرابط الخارجي يجب أن يبدأ بـ https://');
    if (dto.reviewOn && dto.issuedOn && dto.reviewOn < dto.issuedOn) throw new BadRequestException('موعد المراجعة يجب أن يكون بعد تاريخ الإصدار');
    return {
      code, title: dto.title.trim(), categoryId: dto.categoryId ?? null, docType: dto.docType as DocType, summary: clean(dto.summary), content: clean(dto.content),
      tags: [...new Set(dto.tags.map((t) => t.trim()).filter(Boolean))], version: dto.version.trim(), issuedOn: dto.issuedOn || null, reviewOn: dto.reviewOn || null,
      ownerName: clean(dto.ownerName), approvedBy: clean(dto.approvedBy), externalUrl: url,
    };
  }

  private entry(action: string, by: string, note: string | null = null) {
    return { action, note, byName: by, at: new Date().toISOString() };
  }

  async create(u: OrgUser, dto: DocumentDto) {
    const org = u.organizationId;
    const id = await this.db.transaction(async (em) => {
      const f = await this.fields(em, org, dto);
      const d = await em.getRepository(KnDocument).save(em.create(KnDocument, {
        ...f, organizationId: org, status: 'draft', visibility: 'internal', createdByName: u.fullName, log: [this.entry('create', u.fullName)],
      }));
      return d.id;
    });
    return this.get(u, id);
  }

  async update(u: OrgUser, id: string, dto: DocumentDto) {
    await this.db.transaction(async (em) => {
      const d = await this.load(u.organizationId, id, em);
      const f = await this.fields(em, u.organizationId, dto, id);
      await em.getRepository(KnDocument).update({ id }, { ...f, log: [...d.log, this.entry('update', u.fullName)] });
    });
    return this.get(u, id);
  }

  /** رفع ملف الوثيقة أو استبداله دون تغيير الإصدار (لتصحيح ملف مرفوع خطأ) */
  async attach(u: OrgUser, id: string, file: Express.Multer.File | undefined) {
    const d = await this.load(u.organizationId, id);
    const saved = await this.files.save(`knowledge/${u.organizationId}`, file, 'ملف الوثيقة');
    const f: DocFile = { key: saved.key, name: saved.name, mime: saved.mime, size: file!.size };
    await this.db.getRepository(KnDocument).update({ id }, { file: f, log: [...d.log, this.entry('file', u.fullName, saved.name)] });
    if (d.file && !d.versions.some((v) => v.file?.key === d.file!.key)) await this.files.remove(d.file.key).catch(() => undefined);
    return this.get(u, id);
  }

  /** إصدار جديد: يُحفظ الإصدار الحالي وملفه في السجل، ويصبح الجديد هو المعتمد */
  async newVersion(u: OrgUser, id: string, dto: VersionDto, file: Express.Multer.File | undefined) {
    const d = await this.load(u.organizationId, id);
    const version = dto.version.trim();
    if (version === d.version) throw new BadRequestException(`الإصدار ${version} هو الإصدار الحالي، اكتب رقم إصدار جديد`);
    let f: DocFile | null = d.file;
    if (file) {
      const saved = await this.files.save(`knowledge/${u.organizationId}`, file, 'ملف الإصدار');
      f = { key: saved.key, name: saved.name, mime: saved.mime, size: file.size };
    }
    const prev = { version: d.version, file: d.file, issuedOn: d.issuedOn, note: null, byName: u.fullName, at: new Date().toISOString() };
    await this.db.getRepository(KnDocument).update({ id }, {
      versions: [...d.versions, prev], version, file: f, issuedOn: dto.issuedOn || knToday(),
      log: [...d.log, this.entry('version', u.fullName, `الإصدار ${version}${dto.note ? `: ${dto.note}` : ''}`)],
    });
    return this.get(u, id);
  }

  async setStatus(u: OrgUser, id: string, dto: StatusDto) {
    const d = await this.load(u.organizationId, id);
    const status = dto.status as DocStatus;
    const visibility = dto.visibility as DocVisibility;
    if (status === 'published' && !d.file && !d.content && !d.externalUrl) throw new BadRequestException('أرفق ملف الوثيقة أو اكتب محتواها أو أضف رابطها قبل النشر');
    if (visibility === 'public' && status !== 'published') throw new BadRequestException('لا تظهر الوثيقة في الموقع إلا وهي منشورة');
    const label = status === d.status ? (visibility === 'public' ? 'إتاحة في الموقع' : 'إخفاء من الموقع') : DOC_STATUS[status];
    await this.db.getRepository(KnDocument).update({ id }, {
      status, visibility, publishedAt: status === 'published' ? (d.publishedAt ?? new Date()) : d.publishedAt,
      log: [...d.log, this.entry(`status:${label}`, u.fullName, clean(dto.note))],
    });
    return this.get(u, id);
  }

  async remove(u: OrgUser, id: string) {
    const d = await this.load(u.organizationId, id);
    if (d.status !== 'draft') throw new ConflictException('تُحذف المسودات فقط، أما الوثيقة المنشورة فتُؤرشف');
    await this.db.getRepository(KnDocument).delete({ id });
    const keys = [d.file?.key, ...d.versions.map((v) => v.file?.key)].filter(Boolean) as string[];
    await Promise.all(keys.map((k) => this.files.remove(k).catch(() => undefined)));
    return { ok: true };
  }

  async file(u: OrgUser, id: string, version?: number) {
    const d = await this.load(u.organizationId, id);
    if (!this.visibleTo(u, d)) throw new NotFoundException('الوثيقة غير موجودة');
    const f = version === undefined ? d.file : d.versions[version]?.file;
    if (!f) throw new NotFoundException('لا يوجد ملف');
    await this.db.query('UPDATE kn_documents SET downloads = downloads + 1 WHERE id = $1', [id]);
    return { stream: this.files.open(f.key), mime: f.mime, name: f.name };
  }

  // ---------------- للموقع الإلكتروني ----------------

  /** الوثائق المنشورة والمتاحة للعامة، مجمعة حسب التصنيف */
  async publicDocuments(org: string) {
    const cats = await this.categories(org);
    const docs = await this.db.getRepository(KnDocument).find({
      where: { organizationId: org, status: 'published', visibility: 'public' }, order: { code: 'ASC', title: 'ASC' },
    });
    return cats.filter((c) => c.isActive).map((c) => ({ name: c.name, color: c.color, items: docs.filter((d) => d.categoryId === c.id) }))
      .concat([{ name: 'وثائق أخرى', color: '#64748b', items: docs.filter((d) => !d.categoryId || !cats.some((c) => c.id === d.categoryId && c.isActive)) }])
      .filter((g) => g.items.length)
      .map((g) => ({
        ...g, items: g.items.map((d) => ({
          id: d.id, code: d.code, title: d.title, typeLabel: DOC_TYPES[d.docType], summary: d.summary, version: d.version, issuedOn: d.issuedOn,
          hasFile: !!d.file, externalUrl: d.externalUrl, hasContent: !!d.content,
        })),
      }));
  }

  async publicDocument(org: string, id: string) {
    const d = await this.load(org, id).catch(() => null);
    if (!d || d.status !== 'published' || d.visibility !== 'public') throw new NotFoundException('الوثيقة غير متاحة');
    return { id: d.id, code: d.code, title: d.title, typeLabel: DOC_TYPES[d.docType], summary: d.summary, content: d.content, version: d.version, issuedOn: d.issuedOn, hasFile: !!d.file, externalUrl: d.externalUrl };
  }

  async publicFile(org: string, id: string) {
    const d = await this.load(org, id).catch(() => null);
    if (!d || d.status !== 'published' || d.visibility !== 'public' || !d.file) throw new NotFoundException('الملف غير متاح');
    await this.db.query('UPDATE kn_documents SET downloads = downloads + 1 WHERE id = $1', [id]);
    return { stream: this.files.open(d.file.key), mime: d.file.mime, name: d.file.name };
  }

  /** قائمة مختصرة لاختيار وثيقة (مثل الحقيبة التعريفية لبرنامج في الموقع) */
  async pickList(u: OrgUser) {
    if (!u.permissions.some((p) => p.startsWith('knowledge.') || p.startsWith('website.'))) throw new ForbiddenException();
    return this.db.query(
      `SELECT id, code, title, visibility FROM kn_documents WHERE organization_id = $1 AND status = 'published' ORDER BY title LIMIT 500`, [u.organizationId]);
  }
}
