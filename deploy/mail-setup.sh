#!/usr/bin/env bash
# تفعيل البريد الصادر لسنابل (Gmail الآن، ويمكن تغييره لاحقًا لأي مزود SMTP).
#   bash deploy/mail-setup.sh
# يطلب البريد وكلمة مرور التطبيق (لا تظهر على الشاشة)، ويحفظهما في ملف .env على السيرفر فقط،
# ثم يعيد تشغيل الخادم الخلفي. لا ترسل كلمة مرور التطبيق لأي أحد ولا تضعها في GitHub.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "لم أجد ملف .env. شغّل أولًا: DOMAIN=sanabelerp.com bash deploy/setup.sh"
  exit 1
fi

current_user="$(grep -E '^SMTP_USER=' .env | cut -d= -f2- || true)"
default_user="${current_user:-sayed.acc12@gmail.com}"

echo
echo "== تفعيل البريد الصادر لسنابل =="
read -r -p "بريد Gmail المرسل [${default_user}]: " MAIL_USER
MAIL_USER="${MAIL_USER:-$default_user}"
MAIL_USER="$(echo "$MAIL_USER" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
if ! [[ "$MAIL_USER" =~ ^[^@]+@[^@]+\.[^@]+$ ]]; then echo "البريد غير صحيح"; exit 1; fi

echo "الصق كلمة مرور التطبيق (16 حرفًا). لن تظهر أثناء الكتابة، ثم اضغط Enter:"
read -r -s APP_PASS
echo
APP_PASS="$(echo "$APP_PASS" | tr -d '[:space:]')"
if [ "${#APP_PASS}" -lt 16 ]; then
  echo "كلمة مرور التطبيق قصيرة. يجب أن تكون 16 حرفًا كما أعطاك Google."
  exit 1
fi

if [[ "$MAIL_USER" == *@gmail.com || "$MAIL_USER" == *@googlemail.com ]]; then HOST=smtp.gmail.com; else
  read -r -p "خادم SMTP (مثل smtp.gmail.com): " HOST
fi

set_env() {
  local key="$1" val="$2" tmp
  tmp="$(mktemp)"
  grep -v -E "^${key}=" .env > "$tmp" || true
  printf '%s=%s\n' "$key" "$val" >> "$tmp"
  cat "$tmp" > .env
  rm -f "$tmp"
}
set_env SMTP_HOST "$HOST"
set_env SMTP_PORT 465
set_env SMTP_USER "$MAIL_USER"
set_env SMTP_PASS "$APP_PASS"
set_env MAIL_FROM "$MAIL_USER"
chmod 600 .env
unset APP_PASS

DOCKER="docker"; docker info >/dev/null 2>&1 || DOCKER="sudo docker"
echo "جارٍ إعادة تشغيل الخادم..."
$DOCKER compose -f docker-compose.yml -f deploy/compose.prod.yml up -d backend >/dev/null

echo
echo "=============================================="
echo " ✅ تم حفظ إعدادات البريد: ${MAIL_USER}"
echo " الآن: ادخل لوحة مدير المنصة ← البريد الإلكتروني ← «إرسال رسالة تجريبية»"
echo "=============================================="
