#!/bin/bash
# ينشئ N جمعية تجريبية كاملة على نسخة اختبار: يُنشئ الجمعية التجريبية، ثم يعيد تسميتها (lt-001 ...)
# حتى يمكن إنشاء التالية. للاختبار فقط، لا يُشغَّل على الإنتاج.
#   ADMIN_LOGIN=platform@example.org ADMIN_PASSWORD=... bash loadtest/orgs.sh 100
set -u
DB=${DATABASE_URL:-postgres://erp:erp@localhost:5432/charity_erp}
BASE=${BASE:-http://localhost:3000}
P="psql -q $DB"
N=${1:-100}
for i in $(seq 1 "$N"); do
  TOKEN=$(curl -s "$BASE/api/auth/login" -H 'content-type: application/json' \
    -d "{\"login\":\"$ADMIN_LOGIN\",\"password\":\"$ADMIN_PASSWORD\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
  n=$($P -Atc "select count(*) from organizations where slug like 'lt-%'")
  k=$(printf '%03d' $((n + 1)))
  # إعادة تسمية الجمعية التجريبية السابقة (إن وجدت) وبريد موظفيها حتى لا تتعارض مع الجديدة
  $P -c "begin;
   update users set email='lt$k-'||email, username=case when username is null then null else 'lt$k-'||username end where organization_id=(select id from organizations where slug='demo');
   update hr_attendance_devices set serial_number='LT$k-'||serial_number where organization_id=(select id from organizations where slug='demo');
   update organizations set slug='lt-$k', name=name||' $k' where slug='demo';
   commit;"
  code=$(curl -s -o /tmp/lt-last.json -w '%{http_code}' -X POST "$BASE/api/platform/demo-organization" -H "authorization: Bearer $TOKEN")
  echo "$(date +%T) org $k -> $code"
  if [ "$code" != "201" ]; then cat /tmp/lt-last.json; exit 1; fi
done
