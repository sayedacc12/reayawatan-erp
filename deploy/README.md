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
