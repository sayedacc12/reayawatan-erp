import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In, IsNull } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { DocCopy, DocSection, DocType, QmsDocument, QmsDocumentRevision, QmsProcessMap } from './entities/quality.entity';
import { DistributeDto, DocActionDto, DocumentDto, ProcessMapDto } from './quality.dto';
import { DOC_TYPE_LABELS, QmsCore, addDays, addMonths, rev, step, today } from './quality-core.service';
import { QUALITY_PERMISSIONS as P } from './quality.manifest';

export const DOC_STATUS_LABELS: Record<string, string> = {
  draft: 'مسودة', review: 'بانتظار مراجعة الجودة', approval: 'بانتظار الاعتماد', approved: 'معتمدة سارية', obsolete: 'ملغاة',
};
const ACTION_LABELS: Record<string, string> = {
  created: 'إنشاء', updated: 'تعديل', submit: 'رفع للمراجعة', pass: 'اجتازت مراجعة الجودة', return: 'إعادة للتعديل', approve: 'اعتماد',
  revise: 'بدء إصدار جديد', obsolete: 'إلغاء الوثيقة', distribute: 'توزيع نسخ', acknowledge: 'تأكيد استلام',
};

/** قالب أقسام كل نوع وثيقة عند الإنشاء */
export function defaultSections(t: DocType): DocSection[] {
  const s = (...titles: string[]) => titles.map((title) => ({ title, body: '' }));
  if (t === 'procedure') return s('الغرض', 'النطاق', 'التعريفات', 'المسؤوليات', 'خطوات الإجراء', 'السجلات والنماذج المرتبطة', 'المراجع');
  if (t === 'manual') return s('مقدمة عن الجمعية', 'نطاق نظام إدارة الجودة', 'سياسة الجودة', 'الهيكل والمسؤوليات', 'عمليات النظام وتفاعلها', 'قائمة الإجراءات');
  if (t === 'policy') return s('نص السياسة', 'النطاق', 'المسؤوليات');
  if (t === 'instruction') return s('الغرض', 'الخطوات', 'احتياطات وملاحظات');
  if (t === 'plan') return s('الأهداف', 'الأنشطة والمسؤوليات', 'الموارد', 'الجدول الزمني', 'المتابعة والقياس');
  return s('الوصف', 'طريقة التعبئة');
}

/** الوثائق المضبوطة (7.5) وخرائط الإجراءات (4.4) */
@Injectable()
export class DocumentsService {
  constructor(private readonly db: DataSource, private readonly core: QmsCore) {}

  private get docs() {
    return this.db.getRepository(QmsDocument);
  }

  private can(actor: OrgUser, p: string) {
    return actor.isSuperadmin || actor.permissions.includes(p);
  }

  async findDoc(org: string, id: string) {
    const d = await this.docs.findOne({ where: { id, organizationId: org } });
    if (!d) throw new NotFoundException('الوثيقة غير موجودة');
    return d;
  }

  private row(d: QmsDocument, depts: Record<string, string>, maps: Map<string, string>) {
    const t = today();
    return {
      id: d.id, code: d.code, title: d.title, docType: d.docType, typeLabel: DOC_TYPE_LABELS[d.docType], department: d.department, departmentName: depts[d.department] ?? d.department,
      revision: d.revision, revisionLabel: rev(d.approvedRevision ?? d.revision), workingRevision: d.approvedRevision !== null && d.revision !== d.approvedRevision ? rev(d.revision) : null,
      approvedRevision: d.approvedRevision, status: d.status, statusLabel: DOC_STATUS_LABELS[d.status], ownerName: d.ownerName, isoClauses: d.isoClauses,
      effectiveDate: d.effectiveDate, nextReviewDate: d.nextReviewDate,
      reviewDue: d.status !== 'obsolete' && !!d.nextReviewDate && d.nextReviewDate <= addDays(t, 30),
      reviewOverdue: d.status !== 'obsolete' && !!d.nextReviewDate && d.nextReviewDate < t,
      copies: d.distribution.filter((c) => !c.withdrawnAt).length, pendingAck: d.distribution.filter((c) => !c.withdrawnAt && !c.acknowledgedAt).length,
      mapId: maps.get(d.id) ?? null, source: 'quality', sourceLabel: 'الجودة', path: `/quality/documents/${d.id}`, updatedAt: d.updatedAt,
    };
  }

