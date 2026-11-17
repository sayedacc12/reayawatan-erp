# وحدات النظام (Business modules)

كل وحدة عمل (الأعضاء، التبرعات، المستفيدين، المحاسبة...) تعيش في مجلد خاص هنا:

```
src/modules/donations/
  donations.manifest.ts   # الاسم، الصلاحيات، عناصر القائمة
  donations.module.ts     # Nest module
  entities/               # جداول الوحدة (في نفس قاعدة البيانات)
  ...controllers / services
```

خطوات إضافة وحدة:
1. اكتب الـ manifest (انظر `src/platform/erp-module.ts`)، وكل صلاحية تبدأ بكود الوحدة: `donations.receipts.create`.
2. أضف الـ manifest إلى `INSTALLED_MODULES` في `src/platform/module-registry.ts`.
3. أضف الـ Nest module إلى `imports` في `src/app.module.ts`.
4. اعمل migration: `npm run migration:generate -- src/migrations/AddDonations`.
5. احمِ كل endpoint بـ `@RequirePermissions('donations....')`.
6. أي جدول بيانات يحمل عمود `organization_id`.

عند التشغيل التالي تظهر الوحدة وصلاحياتها تلقائيًا في شاشة الصلاحيات.

قواعد التكامل بين الوحدات: وحدة تستخدم وحدة أخرى عبر الـ service المُصدَّر منها
(وليس بالكتابة مباشرة في جداولها)، وتذكرها في `depends`.

## التقارير

كل وحدة لها تبويب «التقارير» موحد. عرّف تقارير الوحدة في `<module>.reports.ts` وسجلها في `ReportsRegistry`،
وأضف صلاحية `<module>.reports.read` ومسارًا يستخدم `ReportsHub.vue`. التصدير إلى PDF وExcel وCSV والطباعة جاهز.
الشرح والمثال الكامل في [`src/core/reports/README.md`](../core/reports/README.md).
