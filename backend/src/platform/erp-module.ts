/**
 * عقد الوحدة (Module manifest).
 *
 * كل وحدة في النظام (الأعضاء، التبرعات، المستفيدين، المحاسبة...) تعرّف نفسها
 * بملف manifest واحد من هذا النوع. المنصة تقرأ كل الـ manifests عند التشغيل
 * وتسجل الوحدات وصلاحياتها في قاعدة البيانات، فتظهر تلقائيًا في شاشة الصلاحيات
 * وفي قائمة التطبيقات عند المستخدم.
 */
export interface ErpPermission {
  /** كود فريد بالشكل: <module>.<resource>.<action> مثل donations.receipts.create */
  code: string;
  /** اسم عربي يظهر في شاشة الصلاحيات */
  name: string;
}

export interface ErpMenuItem {
  /** النص العربي في القائمة */
  label: string;
  /** المسار في الواجهة (Vue route path) */
  path: string;
  /** الصلاحية المطلوبة لعرض العنصر */
  permission: string;
  /** صلاحيات بديلة: يكفي أي واحدة منها مع permission */
  anyOf?: string[];
  /** مجموعة رئيسية في القائمة الجانبية تنفتح بسهم وتضم الشاشات الفرعية (اختياري) */
  group?: string;
}

export interface ErpModuleManifest {
  /** كود الوحدة: حروف إنجليزية صغيرة بدون مسافات، مثل donations */
  code: string;
  /** اسم الوحدة بالعربي */
  name: string;
  description?: string;
  /** اسم أيقونة تستخدمها الواجهة */
  icon?: string;
  version: string;
  /**
   * organization: وحدة تعمل داخل كل جمعية (الافتراضي) وصلاحياتها تظهر في أدوار الجمعية.
   * platform: وحدة إدارة المنصة نفسها، متاحة لمدير المنصة فقط.
   */
  scope?: 'organization' | 'platform';
  /**
   * true: وحدة أساسية مفعلة دائمًا لكل جمعية (مثل الإعدادات والصلاحيات).
   * false/غير محدد: وحدة اختيارية يفعّلها مدير المنصة لكل جمعية على حدة
   * (مثل الموقع الإلكتروني ومنصة التبرعات).
   */
  alwaysEnabled?: boolean;
  /** ترتيب الظهور في شاشة التطبيقات */
  sequence?: number;
  /** وحدات لازم تكون موجودة قبلها (مثل accounting تعتمد على core) */
  depends?: string[];
  permissions: ErpPermission[];
  menu: ErpMenuItem[];
  /**
   * صلاحية إعدادات الوحدة. من يملكها يدير صلاحيات هذه الوحدة في الأدوار
   * من داخل شاشة إعدادات الوحدة نفسها (بدون الحاجة لصلاحيات الأدوار العامة).
   */
  settingsPermission?: string;
}