  /** السجل الرئيسي للوثائق: وثائق الجودة + الوثائق المرمّزة في الأنظمة الأخرى */
  async list(actor: OrgUser, q: { type?: string; status?: string; department?: string; search?: string; external?: string }) {
    const org = actor.organizationId;
    const depts = await this.core.deptNames(org);
    const maps = new Map((await this.db.getRepository(QmsProcessMap).find({ where: { organizationId: org }, select: { id: true, documentId: true } }))
      .filter((m) => m.documentId).map((m) => [m.documentId!, m.id]));
    const rows: ReturnType<DocumentsService['row']>[] = (await this.docs.find({ where: { organizationId: org }, order: { code: 'ASC' } })).map((d) => this.row(d, depts, maps));
    const external = q.external === '0' ? [] : (await this.core.externalDocs(org)).map((e) => {
      const dept = e.source === 'hr' ? 'HR' : 'BEN';
      return {
        ...this.row({ ...e, department: dept, ownerName: e.sourceLabel, isoClauses: [], approvedRevision: e.status === 'approved' ? e.revision : null, effectiveDate: null, nextReviewDate: null, distribution: [] } as unknown as QmsDocument, depts, maps),
        id: e.id, status: e.status, statusLabel: DOC_STATUS_LABELS[e.status] ?? e.status, source: e.source, sourceLabel: e.sourceLabel, path: e.path, mapId: null,
      };
    });
    const s = q.search?.trim().toLowerCase();
    const all = [...rows, ...external].filter((r) => (!q.type || r.docType === q.type) && (!q.department || r.department === q.department)
      && (!q.status || (q.status === 'due' ? r.reviewDue : q.status === 'active' ? r.status !== 'obsolete' : r.status === q.status))
      && (!s || r.code.toLowerCase().includes(s) || r.title.toLowerCase().includes(s)));
    all.sort((a, b) => a.code.localeCompare(b.code));
    return {
      rows: all,
      counts: {
        total: rows.length + external.length, approved: [...rows, ...external].filter((r) => r.status === 'approved').length,
        pending: rows.filter((r) => r.status === 'review' || r.status === 'approval').length, due: rows.filter((r) => r.reviewDue).length,
        obsolete: rows.filter((r) => r.status === 'obsolete').length, external: external.length,
      },
    };
  }

  async get(actor: OrgUser, id: string) {
    const d = await this.findDoc(actor.organizationId, id);
    const depts = await this.core.deptNames(actor.organizationId);
    const revisions = await this.db.getRepository(QmsDocumentRevision).find({ where: { documentId: d.id }, order: { revision: 'DESC' } });
    const maps = await this.db.getRepository(QmsProcessMap).find({ where: { organizationId: actor.organizationId, documentId: d.id }, select: { id: true, code: true, title: true } });
    const related = d.relatedCodes.length
      ? (await this.list(actor, {})).rows.filter((r) => d.relatedCodes.includes(r.code)).map((r) => ({ id: r.id, code: r.code, title: r.title, path: r.path, status: r.status }))
      : [];
    // الوثائق التي تشير إلى هذه الوثيقة
    const referencedBy = (await this.docs.createQueryBuilder('d').where('d.organization_id = :org', { org: actor.organizationId })
      .andWhere('d.related_codes @> :code', { code: JSON.stringify([d.code]) }).select(['d.id', 'd.code', 'd.title']).getMany())
      .map((x) => ({ id: x.id, code: x.code, title: x.title, path: `/quality/documents/${x.id}`, status: '' }));
    return {
      ...this.row(d, depts, new Map(maps.length ? [[d.id, maps[0].id]] : [])),
      sections: d.sections, relatedCodes: d.relatedCodes, retention: d.retention, changeSummary: d.changeSummary, createdByName: d.createdByName,
      distribution: d.distribution,
      history: d.history.map((h) => ({ ...h, actionLabel: ACTION_LABELS[h.action] ?? h.action, revisionLabel: h.revision !== undefined ? rev(h.revision) : null })),
      revisions: revisions.map((r) => ({ ...r, revisionLabel: rev(r.revision) })),
      maps, related, referencedBy,
      canEdit: d.status === 'draft' && this.can(actor, P.documents),
    };
  }

  private normSections(sections: DocSection[]) {
    return sections.map((s) => ({ title: s.title.trim(), body: (s.body ?? '').trim() }));
  }

