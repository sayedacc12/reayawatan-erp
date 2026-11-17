# بنية التقارير الموحدة (Report framework)

كل نظام في سنابل له تبويب «التقارير» بنفس الشكل والسلوك:
قائمة تقارير مصنفة، فلاتر، معاينة، وتصدير إلى **PDF** و**Excel** و**CSV** و**طباعة**.
النظام يعرّف تقاريره فقط (بيانات + أعمدة + فلاتر)، والمنصة تتولى العرض والتصدير والصلاحيات.

## الملفات

| الملف | الدور |
|---|---|
| `report.types.ts` | الأنواع: `ReportDefinition`، `ReportColumn`، `ReportFilter`، `ReportResult`، `ReportOutput` |
| `reports.registry.ts` | السجل المركزي: التسجيل، الصلاحيات، قراءة الفلاتر والتحقق منها، التشغيل وحساب الإجماليات |
| `reports.controller.ts` | الواجهات البرمجية `/api/reports/...` |
| `report-helpers.ts` | أدوات متكررة: `periodFilters`، `selectFilter`، `dynamicFilter`، `org`، `ar`، `refNo`، `r2`، `within` |
| `report-html.ts` | قالب HTML الموحد (للـ PDF والطباعة) مع خط عربي مضمّن |
| `report-pdf.service.ts` | تحويل HTML إلى PDF بمتصفح Chromium |
| `report-files.ts` | ملفات Excel (ورقة من اليمين لليسار) وCSV (UTF-8 مع BOM) |

## الواجهات البرمجية

| المسار | الوظيفة |
|---|---|
| `GET /api/reports/catalog/:module` | تقارير النظام المسموحة للمستخدم |
| `GET /api/reports/def/:code` | تعريف التقرير وفلاتره (مع خيارات القوائم) |
| `GET /api/reports/run/:code?<filters>` | تشغيل التقرير وإرجاع `ReportOutput` |
| `GET /api/reports/export/:code?format=pdf\|xlsx\|csv\|html&<filters>` | تنزيل الملف باسم عربي |

الأخطاء: 404 تقرير غير موجود، 403 بدون صلاحية، 400 فلتر غير صالح (تاريخ خاطئ، «من» بعد «إلى»، قيمة خارج القائمة، فلتر إلزامي فارغ)،
503 عند عدم توفر Chromium (الواجهة تعرض حينها الطباعة كبديل). الحد الأقصى 20,000 صف.

## إضافة تقارير لنظام جديد (3 خطوات)

### 1) ملف `<module>.reports.ts` في مجلد الوحدة

```ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ar, org, periodFilters, selectFilter } from '../../core/reports/report-helpers';
import { ReportDefinition } from '../../core/reports/report.types';
import { ReportsRegistry } from '../../core/reports/reports.registry';

const STATUS: Record<string, string> = { open: 'مفتوحة', closed: 'مغلقة' };

@Injectable()
export class QualityReports implements OnModuleInit {
  constructor(private readonly registry: ReportsRegistry, private readonly db: DataSource) {}

  onModuleInit() {
    const defs: ReportDefinition[] = [{
      code: 'quality.nonconformities',          // يبدأ دائمًا بكود الوحدة
      module: 'quality',
      category: 'عدم المطابقة',                   // مجموعة داخل التبويب
      title: 'سجل حالات عدم المطابقة',
      description: 'الحالات المسجلة في الفترة وحالتها',
      permission: 'quality.reports.read',        // أو قائمة يكفي أي منها
      filters: [...periodFilters(), selectFilter('status', 'الحالة', STATUS)],
      columns: [
        { key: 'no', label: 'الرقم' },
        { key: 'title', label: 'الوصف' },
        { key: 'status', label: 'الحالة' },
        { key: 'date', label: 'التاريخ', type: 'date' },
        { key: 'cost', label: 'التكلفة', type: 'money', total: true },
      ],
      link: '/quality/nonconformities/{id}',     // فتح الصف في الشاشة الأصلية
      run: async (u, f) => {
        const rows = await this.db.query(
          `SELECT id, no, title, status, created_at::date::text AS date, cost::float AS cost
             FROM quality_ncs WHERE organization_id = $1 AND created_at::date BETWEEN $2 AND $3
              AND ($4::text IS NULL OR status = $4) ORDER BY no`,
          [org(u).organizationId, f.from, f.to, f.status ?? null]);
        return rows.map((r: any) => ({ ...r, status: ar(STATUS, r.status) }));
      },
    }];
    for (const d of defs) this.registry.register(d);
  }
}
```

