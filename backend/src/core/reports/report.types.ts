import { AuthUser } from '../auth/decorators';

/**
 * بنية التقارير المشتركة (Report framework).
 *
 * كل نظام يعرّف تقاريره كقائمة ReportDefinition ويسجلها في ReportsRegistry،
 * والمنصة تتولى الباقي: قائمة التقارير في تبويب «التقارير»، الفلاتر، المعاينة،
 * والتصدير إلى PDF وExcel وCSV والطباعة بنفس الشكل في كل الأنظمة.
 * الشرح الكامل وأمثلة الاستخدام في README.md بجانب هذا الملف.
 */

/** نوع العمود يحدد طريقة عرضه وتصديره (المبالغ أرقام حقيقية في Excel) */
export type ReportColumnType = 'text' | 'number' | 'money' | 'percent' | 'date' | 'datetime' | 'bool';

export interface ReportColumn {
  key: string;
  label: string;
  type?: ReportColumnType;
  /** يُجمع في سطر الإجمالي أسفل الجدول */
  total?: boolean;
  /** عرض تقريبي بالحروف (لـ Excel والطباعة) */
  width?: number;
}

export type ReportFilterType = 'date' | 'month' | 'year' | 'select' | 'text';

export interface ReportOption {
  value: string;
  label: string;
}

/** قيم افتراضية رمزية تُحسب وقت التشغيل بتوقيت الرياض */
export type ReportDefault = 'yearStart' | 'monthStart' | 'today' | 'currentMonth' | 'currentYear';

export interface ReportFilter {
  key: string;
  label: string;
  type: ReportFilterType;
  required?: boolean;
  /** قيمة ثابتة أو رمزية (مثل today) */
  default?: string | ReportDefault;
  /** خيارات ثابتة للقائمة */
  options?: ReportOption[];
  /** خيارات تُحمّل من بيانات الشركة (مثل الحسابات أو المشاريع) */
  loadOptions?: (user: AuthUser) => Promise<ReportOption[]>;
  /** نص الخيار الفارغ في القائمة (مثل «الكل») */
  placeholder?: string;
}

export type ReportRow = Record<string, unknown> & {
  /** مستوى المسافة البادئة للصف (مثل مستويات شجرة الحسابات) */
  _level?: number;
  /** شكل الصف: strong عريض (إجمالي فرعي)، muted باهت، group عنوان مجموعة */
  _style?: 'strong' | 'muted' | 'group';
  /** لا يدخل الصف في سطر الإجمالي */
  _skipTotal?: boolean;
};

export interface ReportSummaryItem {
  label: string;
  value: number | string | null;
  type?: ReportColumnType;
}

/** ما تُرجعه دالة التقرير: صفوف فقط، أو صفوف مع أعمدة ديناميكية وملخص */
export interface ReportResult {
  rows: ReportRow[];
  /** أعمدة تحسب وقت التشغيل (تستبدل أعمدة التعريف) */
  columns?: ReportColumn[];
  /** بطاقات أرقام تظهر أعلى التقرير (مثل الرصيد الافتتاحي والختامي) */
  summary?: ReportSummaryItem[];
  /** إجماليات جاهزة بدل الجمع التلقائي للأعمدة total */
  totals?: Record<string, number>;
  /** سطر وصفي إضافي تحت العنوان (مثل اسم الحساب في كشف الحساب) */
  subtitle?: string;
  /** ملاحظات تظهر أسفل التقرير */
  notes?: string[];
}

export type ReportFilters = Record<string, string | undefined>;

export interface ReportDefinition {
  /** كود فريد: <module>.<name> مثل fundraising.donors */
  code: string;
  /** النظام الذي يظهر التقرير في تبويب تقاريره (fundraising، hr، platform...) */
  module: string;
  title: string;
  description: string;
  /** مجموعة داخل تبويب التقارير (مثل «الموظفون» أو «الرواتب») */
  category?: string;
  /** صلاحية واحدة، أو قائمة يكفي أي منها */
  permission: string | string[];
  /** صلاحيات إضافية لازمة كلها (مثل صلاحية عرض الرواتب لتقارير المسير) */
  permissionsAll?: string[];
  /** organization (الافتراضي): داخل جمعية. platform: لمدير المنصة وفريقه */
  scope?: 'organization' | 'platform';
  filters?: ReportFilter[];
  columns: ReportColumn[];
  /** اتجاه صفحة PDF؛ الجداول العريضة أفقية تلقائيًا */
  orientation?: 'portrait' | 'landscape';
  /** العمود الذي تظهر فيه المسافة البادئة لمستويات الصفوف (الافتراضي أول عمود) */
  indentColumn?: string;
  /** رابط الصف في الواجهة، بقيم من الصف: /fundraising/donors/{id} */
  link?: string;
  /** فتح تقرير آخر من الصف بفلاتر من قيم الصف: { report: 'accounting.ledger', filters: { accountId: '{id}' } } */
  drill?: { report: string; filters: Record<string, string> };
  run: (user: AuthUser, filters: ReportFilters) => Promise<ReportRow[] | ReportResult>;
}

/** الشكل الموحد بعد التشغيل، وهو ما تعرضه الواجهة وتبني عليه ملفات التصدير */
export interface ReportOutput {
  code: string;
  title: string;
  description: string;
  subtitle: string | null;
  organizationName: string | null;
  generatedAt: string;
  generatedBy: string;
  /** وصف الفلاتر المطبقة بالعربي: [{ label: 'الفترة', value: '...' }] */
  appliedFilters: { label: string; value: string }[];
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: Record<string, number> | null;
  summary: ReportSummaryItem[];
  notes: string[];
  orientation: 'portrait' | 'landscape';
  indentColumn: string | null;
}
