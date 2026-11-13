# سنابل · Sanabel ERP

**منصة إدارة الجمعيات الخيرية**

منصة SaaS لإدارة الجمعيات الخيرية: نظام واحد بوحدات مستقلة تتكامل على قاعدة بيانات واحدة
(على فكرة Odoo)، بواجهة عربية بالكامل.

![شاشة الدخول](docs/screenshots/1-login.png)

## المعمارية

- **Modular monolith**: خادم واحد (NestJS) وقاعدة PostgreSQL واحدة، وكل وحدة عمل
  (الأعضاء، التبرعات، المستفيدين، المحاسبة...) مجلد مستقل يعرّف نفسه بملف manifest
  (الاسم، الصلاحيات، القائمة). انظر `backend/src/modules/README.md`.
- **تعدد الجمعيات (Multi-tenant)**: كل جمعية `organization` منفصلة، وكل جدول بيانات يحمل
  `organization_id`، وكل استعلام مقيد بجمعية المستخدم.
- **مستويان للإدارة**:
  - *مدير المنصة*: يضيف الجمعيات ويوقفها ويفعّل الخدمات الإضافية لكل جمعية، ولا يرى بياناتها.
  - *مدير نظام الجمعية*: له كل الصلاحيات داخل جمعيته، ويدير مستخدميها وأدوارها.
- **الصلاحيات**: كل وحدة تعلن صلاحياتها (`donations.receipts.create`)، والأدوار تجمع صلاحيات،
  والمستخدم يأخذ أدوارًا. لا يمكن لمستخدم منح صلاحية لا يملكها. السحب أو الإيقاف يسري فورًا.
- **وحدات اختيارية لكل جمعية**: وحدة بدون `alwaysEnabled` تظهر فقط للجمعيات المفعلة لها
  (مثلًا الموقع ومنصة التبرعات مستقبلًا).

## التشغيل بـ Docker

```bash
cp .env.example .env        # غيّر JWT_SECRET وكلمات المرور
docker compose up -d --build
# افتح http://localhost:8080 وادخل بحساب مدير المنصة من .env
```

## التشغيل على سيرفر (إنتاج)

أمر واحد بيشغّل النظام مع HTTPS تلقائي. التفاصيل في [deploy/README.md](deploy/README.md).

## التطوير

```bash
# قاعدة البيانات: PostgreSQL 13+ (أو: docker compose up -d db)
cd backend && cp .env.example .env && npm install && npm run start:dev   # http://localhost:3000/api
cd frontend && npm install && npm run dev                                 # http://localhost:5173
```

الاختبارات (تحتاج قاعدة اختبار فارغة `charity_erp_test`):

```bash
cd backend && npm test
```

إضافة جدول أو تعديله: عدّل الـ entity ثم `npm run migration:generate -- src/migrations/<Name>`.
الـ migrations تعمل تلقائيًا عند تشغيل الخادم.