  async create(actor: OrgUser, dto: DocumentDto) {
    const org = actor.organizationId;
    await this.core.department(org, dto.department);
    const s = await this.core.settings(org);
    const code = dto.code ? await this.core.ensureFreeCode(org, dto.code) : await this.core.nextCode(org, this.core.prefixes(s)[dto.docType], dto.department);
    const d = await this.docs.save(this.docs.create({
      organizationId: org, code, title: dto.title, docType: dto.docType, department: dto.department, isoClauses: dto.isoClauses, ownerName: dto.ownerName ?? null,
      sections: dto.sections.length ? this.normSections(dto.sections) : defaultSections(dto.docType), relatedCodes: (dto.relatedCodes ?? []).map((c) => c.toUpperCase()),
      retention: dto.retention ?? null, changeSummary: dto.changeSummary ?? 'الإصدار الأول', revision: 0, status: 'draft', createdByName: actor.fullName,
      history: [step(actor, 'created', null, 0)],
    }));
    return this.get(actor, d.id);
  }

  async update(actor: OrgUser, id: string, dto: DocumentDto) {
    const d = await this.findDoc(actor.organizationId, id);
    if (d.status !== 'draft') throw new BadRequestException('لا تُعدّل الوثيقة إلا وهي مسودة. للوثيقة المعتمدة اختر «إصدار جديد»');
    await this.core.department(actor.organizationId, dto.department);
    if (dto.code && dto.code.toUpperCase() !== d.code) {
      if (d.approvedRevision !== null) throw new BadRequestException('لا يتغير كود وثيقة سبق اعتمادها');
      d.code = await this.core.ensureFreeCode(actor.organizationId, dto.code, { table: 'doc', id: d.id });
    }
    Object.assign(d, {
      title: dto.title, docType: dto.docType, department: dto.department, isoClauses: dto.isoClauses, ownerName: dto.ownerName ?? null,
      sections: this.normSections(dto.sections), relatedCodes: (dto.relatedCodes ?? []).map((c) => c.toUpperCase()).filter((c) => c !== d.code),
      retention: dto.retention ?? null, changeSummary: dto.changeSummary ?? d.changeSummary,
    });
    d.history = [...d.history, step(actor, 'updated', null, d.revision)];
    await this.docs.save(d);
    return this.get(actor, d.id);
  }

  async remove(actor: OrgUser, id: string) {
    const d = await this.findDoc(actor.organizationId, id);
    if (d.approvedRevision !== null) throw new BadRequestException('الوثيقة سبق اعتمادها، فتُلغى ولا تُحذف حفاظًا على السجل');
    await this.db.getRepository(QmsProcessMap).update({ organizationId: actor.organizationId, documentId: d.id }, { documentId: null });
    await this.docs.remove(d);
  }

  /** مسار الاعتماد: مسودة ← مراجعة الجودة ← اعتماد، والإصدار الجديد والإلغاء */
  async act(actor: OrgUser, id: string, dto: DocActionDto) {
    const d = await this.findDoc(actor.organizationId, id);
    const need = (p: string) => {
      if (!this.can(actor, p)) throw new ForbiddenException('ليست لديك صلاحية هذا الإجراء');
    };
    const note = dto.note?.trim() || null;
    const t = today();
    switch (dto.action) {
      case 'submit':
        need(P.documents);
        if (d.status !== 'draft') throw new BadRequestException('الوثيقة ليست مسودة');
        if (!d.sections.some((s) => s.body)) throw new BadRequestException('اكتب محتوى الوثيقة قبل رفعها للمراجعة');
        d.status = 'review';
        break;
      case 'pass':
        need(P.reviewDocs);
        if (d.status !== 'review') throw new BadRequestException('الوثيقة ليست بانتظار مراجعة الجودة');
        d.status = 'approval';
        break;
      case 'return':
        if (d.status === 'review') need(P.reviewDocs);
        else if (d.status === 'approval') need(P.approveDocs);
        else throw new BadRequestException('لا يمكن إعادة الوثيقة في حالتها الحالية');
        if (!note) throw new BadRequestException('اكتب سبب الإعادة');
        d.status = 'draft';
        break;
      case 'approve': {
        need(P.approveDocs);
        if (d.status !== 'approval') throw new BadRequestException('الوثيقة لم تجتز مراجعة الجودة بعد');
        const s = await this.core.settings(actor.organizationId);
        const reviewer = [...d.history].reverse().find((h) => h.action === 'pass')?.byName ?? null;
        await this.db.transaction(async (em) => {
          await em.update(QmsDocumentRevision, { documentId: d.id, supersededAt: IsNull() }, { supersededAt: t });
          await em.save(em.create(QmsDocumentRevision, {
            organizationId: d.organizationId, documentId: d.id, revision: d.revision, title: d.title, sections: d.sections, changeSummary: d.changeSummary,
            reviewedByName: reviewer, approvedByName: actor.fullName, effectiveDate: t,
          }));
        });
        // سحب نسخ الإصدار السابق وإعادة إصدارها لنفس الجهات بالإصدار الجديد
        const holders = [...new Set(d.distribution.filter((c) => !c.withdrawnAt).map((c) => c.holder))];
        d.distribution = d.distribution.map((c) => (c.withdrawnAt ? c : { ...c, withdrawnAt: t }));
        d.distribution.push(...this.copies(d, holders, t));
        Object.assign(d, { status: 'approved', approvedRevision: d.revision, effectiveDate: t, nextReviewDate: addMonths(t, s.reviewMonths) });
        break;
      }
      case 'revise':
        need(P.documents);
        if (d.status !== 'approved') throw new BadRequestException('يبدأ الإصدار الجديد من وثيقة معتمدة');
        if (!note) throw new BadRequestException('اكتب ملخص التغيير المطلوب في الإصدار الجديد');
        Object.assign(d, { status: 'draft', revision: d.revision + 1, changeSummary: note });
        break;
      case 'obsolete':
        need(P.approveDocs);
        if (d.status === 'obsolete') throw new BadRequestException('الوثيقة ملغاة بالفعل');
        if (!note) throw new BadRequestException('اكتب سبب الإلغاء');
        await this.db.getRepository(QmsDocumentRevision).update({ documentId: d.id, supersededAt: IsNull() }, { supersededAt: t });
        d.distribution = d.distribution.map((c) => (c.withdrawnAt ? c : { ...c, withdrawnAt: t }));
        Object.assign(d, { status: 'obsolete', nextReviewDate: null });
        break;
    }
    d.history = [...d.history, step(actor, dto.action, note, d.revision)];
    await this.docs.save(d);
    return this.get(actor, d.id);
  }

