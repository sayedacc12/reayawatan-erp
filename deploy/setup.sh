#!/usr/bin/env bash
# تنصيب سنابل على سيرفر Ubuntu جديد (Oracle / DigitalOcean / غيره) بأمر واحد.
#   bash deploy/setup.sh                      → يشتغل على http://<IP السيرفر>
#   DOMAIN=sanabelerp.com bash deploy/setup.sh → يشتغل على https://sanabelerp.com
# آمن لإعادة التشغيل: لا يغيّر كلمات المرور الموجودة في .env
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

say "1/4 تنصيب Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
fi
DOCKER="docker"; docker info >/dev/null 2>&1 || DOCKER="sudo docker"

say "2/4 فتح المنافذ 80 و443 في جدار حماية السيرفر"
# صور Ubuntu في Oracle فيها قواعد iptables تمنع كل شيء ما عدا SSH
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null \
    || sudo iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
done
if command -v netfilter-persistent >/dev/null; then sudo netfilter-persistent save >/dev/null; fi

say "3/4 تجهيز الإعدادات (.env)"
rand() { openssl rand -base64 "$1" | tr -d '/+=' | cut -c1-"$1"; }
if [ ! -f .env ]; then
  ADMIN_PASS="$(rand 14)"
  cat > .env <<ENV
JWT_SECRET=$(rand 48)
DB_PASSWORD=$(rand 24)
PLATFORM_ADMIN_EMAIL=${PLATFORM_ADMIN_EMAIL:-platform@sanabelerp.com}
PLATFORM_ADMIN_PASSWORD=${ADMIN_PASS}
DOMAIN=${DOMAIN:-}
ENV
  chmod 600 .env
  NEW_ADMIN=1
else
  # تحديث الدومين فقط إذا تم تمريره
  if [ -n "${DOMAIN:-}" ]; then
    grep -q '^DOMAIN=' .env && sed -i "s|^DOMAIN=.*|DOMAIN=${DOMAIN}|" .env || echo "DOMAIN=${DOMAIN}" >> .env
  fi
fi

say "4/4 بناء وتشغيل سنابل (أول مرة تاخد 5-10 دقايق)"
$DOCKER compose -f docker-compose.yml -f deploy/compose.prod.yml up -d --build

set -a; . ./.env; set +a
IP="$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')"
echo
echo "=============================================="
echo " ✅ سنابل شغال"
if [ -n "${DOMAIN:-}" ]; then echo " الرابط: https://${DOMAIN}"; else echo " الرابط: http://${IP}"; fi
echo " دخول مدير المنصة: ${PLATFORM_ADMIN_EMAIL}"
if [ "${NEW_ADMIN:-0}" = 1 ]; then
  echo " كلمة المرور:      ${PLATFORM_ADMIN_PASSWORD}"
  echo " (احفظها الآن وغيّرها بعد أول دخول)"
fi
echo "=============================================="
