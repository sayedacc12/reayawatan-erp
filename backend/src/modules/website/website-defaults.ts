import { AboutContent, GovernanceContent, HomeContent, ProgramStore, SeoContent, SiteAccounting, SitePayment, SiteSections, StoreConfig } from './entities/website.entity';

export const DEFAULT_SECTIONS: SiteSections = {
  about: true, programs: true, news: true, governance: true, partners: true, contact: true, store: true, volunteer: true, membership: true, portal: true, staff: true,
};

export const DEFAULT_HOME: HomeContent = {
  kicker: 'جمعية أهلية غير ربحية',
  title: 'معًا.. نصنع أثرًا يبقى',
  text: 'نعمل مع شركائنا ومتطوعينا لخدمة المستفيدين ببرامج موثوقة ونتائج قابلة للقياس.',
  imageId: null,
  primaryCta: { label: 'تبرّع الآن', target: 'donate' },
  secondaryCta: { label: 'تعرّف على برامجنا', target: 'programs' },
  stats: [],
  showTicker: true, showGoals: true, showValues: true,
  announcement: { on: false, text: '', link: '' },
};

export const DEFAULT_ABOUT: AboutContent = { story: '', imageId: null, showStructure: true };

export const DEFAULT_GOVERNANCE: GovernanceContent = {
  intro: 'نلتزم بأعلى معايير الحوكمة والشفافية والإفصاح، ونتيح لوائحنا وسياساتنا المعتمدة للجميع.',
  leaders: [], boardRows: [], assembly: 'الجمعية العمومية', committees: [], ceo: 'المدير التنفيذي', units: [],
  structureImageId: null, disclosures: [], showDocuments: true, showStructure: true, showBoard: true,
};

export const DEFAULT_SEO: SeoContent = { title: '', description: '', keywords: '' };

export const DEFAULT_STORE: StoreConfig = {
  enabled: true, general: true, generalTitle: 'تبرع عام غير مقيد', min: 10, max: 100000, presets: [50, 100, 200, 500],
  gift: true, monthly: true, receiptNote: '', thanks: 'جزاك الله خيرًا، وصل تبرعك وسيصرف في وجهه بإذن الله.',
};

export const DEFAULT_PAYMENT: SitePayment = { provider: 'sandbox', publishableKey: null, secretKey: null };
export const DEFAULT_ACCOUNTING: SiteAccounting = { generalRevenueAccountId: null, waqfRevenueAccountId: null, onlineCashAccountId: null };

export const DEFAULT_PROGRAM_STORE: ProgramStore = {
  on: false, kind: 'project', goal: 0, endDate: null, min: 0, max: 0, presets: [], stop: false, monthly: true, gift: true, revenueAccountId: null,
};

/** أيقونات البرامج والخدمات المتاحة في الموقع */
export const ICONS = [
  'heart', 'hands', 'users', 'home', 'book', 'grad', 'medal', 'shield', 'chart', 'handshake', 'eye', 'target', 'clip', 'phone', 'mail',
  'globe', 'pin', 'star', 'check', 'building', 'search', 'clock', 'megaphone', 'gift', 'food', 'water', 'health', 'bus', 'leaf', 'kaaba',
] as const;