  private copies(d: QmsDocument, holders: string[], at: string): DocCopy[] {
    let no = d.distribution.reduce((m, c) => Math.max(m, c.copyNo), 0);
    return holders.map((holder) => ({ copyNo: ++no, holder, revision: d.revision, issuedAt: at, acknowledgedAt: null, withdrawnAt: null }));
  }

  /** توزيع نسخ مضبوطة من الإصدار الساري على الجهات */
  async distribute(actor: OrgUser, id: string, dto: DistributeDto) {
    const d = await this.findDoc(actor.organizationId, id);
    if (d.status !== 'approved') throw new BadRequestException('لا تُوزَّع إلا الوثيقة المعتمدة السارية');
    const active = new Set(d.distribution.filter((c) => !c.withdrawnAt).map((c) => c.holder));
    const holders = [...new Set(dto.holders.map((h) => h.trim()).filter((h) => h && !active.has(h)))];
    if (!holders.length) throw new BadRequestException('اختر جهات لم تُسلَّم لها نسخة من هذا الإصدار');
    d.distribution = [...d.distribution, ...this.copies(d, holders, today())];
    d.history = [...d.history, step(actor, 'distribute', holders.join('، '), d.revision)];
    await this.docs.save(d);
    return this.get(actor, d.id);
  }

  async acknowledge(actor: OrgUser, id: string, copyNo: number) {
    const d = await this.findDoc(actor.organizationId, id);
    const c = d.distribution.find((x) => x.copyNo === copyNo);
    if (!c || c.withdrawnAt) throw new BadRequestException('النسخة غير موجودة أو مسحوبة');
    c.acknowledgedAt = today();
    d.distribution = [...d.distribution];
    d.history = [...d.history, step(actor, 'acknowledge', `${c.holder} (نسخة ${c.copyNo})`, d.revision)];
    await this.docs.save(d);
    return this.get(actor, d.id);
  }

  // ---------------- خرائط الإجراءات ----------------

  async maps(actor: OrgUser) {
    const rows = await this.db.getRepository(QmsProcessMap).find({ where: { organizationId: actor.organizationId }, order: { code: 'ASC' } });
    const docs = new Map((await this.docs.find({ where: { organizationId: actor.organizationId, id: In(rows.map((m) => m.documentId).filter(Boolean) as string[]) } })).map((d) => [d.id, d]));
    return rows.map((m) => {
      const d = m.documentId ? docs.get(m.documentId) : undefined;
      return {
        id: m.id, code: m.code, title: m.title, description: m.description, lanes: m.lanes, steps: m.steps.length, version: m.version, updatedByName: m.updatedByName, updatedAt: m.updatedAt,
        document: d ? { id: d.id, code: d.code, title: d.title, status: d.status, statusLabel: DOC_STATUS_LABELS[d.status], revisionLabel: rev(d.approvedRevision ?? d.revision) } : null,
      };
    });
  }