أضف الصنف إلى `providers` في وحدة النظام. `ReportsModule` عام (Global) فلا يحتاج استيرادًا.

### 2) الصلاحية وعنصر القائمة في الـ manifest

```ts
permissions: [..., { code: 'quality.reports.read', name: 'عرض تقارير الجودة وتصديرها' }],
menu: [..., { label: 'التقارير', path: '/quality/reports', permission: 'quality.reports.read' }],
```

### 3) مسار الواجهة (بدون أي شاشة جديدة)

```ts
{
  path: 'reports',
  component: () => import('../../components/reports/ReportsHub.vue'),
  props: { module: 'quality', system: 'إدارة الجودة' },
  meta: { permission: 'quality.reports.read' },
}
```

`ReportsHub` يدعم أيضًا `intro` (نص تعريفي) و`overview` (مكوّن لوحة مؤشرات يظهر كتبويب ثانٍ) و`overviewLabel`.
رابط مباشر لتقرير بفلاتر: `/quality/reports?r=quality.nonconformities&f_status=open`.

## تفاصيل مفيدة

- **قيمة الإرجاع**: مصفوفة صفوف، أو `ReportResult` فيه `rows` مع `columns` ديناميكية، و`summary` (بطاقات أرقام أعلى التقرير)،
  و`totals` جاهزة، و`subtitle`، و`notes`.
- **الإجماليات**: الأعمدة `total: true` تُجمع تلقائيًا، والصف الذي فيه `_skipTotal: true` لا يدخل في الجمع.
- **شكل الصفوف**: `_level` للمسافة البادئة (في `indentColumn` أو أول عمود)، و`_style`: `strong` أو `muted` أو `group`.
- **الأنواع**: `money` و`number` و`percent` أرقام حقيقية في Excel، و`date`/`datetime` تواريخ بتوقيت الرياض، و`bool` نعم/لا.
- **الفلاتر**: `date` و`month` (YYYY-MM) و`year` و`select` و`text`. القيم الافتراضية الرمزية:
  `yearStart`، `monthStart`، `today`، `currentMonth`، `currentYear`. خيارات القوائم من بيانات الجمعية عبر `loadOptions` أو `dynamicFilter`.
  الفلتران `from` و`to` يظهران معًا في الملف كسطر واحد «الفترة».
- **الصلاحيات**: `permission` (أي منها يكفي) و`permissionsAll` (كلها لازمة، مثل `hr.salaries.read` لتقارير الرواتب).
  `scope: 'platform'` لتقارير مدير المنصة وفريقه فقط، ولا تظهر لموظفي الجمعيات.
- **الانتقال**: `link` يفتح الصف في شاشته، و`drill` يفتح تقريرًا آخر بفلاتر من قيم الصف (مثل ميزان المراجعة ← كشف الحساب).
- **الاتجاه**: الجداول التي فيها أكثر من 7 أعمدة تُطبع أفقيًا تلقائيًا، أو حدد `orientation`.
- **عزل البيانات**: كل استعلام يجب أن يقيّد بـ `organization_id` للمستخدم (`org(u).organizationId`).
- **إعادة الاستخدام**: لا تكرر منطق الحساب؛ استدعِ الخدمة الموجودة في الوحدة كما في `fundraising.reports.ts` و`projects.reports.ts`.

## PDF على الخادم

يعتمد على Chromium (مثبت في صورة Docker للخادم). البحث عنه بالترتيب: متغير `CHROMIUM_PATH`،
ثم `/usr/bin/chromium-browser` و`/usr/bin/chromium`، ثم متصفح Playwright في بيئة التطوير.
الخط العربي (IBM Plex Sans Arabic) مضمّن داخل التقرير نفسه، فالنص يظهر متصلًا وقابلًا للنسخ.
متصفح واحد يعاد استخدامه، وملفان كحد أقصى في الوقت نفسه.

## الاختبار

`test/reports.e2e-spec.ts` يشغّل كل تقارير الأنظمة على الجمعية التجريبية، فأي تقرير جديد يُختبر تلقائيًا
(يكفي أن يعمل بقيم الفلاتر الافتراضية). أي تقرير جديد يحتاج بيانات تجريبية في `modules/demo/seed-*.ts`.
