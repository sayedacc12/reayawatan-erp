# تشغيل رعاية وطن على السيرفر

رعاية وطن نسخة مستقلة تعمل على نفس سيرفر سنابل (Oracle، Ubuntu 24.04)، خلف Caddy الخاص بسنابل.
لا تفتح منافذ جديدة، ولا تعدّل ملفات سنابل إلا بإضافة ملف موقع واحد في `deploy/sites/`.

| العنصر | القيمة |
|---|---|
| مجلد الكود | `~/reayawatan-erp` |
| مشروع Docker | `rw` (الخدمات: `rw-db`، `rw-backend`، `rw-frontend`) |
| الوصول من الإنترنت | Caddy سنابل ← الشبكة `caddy-edge` ← `reayawatan-frontend:80` |
| قاعدة البيانات | `rw-db` على الشبكة الداخلية للمشروع فقط (ليست على `caddy-edge`) |
| الدومين | `reayawatan.com` (و`www` و`erp` يحوّلان إليه) |

## 1. مفتاح قراءة للمستودع
مفاتيح النشر في GitHub لا تتكرر بين مستودعين، فيُنشأ مفتاح خاص لرعاية وطن باسم مختلف:
```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/reayawatan_deploy
cat ~/.ssh/reayawatan_deploy.pub
```
أضيفوه في GitHub: مستودع reayawatan-erp ← Settings ← Deploy keys ← Add deploy key (قراءة فقط). ثم:
```bash
cat >> ~/.ssh/config <<'CFG'
Host github-reayawatan
  HostName github.com
  User git
  IdentityFile ~/.ssh/reayawatan_deploy
  IdentitiesOnly yes
CFG
git clone github-reayawatan:sayedacc12/reayawatan-erp.git ~/reayawatan-erp
```

## 2. التشغيل
```bash
cd ~/reayawatan-erp && DIRECTOR_EMAIL=name@example.com bash deploy/setup.sh
```
يتحقق من وجود شبكة `caddy-edge`، ويكتب `.env` بأسرار عشوائية، ويبني النظام ويشغّله،
ويطبع مرة واحدة اسم دخول المدير وكلمة مرور مؤقتة (صالحة 24 ساعة، ويُطلب تغييرها عند أول دخول).
كلمة المرور المؤقتة تمر عبر متغيرات بيئة الخادم الخلفي في التشغيل الأول فقط، ثم يُعاد إنشاء الحاوية بدونها فورًا ولا تُحفظ في `.env`.

## 3. ربط الدومين في Caddy سنابل
```bash
cp ~/reayawatan-erp/deploy/reayawatan.caddy ~/charity-erp/deploy/sites/reayawatan.caddy
cd ~/charity-erp
docker compose -f docker-compose.yml -f deploy/compose.prod.yml exec caddy caddy validate --config /etc/caddy/Caddyfile
docker compose -f docker-compose.yml -f deploy/compose.prod.yml exec caddy caddy reload --config /etc/caddy/Caddyfile
```
نفّذوا `reload` فقط إذا نجح `validate`. تصدر شهادة HTTPS تلقائيًا لأن سجلات `A` تشير إلى السيرفر.

## 4. التحديث لاحقًا
```bash
cd ~/reayawatan-erp && git pull origin main && bash deploy/setup.sh
```

## 5. البريد والنسخ الاحتياطي
- البريد الصادر: `bash deploy/mail-setup.sh` (Zoho Mail: الخادم `smtp.zoho.com` المنفذ 465، بصندوق مثل `no-reply@reayawatan.com` وكلمة مرور تطبيق من إعدادات أمان Zoho)
- النسخ الاحتياطي: `deploy/BACKUP.md` (المؤقت `rw-backup.timer` يُجهَّز تلقائيًا، ويبقى ربط الوجهات مرة واحدة)
