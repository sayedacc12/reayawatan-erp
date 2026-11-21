#!/usr/bin/env bash
# تنصيب أو تحديث نظام رعاية وطن على السيرفر المشترك مع سنابل (خلف Caddy الخاص بسنابل).
#   cd ~/reayawatan-erp && bash deploy/setup.sh
# لا يغيّر شيئًا في سنابل: مشروع Docker مستقل باسم rw، وخدماته rw-db و rw-backend و rw-frontend،
# والواجهة وحدها تنضم إلى الشبكة caddy-edge. لا يفتح منافذ ولا يعدّل جدار الحماية.
# آمن لإعادة التشغيل: لا يغيّر الأسرار الموجودة في .env
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }
DOCKER="docker"; docker info >/dev/null 2>&1 || DOCKER="sudo docker"
DC() { $DOCKER compose -p rw -f docker-compose.yml -f deploy/compose.prod.yml "$@"; }

say "1/5 التحقق من المتطلبات"
command -v docker >/dev/null || die "Docker غير منصّب على السيرفر"
$DOCKER network inspect caddy-edge >/dev/null 2>&1 \
  || die "الشبكة caddy-edge غير موجودة. يجب أن تعمل سنابل (وCaddy الخاص بها) على هذا السيرفر أولًا"

say "2/5 تجهيز الإعدادات (.env)"
rand() { openssl rand -base64 "$1" | tr -d '/+=' | cut -c1-"$1"; }
NEW_INSTALL=0
if [ ! -f .env ]; then
  [ -n "${DIRECTOR_EMAIL:-}" ] || die "اكتب بريد مدير المنظمة: DIRECTOR_EMAIL=name@example.com bash deploy/setup.sh"
  cat > .env <<ENV
JWT_SECRET=$(rand 48)
DB_PASSWORD=$(rand 24)
ZATCA_KEY_SECRET=$(rand 48)
COMPANY_SLUG=reayawatan
COMPANY_NAME=رعاية وطن
DIRECTOR_NAME=${DIRECTOR_NAME:-مدير المنظمة}
DIRECTOR_EMAIL=${DIRECTOR_EMAIL}
DIRECTOR_USERNAME=${DIRECTOR_USERNAME:-director}
DOMAIN=${DOMAIN:-reayawatan.com}
ENV
  chmod 600 .env
  NEW_INSTALL=1
fi

say "3/5 بناء وتشغيل رعاية وطن (أول مرة تأخذ 5-10 دقائق)"
if [ "$NEW_INSTALL" = 1 ]; then
  # كلمة مرور مؤقتة للمدير: تُمرَّر لأول تشغيل فقط ولا تُحفظ في .env ولا في سجل الخادم
  DIRECTOR_PASSWORD="Rw$(rand 12)7"
  DIRECTOR_PASSWORD_SHOWN="$DIRECTOR_PASSWORD"
  export DIRECTOR_PASSWORD DIRECTOR_PASSWORD_TEMPORARY=1
fi
DC up -d --build

say "4/5 انتظار جاهزية الخادم"
for _ in $(seq 1 60); do
  if DC exec -T rw-frontend wget -qO- http://rw-backend:3000/api/public/web >/dev/null 2>&1; then READY=1; break; fi
  sleep 5
done
[ "${READY:-0}" = 1 ] || die "الخادم لم يجهز بعد. راجع السجل: $DOCKER compose -p rw logs --tail 80 rw-backend"
if [ "$NEW_INSTALL" = 1 ]; then
  # إعادة إنشاء الخادم بلا كلمة المرور في متغيراته (المدير أُنشئ وكلمته محفوظة مشفّرة في القاعدة)
  unset DIRECTOR_PASSWORD DIRECTOR_PASSWORD_TEMPORARY
  DC up -d rw-backend
fi

say "5/5 النسخ الاحتياطي اليومي (3:30 فجرًا بتوقيت الرياض)"
sudo tee /etc/systemd/system/rw-backup.service >/dev/null <<UNIT
[Unit]
Description=Reaya Watan daily backup (deploy/backup.sh)
After=docker.service
Wants=docker.service

[Service]
Type=oneshot
ExecStart=/bin/bash $(pwd)/deploy/backup.sh run
Nice=10
IOSchedulingClass=idle
UNIT
sudo tee /etc/systemd/system/rw-backup.timer >/dev/null <<'UNIT'
[Unit]
Description=Reaya Watan daily backup at 03:30 Riyadh time

[Timer]
OnCalendar=*-*-* 03:30:00 Asia/Riyadh
RandomizedDelaySec=15min
Persistent=true

[Install]
WantedBy=timers.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now rw-backup.timer >/dev/null
if sudo test -s /etc/reayawatan-backup/rclone.conf; then BACKUP_STATE="مفعّل"; else BACKUP_STATE="لم يُربط بعد: اتبع deploy/BACKUP.md"; fi

set -a; . ./.env; set +a
echo
echo "=============================================="
echo " ✅ رعاية وطن تعمل داخل Docker (المشروع rw)"
echo " الرابط بعد ربط Caddy: https://${DOMAIN}"
echo " دخول الموظفين: https://${DOMAIN}/login"
if [ "$NEW_INSTALL" = 1 ]; then
  echo " اسم دخول المدير: ${DIRECTOR_USERNAME}  (أو ${DIRECTOR_EMAIL})"
  echo " كلمة المرور المؤقتة: ${DIRECTOR_PASSWORD_SHOWN}"
  echo " (تظهر هنا مرة واحدة، صالحة 24 ساعة، ويطلب النظام تغييرها عند أول دخول)"
fi
echo " النسخ الاحتياطي: ${BACKUP_STATE}"
echo "=============================================="
