# تشغيل سنابل على سيرفر

الخطوات دي لسيرفر Ubuntu 24.04 (مثلاً Oracle Cloud Always Free).

## 1. افتح المنافذ في لوحة المزوّد
في Oracle: VCN ← Security Lists ← Default Security List ← Add Ingress Rules:
- Source CIDR: `0.0.0.0/0`، IP Protocol: TCP، Destination Port: `80`
- نفس القاعدة للمنفذ `443`

## 2. ادخل على السيرفر
```bash
ssh -i path/to/private.key ubuntu@SERVER_IP
```

## 3. اسحب الكود (المستودع خاص، فنستخدم Deploy key)
```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519
cat ~/.ssh/id_ed25519.pub
```
انسخ الناتج وضيفه في GitHub: المستودع ← Settings ← Deploy keys ← Add deploy key (قراءة فقط).
```bash
git clone git@github.com:sayedacc12/charity-erp.git
cd charity-erp
```

## 4. شغّل
```bash
bash deploy/setup.sh
```
السكريبت بيثبّت Docker، ويفتح 80 و443 في الجدار الناري للسيرفر، ويعمل ملف `.env` بأسرار عشوائية، ويشغّل النظام.
في أول تشغيل بيطبع إيميل وكلمة سر مدير المنصة. احفظهم في مكان آمن.

افتح `http://SERVER_IP`.

## 5. اربط الدومين
عند مسجّل الدومين (Namecheap) ضيف سجل `A` للـ Host `@` بقيمة `SERVER_IP`.
بعد ما يشتغل الـ DNS:
```bash
DOMAIN=sanabelerp.com bash deploy/setup.sh
```
شهادة HTTPS بتطلع تلقائيًا من Let's Encrypt عن طريق Caddy.

## التحديث
```bash
git pull && bash deploy/setup.sh
```

## البريد الإلكتروني (Gmail الآن، وأي مزود SMTP لاحقًا)

1. في حساب Google للبريد المرسل: فعّل «التحقق بخطوتين»، ثم أنشئ «كلمة مرور للتطبيقات» من https://myaccount.google.com/apppasswords
2. على السيرفر: `bash deploy/mail-setup.sh` والصق كلمة مرور التطبيق (لا تظهر على الشاشة، وتُحفظ في `.env` فقط).
3. من لوحة مدير المنصة ← «البريد الإلكتروني» ← «إرسال رسالة تجريبية».

للتحويل لاحقًا إلى Google Workspace أو مزود آخر: غيّر `SMTP_HOST` و`SMTP_PORT` و`SMTP_USER` و`SMTP_PASS` و`MAIL_FROM` في `.env` ثم أعد تشغيل الخادم. حد Gmail العادي نحو 500 رسالة يوميًا.
