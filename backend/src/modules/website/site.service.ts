import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { KnowledgeService } from '../knowledge/knowledge.service';
import {
  AboutContent, GovernanceContent, HomeContent, MessageStatus, Partner, SITE_GATEWAYS, SiteAccounting, SitePayment, SiteSections, StoreConfig,
  WebMessage, WebNews, WebProgram, WebSettings,
} from './entities/website.entity';
import { ContactDto, MessageUpdateDto } from './website.dto';
import { DEFAULT_PROGRAM_STORE, DEFAULT_SECTIONS } from './website-defaults';
import { NEWS_STATUS, PROGRAM_STATUS, storeBlock } from './content.service';
import { StoreService, normPhone } from './store.service';
import { UUID, WebCore, randomToken, webToday } from './web-core.service';

export const SETTINGS_SECTIONS = ['general', 'store', 'payment', 'accounting'] as const;
export const PAGE_SECTIONS = ['home', 'about', 'governance', 'partners'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
export type PageSection = (typeof PAGE_SECTIONS)[number];
export const TOPICS: Record<string, string> = { inquiry: 'استفسار', suggestion: 'اقتراح', complaint: 'شكوى', partnership: 'شراكة وتعاون', other: 'أخرى' };
export const MESSAGE_STATUS: Record<MessageStatus, string> = { new: 'جديدة', in_progress: 'قيد المتابعة', closed: 'مغلقة' };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const bool = (v: unknown, d = false) => (typeof v === 'boolean' ? v : d);
const int = (v: unknown, lo: number, hi: number, d = 0) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};
const list = <T>(v: unknown, max: number, f: (x: Obj) => T | null) => (Array.isArray(v) ? v : []).slice(0, max).map((x) => f(obj(x))).filter((x): x is T => !!x);
const id = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v : null);
const link = (v: unknown) => {
  const s = str(v, 500);
  if (!s) return '';
  if (/^https:\/\/[^\s"'<>]+$/.test(s) || /^(donate|programs|news|about|governance|partners|contact|volunteer|membership|portal)(#[\w-]{1,40})?$/.test(s)) return s;
  throw new BadRequestException(`الرابط «${s.slice(0, 60)}» غير صالح: اكتب رابطًا يبدأ بـ https:// أو اختر صفحة من الموقع`);
};

/** إعدادات الموقع وصفحاته الثابتة، ورسائل الزوار، والبيانات العامة التي يعرضها الموقع */
@Injectable()
export class SiteService {
  constructor(private readonly db: DataSource, private readonly core: WebCore, private readonly store: StoreService, private readonly knowledge: KnowledgeService) {}

  // ---------------- الإعدادات ----------------

  private publicPayment(p: SitePayment) {
    const { secretKey, ...rest } = p;
    return { ...rest, hasSecretKey: !!secretKey };
  }

  async getSettings(actor: OrgUser) {
    const org = actor.organizationId;
    const s = await this.core.settings(org);
    const [accounts, cashAccounts] = await Promise.all([
      this.db.query(`SELECT id, code, name, nature FROM acc_accounts WHERE organization_id = $1 AND kind = 'sub' AND is_active ORDER BY code`, [org]),
      this.db.query(`SELECT id, name, kind FROM acc_cash_accounts WHERE organization_id = $1 AND is_active ORDER BY kind, name`, [org]),
    ]);
    return {
      published: s.published, sections: s.sections, seo: s.seo, footerText: s.footerText, customDomain: s.customDomain, previewKey: s.previewKey,
      store: s.store, payment: this.publicPayment(s.payment), accounting: s.accounting, slug: actor.organizationSlug, gateways: SITE_GATEWAYS,
      accounts, cashAccounts,
    };
  }

  private async assertAccount(org: string, accountId: string | null, label: string) {
    if (!accountId) return null;
    if (!UUID.test(accountId)) throw new BadRequestException(`${label}: الحساب غير موجود`);
    const [a] = await this.db.query('SELECT code, name, kind FROM acc_accounts WHERE id = $1 AND organization_id = $2', [accountId, org]);
    if (!a) throw new BadRequestException(`${label}: الحساب غير موجود في دليل الحسابات`);
    if (a.kind !== 'sub') throw new BadRequestException(`${label}: الحساب ${a.code} «${a.name}» ليس حسابًا فرعيًا`);
    return accountId;
  }

  private async assertCash(org: string, cashId: string | null) {
    if (!cashId) return null;
    const [c] = await this.db.query('SELECT id FROM acc_cash_accounts WHERE id = $1 AND organization_id = $2', [cashId, org]);
    if (!c) throw new BadRequestException('حساب تحصيل الدفع الإلكتروني غير موجود في البنوك والصناديق');
    return cashId;
  }

  async saveSettings(actor: OrgUser, section: SettingsSection, raw: Obj) {
    const org = actor.organizationId;
    const s = await this.core.settings(org);
    const repo = this.db.getRepository(WebSettings);
    if (section === 'general') {
      const sec = obj(raw.sections);
      const sections = Object.fromEntries(Object.keys(DEFAULT_SECTIONS).map((k) => [k, bool(sec[k], true)])) as unknown as SiteSections;
      const seo = obj(raw.seo);
      const domain = str(raw.customDomain, 200).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (domain && !/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain)) throw new BadRequestException('النطاق غير صحيح، مثل: www.example.org.sa');
      await repo.update({ organizationId: org }, {
        published: bool(raw.published), sections, seo: { title: str(seo.title, 120), description: str(seo.description, 300), keywords: str(seo.keywords, 300) },
        footerText: str(raw.footerText, 600) || null, customDomain: domain || null, ...(raw.newPreviewKey === true ? { previewKey: randomToken(10) } : {}),
      });
      await this.core.log(org, actor.fullName, bool(raw.published) !== s.published ? (bool(raw.published) ? 'نشر الموقع للزوار' : 'إيقاف نشر الموقع') : 'تعديل الإعدادات العامة للموقع');
    } else if (section === 'store') {
      const min = int(raw.min, 1, 1_000_000, 10);
      const max = int(raw.max, 1, 1_000_000, 100000);
      if (max < min) throw new BadRequestException('الحد الأعلى للتبرع أقل من الحد الأدنى');
      const presets = [...new Set((Array.isArray(raw.presets) ? raw.presets : []).map((v) => int(v, 0, 1_000_000)).filter((v) => v >= min && v <= max))].sort((a, b) => a - b).slice(0, 6);
      const store: StoreConfig = {
        enabled: bool(raw.enabled), general: bool(raw.general), generalTitle: str(raw.generalTitle, 120) || 'تبرع عام غير مقيد', min, max, presets,
        gift: bool(raw.gift), monthly: bool(raw.monthly), receiptNote: str(raw.receiptNote, 500), thanks: str(raw.thanks, 500),
      };
      await repo.update({ organizationId: org }, { store });
      await this.core.log(org, actor.fullName, 'تعديل إعدادات المتجر');
    } else if (section === 'payment') {
      const provider = SITE_GATEWAYS.includes(raw.provider as never) ? (raw.provider as SitePayment['provider']) : 'sandbox';
      const secret = str(raw.secretKey, 200);
      if (secret && !/^sk_(test|live)_[A-Za-z0-9]+$/.test(secret)) throw new BadRequestException('المفتاح السري لميسر يبدأ بـ sk_test_ أو sk_live_');
      const pub = str(raw.publishableKey, 200);
      if (pub && !/^pk_(test|live)_[A-Za-z0-9]+$/.test(pub)) throw new BadRequestException('المفتاح العام لميسر يبدأ بـ pk_test_ أو pk_live_');
      const secretKey = raw.clearSecret === true ? null : secret || s.payment.secretKey;
      if (provider === 'moyasar' && !secretKey) throw new BadRequestException('اكتب المفتاح السري لحساب ميسر');
      await repo.update({ organizationId: org }, { payment: { provider, publishableKey: pub || null, secretKey } });
      await this.core.log(org, actor.fullName, 'تعديل بوابة الدفع', provider === 'sandbox' ? 'البيئة التجريبية' : 'ميسر');
    } else {
      const accounting: SiteAccounting = {
        generalRevenueAccountId: await this.assertAccount(org, id(raw.generalRevenueAccountId), 'حساب إيراد التبرعات'),
        waqfRevenueAccountId: await this.assertAccount(org, id(raw.waqfRevenueAccountId), 'حساب إيراد التبرعات الوقفية'),
        onlineCashAccountId: await this.assertCash(org, id(raw.onlineCashAccountId)),
      };
      await repo.update({ organizationId: org }, { accounting });
      await this.core.log(org, actor.fullName, 'تعديل الربط المالي للمتجر');
    }
    return this.getSettings(actor);
  }

  // ---------------- صفحات الموقع ----------------

  async getPages(actor: OrgUser) {
    const s = await this.core.settings(actor.organizationId);
    const slug = actor.organizationSlug ?? '';
    const url = (i: string | null) => this.core.mediaUrl(slug, i);
    return {
      home: { ...s.home, imageUrl: url(s.home.imageId) },
      about: { ...s.about, imageUrl: url(s.about.imageId) },
      governance: { ...s.governance, structureImageUrl: url(s.governance.structureImageId), leaders: s.governance.leaders.map((l) => ({ ...l, photoUrl: url(l.photoId) })) },
      partners: s.partners.map((p) => ({ ...p, logoUrl: url(p.logoId) })),
      documents: await this.db.query(`SELECT id, code, title FROM kn_documents WHERE organization_id = $1 AND status = 'published' AND visibility = 'public' ORDER BY title`, [actor.organizationId]),
      slug, published: s.published, previewKey: s.previewKey,
    };
  }

  async savePage(actor: OrgUser, section: PageSection, raw: Obj) {
    const org = actor.organizationId;
    const media = (v: unknown) => this.core.assertMedia(org, id(v));
    const repo = this.db.getRepository(WebSettings);
    if (section === 'home') {
      const cta = (v: unknown) => ({ label: str(obj(v).label, 40), target: link(obj(v).target) });
      const ann = obj(raw.announcement);
      const home: HomeContent = {
        kicker: str(raw.kicker, 80), title: str(raw.title, 160), text: str(raw.text, 600), imageId: await media(raw.imageId),
        primaryCta: cta(raw.primaryCta), secondaryCta: cta(raw.secondaryCta),
        stats: list(raw.stats, 6, (x) => (str(x.value, 20) && str(x.label, 60) ? { value: str(x.value, 20), label: str(x.label, 60) } : null)),
        showTicker: bool(raw.showTicker, true), showGoals: bool(raw.showGoals, true), showValues: bool(raw.showValues, true),
        announcement: { on: bool(ann.on), text: str(ann.text, 200), link: link(ann.link) },
      };
      if (!home.title) throw new BadRequestException('اكتب العنوان الرئيسي للصفحة الرئيسية');
      await repo.update({ organizationId: org }, { home });
    } else if (section === 'about') {
      const about: AboutContent = { story: str(raw.story, 8000), imageId: await media(raw.imageId), showStructure: bool(raw.showStructure, true) };
      await repo.update({ organizationId: org }, { about });
    } else if (section === 'governance') {
      const docIds = new Set((await this.db.query(`SELECT id FROM kn_documents WHERE organization_id = $1 AND status = 'published' AND visibility = 'public'`, [org])).map((r: { id: string }) => r.id));
      const leaders = [];
      for (const l of list(raw.leaders, 16, (x) => (str(x.name, 120) ? x : null))) leaders.push({ name: str(l.name, 120), role: str(l.role, 120), photoId: await media(l.photoId) });
      const governance: GovernanceContent = {
        intro: str(raw.intro, 1500), leaders,
        boardRows: list(raw.boardRows, 30, (x) => (str(x.k, 120) ? { k: str(x.k, 120), v: str(x.v, 600) } : null)),
        assembly: str(raw.assembly, 120), committees: list(raw.committees, 12, (x) => (str(x.name, 120) ? str(x.name, 120) : null)) as string[],
        ceo: str(raw.ceo, 120), units: list(raw.units, 30, (x) => (str(x.name, 120) ? str(x.name, 120) : null)) as string[],
        structureImageId: await media(raw.structureImageId),
        disclosures: list(raw.disclosures, 24, (x) => (str(x.title, 160) ? { title: str(x.title, 160), text: str(x.text, 800), status: str(x.status, 60), docId: docIds.has(String(x.docId)) ? String(x.docId) : null } : null)),
        showDocuments: bool(raw.showDocuments, true), showStructure: bool(raw.showStructure, true), showBoard: bool(raw.showBoard, true),
      };
      await repo.update({ organizationId: org }, { governance });
    } else {
      const partners: Partner[] = [];
      for (const p of list(raw.partners, 60, (x) => (str(x.name, 160) ? x : null))) {
        partners.push({ name: str(p.name, 160), url: link(p.url), kind: str(p.kind, 60), logoId: await media(p.logoId) });
      }
      await repo.update({ organizationId: org }, { partners });
    }
    const LABEL: Record<PageSection, string> = { home: 'الصفحة الرئيسية', about: 'صفحة من نحن', governance: 'صفحة الحوكمة والشفافية', partners: 'صفحة الشركاء' };
    await this.core.log(org, actor.fullName, `تعديل ${LABEL[section]}`);
    return this.getPages(actor);
  }

  // ---------------- لوحة الموقع ----------------

  async dashboard(actor: OrgUser) {
    const org = actor.organizationId;
    await this.store.processDue(org);
    const s = await this.core.settings(org);
    const [news] = await this.db.query(`SELECT count(*) FILTER (WHERE status = 'published')::int AS published, count(*) FILTER (WHERE status = 'pending')::int AS pending, COALESCE(sum(views), 0)::int AS views FROM web_news WHERE organization_id = $1`, [org]);
    const [programs] = await this.db.query(`SELECT count(*) FILTER (WHERE status = 'approved')::int AS approved, count(*) FILTER (WHERE status = 'pending')::int AS pending, count(*) FILTER (WHERE status = 'approved' AND (store->>'on')::boolean)::int AS in_store FROM web_programs WHERE organization_id = $1`, [org]);
    const [money] = await this.db.query(
      `SELECT COALESCE(sum(amount) FILTER (WHERE status = 'paid'), 0)::float AS total, count(*) FILTER (WHERE status = 'paid')::int AS count,
              COALESCE(sum(amount) FILTER (WHERE status = 'paid' AND (paid_at AT TIME ZONE 'Asia/Riyadh')::date = $2::date), 0)::float AS today,
              COALESCE(sum(amount) FILTER (WHERE status = 'paid' AND date_trunc('month', paid_at AT TIME ZONE 'Asia/Riyadh') = date_trunc('month', $2::date)), 0)::float AS month,
              count(*) FILTER (WHERE status = 'paid' AND voucher_id IS NULL)::int AS voucher_errors
         FROM web_donations WHERE organization_id = $1`, [org, webToday()]);
    const [subs] = await this.db.query(`SELECT count(*) FILTER (WHERE status = 'active')::int AS active, COALESCE(sum(amount) FILTER (WHERE status = 'active'), 0)::float AS monthly FROM web_subscriptions WHERE organization_id = $1`, [org]);
    const [msgs] = await this.db.query(`SELECT count(*) FILTER (WHERE status = 'new')::int AS new, count(*) FILTER (WHERE status = 'in_progress')::int AS open FROM web_messages WHERE organization_id = $1`, [org]);
    const daily = await this.db.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day, COALESCE(sum(w.amount), 0)::float AS amount, count(w.id)::int AS count
         FROM generate_series($2::date - 29, $2::date, interval '1 day') d
         LEFT JOIN web_donations w ON w.organization_id = $1 AND w.status = 'paid' AND (w.paid_at AT TIME ZONE 'Asia/Riyadh')::date = d::date
        GROUP BY d ORDER BY d`, [org, webToday()]);
    const top = await this.db.getRepository(WebProgram).find({ where: { organizationId: org, status: 'approved' }, order: { raised: 'DESC' }, take: 6 });
    const recent = await this.db.query(`SELECT id, receipt_no, program_name, amount::float, donor_name, paid_at, monthly, gift IS NOT NULL AS gift FROM web_donations WHERE organization_id = $1 AND status = 'paid' ORDER BY paid_at DESC LIMIT 8`, [org]);
    const pendingNews = await this.db.getRepository(WebNews).find({ where: { organizationId: org, status: 'pending' }, order: { createdAt: 'ASC' }, take: 5 });
    const pendingPrograms = await this.db.getRepository(WebProgram).find({ where: { organizationId: org, status: 'pending' }, order: { createdAt: 'ASC' }, take: 5 });
    return {
      published: s.published, slug: actor.organizationSlug, previewKey: s.previewKey, storeEnabled: s.store.enabled && s.sections.store, provider: s.payment.provider,
      news, programs, money, subs, messages: msgs, daily,
      top: top.map((p) => ({ id: p.id, name: p.name, raised: p.raised, goal: p.store?.goal ?? 0, count: p.donationsCount, onStore: !!p.store?.on, progress: p.store?.goal ? Math.min(100, Math.round((p.raised / p.store.goal) * 100)) : null })),
      recent: recent.map((r: Record<string, unknown>) => ({ ...r, receiptNo: r.receipt_no ? `W-${String(r.receipt_no).padStart(6, '0')}` : null })),
      awaiting: [
        ...pendingNews.map((n) => ({ kind: 'news', id: n.id, title: n.title, by: n.createdByName, at: n.createdAt, label: NEWS_STATUS[n.status] })),
        ...pendingPrograms.map((p) => ({ kind: 'program', id: p.id, title: p.name, by: p.createdByName, at: p.createdAt, label: PROGRAM_STATUS[p.status] })),
      ],
    };
  }

  // ---------------- رسائل الزوار ----------------

  async messages(actor: OrgUser, status?: string) {
    const where: Record<string, unknown> = { organizationId: actor.organizationId };
    if (status && status in MESSAGE_STATUS) where.status = status;
    const rows = await this.db.getRepository(WebMessage).find({ where, order: { createdAt: 'DESC' }, take: 1000 });
    return rows.map((m) => ({ ...m, topicLabel: TOPICS[m.topic] ?? m.topic, statusLabel: MESSAGE_STATUS[m.status] }));
  }

  async updateMessage(actor: OrgUser, mid: string, dto: MessageUpdateDto) {
    if (!UUID.test(mid)) throw new NotFoundException('الرسالة غير موجودة');
    const m = await this.db.getRepository(WebMessage).findOne({ where: { id: mid, organizationId: actor.organizationId } });
    if (!m) throw new NotFoundException('الرسالة غير موجودة');
    if (dto.status === 'closed' && !(dto.replyNote ?? m.replyNote)?.trim()) throw new BadRequestException('اكتب ما تم مع الرسالة قبل إغلاقها');
    await this.db.getRepository(WebMessage).update({ id: mid }, { status: dto.status as MessageStatus, replyNote: dto.replyNote?.trim() || m.replyNote, handledByName: actor.fullName });
    await this.core.log(actor.organizationId, actor.fullName, `رسالة زائر: ${MESSAGE_STATUS[dto.status as MessageStatus]}`, `${m.name} - ${TOPICS[m.topic]}`);
    return (await this.messages(actor)).find((x) => x.id === mid);
  }

  // ---------------- البيانات العامة للموقع ----------------

  /** الموقع منشور، أو معاينة بمفتاح المعاينة */
  private async site(slug: string, preview?: string) {
    const org = await this.core.identity.organization(slug);
    const s = await this.core.settings(org.id);
    if (!s.published && !(preview && s.previewKey && preview === s.previewKey)) throw new NotFoundException('موقع الجمعية غير منشور حاليًا');
    return { org, s };
  }

  private publicProgram(p: WebProgram, slug: string, s: WebSettings) {
    const st = { ...DEFAULT_PROGRAM_STORE, ...p.store };
    const block = s.store.enabled && s.sections.store ? storeBlock({ ...p, store: st }) : 'التبرع متوقف حاليًا';
    const b = this.store.bounds(s, p);
    return {
      id: p.id, slug: p.slug, name: p.name, tagline: p.tagline, summary: p.summary, icon: p.icon, imageUrl: this.core.mediaUrl(slug, p.imageId), featured: p.featured,
      donate: st.on ? { open: !block, block: block || null, kind: st.kind, goal: st.goal, raised: p.raised, count: p.donationsCount, endDate: st.endDate, ...b } : null,
    };
  }

  async publicSite(slug: string, preview?: string) {
    const { org, s } = await this.site(slug, preview);
    const identity = await this.core.identity.publicView(slug);
    const url = (i: string | null) => this.core.mediaUrl(org.slug, i);
    const programs = await this.db.getRepository(WebProgram).find({ where: { organizationId: org.id, status: 'approved', showOnSite: true }, order: { sortOrder: 'ASC' } });
    const news = s.sections.news ? await this.db.getRepository(WebNews).find({ where: { organizationId: org.id, status: 'published' }, order: { newsDate: 'DESC', createdAt: 'DESC' }, take: 12 }) : [];
    const totals = await this.store.totals(org.id);
    return {
      identity, published: s.published, sections: s.sections, seo: s.seo, footerText: s.footerText,
      home: { ...s.home, imageUrl: url(s.home.imageId), imageId: undefined },
      about: { story: s.about.story, imageUrl: url(s.about.imageId), showStructure: s.about.showStructure },
      partners: s.sections.partners ? s.partners.map((p) => ({ name: p.name, url: p.url, kind: p.kind, logoUrl: url(p.logoId) })) : [],
      programs: s.sections.programs ? programs.map((p) => this.publicProgram(p, org.slug, s)) : [],
      news: news.map((n) => ({ id: n.id, title: n.title, summary: n.summary, date: n.newsDate, ticker: n.ticker, imageUrl: url(n.imageId) })),
      store: {
        enabled: s.store.enabled && s.sections.store, general: s.store.general, generalTitle: s.store.generalTitle, provider: s.payment.provider,
        ...this.store.bounds(s, null), totals,
      },
      links: { volunteer: `/v/${org.slug}`, membership: `/m/${org.slug}`, portal: `/portal/${org.slug}`, login: `/o/${org.slug}` },
    };
  }

  async publicGovernance(slug: string, preview?: string) {
    const { org, s } = await this.site(slug, preview);
    const url = (i: string | null) => this.core.mediaUrl(org.slug, i);
    const g = s.governance;
    return {
      intro: g.intro, showBoard: g.showBoard, showStructure: g.showStructure, showDocuments: g.showDocuments,
      leaders: g.leaders.map((l) => ({ name: l.name, role: l.role, photoUrl: url(l.photoId) })), boardRows: g.boardRows,
      structure: { assembly: g.assembly, committees: g.committees, ceo: g.ceo, units: g.units, imageUrl: url(g.structureImageId) },
      disclosures: g.disclosures,
      documents: g.showDocuments ? await this.knowledge.publicDocuments(org.id) : [],
    };
  }

  async publicNews(slug: string, page = 1, preview?: string) {
    const { org } = await this.site(slug, preview);
    const size = 12;
    const p = Math.max(1, Math.min(500, Math.floor(page) || 1));
    const [rows, total] = await this.db.getRepository(WebNews).findAndCount({
      where: { organizationId: org.id, status: 'published' }, order: { newsDate: 'DESC', createdAt: 'DESC' }, skip: (p - 1) * size, take: size,
    });
    return { page: p, pages: Math.max(1, Math.ceil(total / size)), total, items: rows.map((n) => ({ id: n.id, title: n.title, summary: n.summary, date: n.newsDate, imageUrl: this.core.mediaUrl(org.slug, n.imageId) })) };
  }

  async publicNewsItem(slug: string, nid: string, preview?: string) {
    const { org } = await this.site(slug, preview);
    if (!UUID.test(nid)) throw new NotFoundException('الخبر غير موجود');
    const n = await this.db.getRepository(WebNews).findOne({ where: { id: nid, organizationId: org.id, status: 'published' } });
    if (!n) throw new NotFoundException('الخبر غير موجود');
    await this.db.query('UPDATE web_news SET views = views + 1 WHERE id = $1', [nid]);
    return { id: n.id, title: n.title, summary: n.summary, body: n.body, date: n.newsDate, imageUrl: this.core.mediaUrl(org.slug, n.imageId) };
  }

  async publicProgramPage(slug: string, pslug: string, preview?: string) {
    const { org, s } = await this.site(slug, preview);
    const p = await this.db.getRepository(WebProgram).findOne({ where: { organizationId: org.id, slug: String(pslug).toLowerCase(), status: 'approved', showOnSite: true } });
    if (!p) throw new NotFoundException('البرنامج غير موجود');
    const [kit] = p.kitDocId ? await this.db.query(`SELECT id, title FROM kn_documents WHERE id = $1 AND status = 'published' AND visibility = 'public'`, [p.kitDocId]) : [];
    return { ...this.publicProgram(p, org.slug, s), about: p.about, audience: p.audience, timing: p.timing, services: p.services, points: p.points, kit: kit ?? null };
  }

  async search(slug: string, q: string, preview?: string) {
    const { org, s } = await this.site(slug, preview);
    const term = String(q ?? '').trim().replace(/[%_]/g, '').slice(0, 80);
    if (term.length < 2) return { news: [], programs: [], documents: [] };
    const like = `%${term}%`;
    const [news, programs, documents] = await Promise.all([
      s.sections.news ? this.db.query(`SELECT id, title, summary, news_date::text AS date FROM web_news WHERE organization_id = $1 AND status = 'published' AND (title ILIKE $2 OR summary ILIKE $2 OR body ILIKE $2) ORDER BY news_date DESC LIMIT 20`, [org.id, like]) : [],
      s.sections.programs ? this.db.query(`SELECT slug, name, summary FROM web_programs WHERE organization_id = $1 AND status = 'approved' AND show_on_site AND (name ILIKE $2 OR summary ILIKE $2 OR COALESCE(about, '') ILIKE $2) ORDER BY sort_order LIMIT 20`, [org.id, like]) : [],
      s.sections.governance ? this.db.query(`SELECT id, code, title, summary FROM kn_documents WHERE organization_id = $1 AND status = 'published' AND visibility = 'public' AND (title ILIKE $2 OR COALESCE(code, '') ILIKE $2 OR COALESCE(summary, '') ILIKE $2 OR tags::text ILIKE $2) ORDER BY title LIMIT 20`, [org.id, like]) : [],
    ]);
    return { news, programs, documents };
  }

  async contact(slug: string, dto: ContactDto) {
    const { org, s } = await this.site(slug);
    if (!s.sections.contact) throw new BadRequestException('استقبال الرسائل متوقف حاليًا');
    const phone = dto.phone ? normPhone(dto.phone) : '';
    if (dto.phone && !phone) throw new BadRequestException('رقم الجوال غير صحيح');
    if (!phone && !dto.email) throw new BadRequestException('اكتب رقم الجوال أو البريد الإلكتروني لنتواصل معك');
    const [{ n }] = await this.db.query(`SELECT count(*)::int AS n FROM web_messages WHERE organization_id = $1 AND created_at > now() - interval '1 day' AND (phone = $2 OR email = $3)`, [org.id, phone || '-', dto.email ?? '-']);
    if (n >= 5) throw new BadRequestException('وصلتنا رسائلك، وسنتواصل معك قريبًا بإذن الله');
    await this.db.getRepository(WebMessage).insert({ organizationId: org.id, name: dto.name, phone: phone || null, email: dto.email ?? null, topic: dto.topic, body: dto.body });
    return { ok: true };
  }

  async publicDocument(slug: string, did: string, preview?: string) {
    const { org } = await this.site(slug, preview);
    return this.knowledge.publicDocument(org.id, did);
  }

  async publicDocumentFile(slug: string, did: string, preview?: string) {
    const { org } = await this.site(slug, preview);
    return this.knowledge.publicFile(org.id, did);
  }

  async media(slug: string, mid: string) {
    const org = await this.core.identity.organization(slug);
    return this.core.mediaFile(org.id, mid);
  }
}
