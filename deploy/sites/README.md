# مواقع إضافية على نفس السيرفر

يسمح هذا المجلد بتشغيل مواقع أخرى بجانب سنابل على نفس السيرفر، خلف نفس Caddy ونفس المنفذين 80 و443،
دون تعديل `deploy/Caddyfile`. محتوى المجلد خاص بكل سيرفر ولا يُرفع إلى git (ما عدا هذا الملف والمثال).

- كل ملف `*.caddy` هنا يُحمَّل تلقائيًا داخل Caddy (المجلد مركّب على `/etc/caddy/sites` للقراءة فقط).
- الملفات الثابتة لموقع ما توضع في مجلد فرعي، مثل `deploy/sites/example/www/`، وتُقرأ داخل Caddy من `/etc/caddy/sites/example/www`.
- نظام آخر يعمل بـ Docker Compose في مجلد مستقل يصل إليه Caddy عبر الشبكة `caddy-edge`:
  في ملف compose الخاص به أضف الشبكة كـ `external: true` باسم `caddy-edge` وصِل بها الخدمة التي يوجّه إليها Caddy،
  ثم استخدم اسم الخدمة في `reverse_proxy`. لا تفتح لهذا النظام أي منفذ على السيرفر.
- **مهم:** أي خدمة تنضم إلى `caddy-edge` يجب أن يكون اسمها فريدًا (مثل `rw-frontend`)، ولا تُسمّى
  `sanabel-frontend` (الاسم الذي يصل به Caddy إلى سنابل)، ويُفضّل ألا تُسمّى `frontend` أو `backend` أو `db`. ولا تصل قاعدة البيانات بهذه الشبكة أبدًا.

## إضافة موقع
```bash
cp deploy/sites/example.caddy.sample deploy/sites/mysite.caddy   # ثم عدّل الدومين والمسار
docker compose -f docker-compose.yml -f deploy/compose.prod.yml exec caddy caddy validate --config /etc/caddy/Caddyfile
docker compose -f docker-compose.yml -f deploy/compose.prod.yml exec caddy caddy reload --config /etc/caddy/Caddyfile
```
`caddy reload` لا يوقف سنابل، وإذا كان في الإعداد خطأ يرفضه Caddy ويبقي الإعداد القديم يعمل.
**تحذير:** لا تترك ملف `.caddy` فيه خطأ أو يكرر دومين سنابل: عند إعادة تشغيل Caddy (تحديث سنابل أو إعادة تشغيل السيرفر)
سيرفض Caddy البدء وتتوقف سنابل وكل المواقع معه. نفّذ `caddy validate` دائمًا قبل الحفظ النهائي.
تصدر شهادة HTTPS للدومين الجديد تلقائيًا بعد أن يشير سجل `A` الخاص به إلى السيرفر.

## إزالة موقع
احذف ملف `.caddy` الخاص به ثم نفّذ أمر `caddy reload` أعلاه.