  async map(actor: OrgUser, id: string) {
    const m = await this.db.getRepository(QmsProcessMap).findOne({ where: { id, organizationId: actor.organizationId } });
    if (!m) throw new NotFoundException('الخريطة غير موجودة');
    const d = m.documentId ? await this.docs.findOne({ where: { id: m.documentId } }) : null;
    // أكواد الوثائق المذكورة في الخطوات مع روابطها
    const codes = [...new Set(m.steps.map((s) => s.docCode).filter(Boolean) as string[])];
    const all = codes.length ? (await this.list(actor, {})).rows.filter((r) => codes.includes(r.code)) : [];
    return {
      ...m,
      document: d ? { id: d.id, code: d.code, title: d.title, status: d.status, statusLabel: DOC_STATUS_LABELS[d.status], revisionLabel: rev(d.approvedRevision ?? d.revision) } : null,
      linkedDocs: all.map((r) => ({ code: r.code, title: r.title, path: r.path, statusLabel: r.statusLabel })),
    };
  }

  private validateMap(dto: ProcessMapDto) {
    if (!dto.lanes.length) throw new BadRequestException('أضف جهة مسؤولة واحدة على الأقل');
    const ids = new Set(dto.steps.map((s) => s.id));
    if (ids.size !== dto.steps.length) throw new BadRequestException('أرقام الخطوات مكررة');
    if (!dto.steps.some((s) => s.kind === 'start')) throw new BadRequestException('أضف خطوة «بداية» للخريطة');
    if (!dto.steps.some((s) => s.kind === 'end')) throw new BadRequestException('أضف خطوة «نهاية» للخريطة');
    for (const s of dto.steps) {
      if (s.lane >= dto.lanes.length) throw new BadRequestException(`الخطوة "${s.label}" على جهة غير موجودة`);
      for (const n of s.next ?? []) if (!ids.has(n.to)) throw new BadRequestException(`الخطوة "${s.label}" تتجه إلى خطوة غير موجودة`);
      if (s.kind === 'decision' && (s.next ?? []).length < 2) throw new BadRequestException(`القرار "${s.label}" يحتاج مسارين على الأقل (نعم / لا)`);
      if (s.kind !== 'end' && !(s.next ?? []).length) throw new BadRequestException(`الخطوة "${s.label}" لا تتجه إلى خطوة تالية`);
    }
    return dto.steps.map((s) => ({
      id: s.id, kind: s.kind, label: s.label, lane: s.lane, docCode: s.docCode?.toUpperCase() ?? null,
      next: (s.kind === 'end' ? [] : s.next).map((n) => ({ to: n.to, label: n.label?.toString().trim().slice(0, 40) || null })),
    }));
  }

  async saveMap(actor: OrgUser, dto: ProcessMapDto, id?: string) {
    const org = actor.organizationId;
    const repo = this.db.getRepository(QmsProcessMap);
    const steps = this.validateMap(dto);
    if (dto.documentId) await this.findDoc(org, dto.documentId);
    const lanes = dto.lanes.map((l) => l.trim());
    if (id) {
      const m = await repo.findOne({ where: { id, organizationId: org } });
      if (!m) throw new NotFoundException('الخريطة غير موجودة');
      const code = dto.code && dto.code.toUpperCase() !== m.code ? await this.core.ensureFreeCode(org, dto.code, { table: 'map', id: m.id }) : m.code;
      Object.assign(m, { code, title: dto.title, description: dto.description ?? null, documentId: dto.documentId ?? null, lanes, steps, version: m.version + 1, updatedByName: actor.fullName });
      await repo.save(m);
      return this.map(actor, m.id);
    }
    let code = dto.code ? await this.core.ensureFreeCode(org, dto.code) : null;
    if (!code) {
      const doc = dto.documentId ? await this.findDoc(org, dto.documentId) : null;
      code = doc ? await this.core.ensureFreeCode(org, `PM-${doc.code}`).catch(() => null) : null;
      code ??= await this.core.nextCode(org, 'PM', (await this.core.settings(org)).departments[0]?.code ?? 'QMS');
    }
    const m = await repo.save(repo.create({ organizationId: org, code, title: dto.title, description: dto.description ?? null, documentId: dto.documentId ?? null, lanes, steps, updatedByName: actor.fullName }));
    return this.map(actor, m.id);
  }

  async removeMap(actor: OrgUser, id: string) {
    const repo = this.db.getRepository(QmsProcessMap);
    const m = await repo.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!m) throw new NotFoundException('الخريطة غير موجودة');
    await repo.remove(m);
  }
}
