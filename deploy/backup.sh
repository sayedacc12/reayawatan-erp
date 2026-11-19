#!/usr/bin/env bash
# النسخ الاحتياطي لسنابل: قاعدة البيانات + الملفات المرفوعة، مشفّرة، إلى Oracle Object Storage و Google Drive.
#
# النسخة لا تُحفظ على قرص السيرفر أبدًا: تُقرأ من قاعدة البيانات وتُشفّر وتُرفع مباشرة (تدفّق).
# الاحتفاظ في كل وجهة: آخر 7 نسخ يومية + آخر 4 نسخ أسبوعية (نسخة يوم الجمعة)، ويُحذف الأقدم تلقائيًا.
#
# الأوامر:
#   bash deploy/backup.sh setup-oracle     ربط Oracle Object Storage (مرة واحدة)
#   bash deploy/backup.sh setup-drive      ربط Google Drive (مرة واحدة)
#   bash deploy/backup.sh run              أخذ نسخة الآن (هذا ما يشغّله المؤقت اليومي)
#   bash deploy/backup.sh list             عرض النسخ الموجودة في كل وجهة
#   bash deploy/backup.sh verify [oracle|gdrive]   تجربة استرجاع آخر نسخة في قاعدة مؤقتة والتأكد أنها سليمة
#   bash deploy/backup.sh restore [oracle|gdrive] [اسم النسخة]   استرجاع نسخة (يأخذ نسخة أمان قبلها)
#   bash deploy/backup.sh show-key         عرض مفتاح التشفير (احفظه خارج السيرفر)
#   bash deploy/backup.sh status           آخر النتائج
#
# التفاصيل وخطوات الاسترجاع: deploy/BACKUP.md
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
CONF_DIR="${SANABEL_BACKUP_CONF_DIR:-/etc/sanabel-backup}"
export RCLONE_CONFIG="$CONF_DIR/rclone.conf"
KEEP_DAILY="${KEEP_DAILY:-7}"
KEEP_WEEKLY="${KEEP_WEEKLY:-4}"
KEEP_PRE_RESTORE=3
WEEKLY_DAY="${WEEKLY_DAY:-5}"   # 5 = الجمعة
COMPOSE_FILES="${COMPOSE_FILES:--f docker-compose.yml -f deploy/compose.prod.yml}"
TARGETS=(oracle gdrive)

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[1;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

# الإعدادات والمفاتيح ملك root فقط، فنعيد التشغيل بصلاحية sudo
if [ "$(id -u)" != 0 ] && [ -z "${SANABEL_BACKUP_NO_SUDO:-}" ]; then exec sudo -E bash "$0" "$@"; fi
cd "$REPO"

dc() { # shellcheck disable=SC2086
  docker compose $COMPOSE_FILES "$@"; }

target_label() { case "$1" in oracle) echo "Oracle Object Storage" ;; gdrive) echo "Google Drive" ;; *) echo "$1" ;; esac; }
remote_of() { echo "$1-enc:"; }   # الوجهة المشفّرة
has_remote() { [ -f "$RCLONE_CONFIG" ] && rclone listremotes 2>/dev/null | grep -qx "$1-enc:"; }
configured_targets() { local t; for t in "${TARGETS[@]}"; do has_remote "$t" && echo "$t"; done; return 0; }

need_rclone() {
  command -v rclone >/dev/null && return 0
  say "تنصيب أداة rclone"
  apt-get update -qq && apt-get install -y -qq rclone >/dev/null
}

# ---------------- تسجيل النتيجة في قاعدة البيانات (تظهر في لوحة مدير المنصة) ----------------
record() { # target kind status stamp db_bytes files_bytes started_at message
  local sql="INSERT INTO platform_backup_runs (target, kind, status, stamp, db_bytes, files_bytes, started_at, finished_at, message)
    VALUES (:'target', :'kind', :'status', NULLIF(:'stamp',''), NULLIF(:'db','')::bigint, NULLIF(:'files','')::bigint, :'started'::timestamptz, now(), NULLIF(:'msg',''));"
  printf '%s\n' "$sql" | dc exec -T db psql -q -v ON_ERROR_STOP=1 -U erp -d charity_erp \
    -v target="$1" -v kind="$2" -v status="$3" -v stamp="$4" -v db="$5" -v files="$6" -v started="$7" -v msg="${8:0:2000}" \
    >/dev/null 2>&1 || warn "تعذّر تسجيل النتيجة في قاعدة البيانات"
}

size_of() { rclone lsjson --files-only "$1" 2>/dev/null | sed -n 's/.*"Size":\([0-9]*\).*/\1/p' | head -1; }

# ---------------- النسخ ----------------
# يرفع نسخة واحدة (قاعدة + ملفات) إلى وجهة واحدة داخل مجلد معيّن. لا يكتب شيئًا على القرص.
upload_to() { # target folder stamp → يطبع "db_bytes files_bytes"
  local r; r="$(remote_of "$1")"; local folder="$2" stamp="$3"
  local db="$r$folder/sanabel-db-$stamp.dump" files="$r$folder/sanabel-files-$stamp.tar.gz"
  dc exec -T db pg_dump -U erp -d charity_erp -Fc -Z 6 | rclone rcat "$db" || { echo "تعذّر نسخ قاعدة البيانات" >&2; return 1; }
  dc exec -T backend sh -c 'cd /app && if [ -d uploads ]; then tar -czf - uploads; else tar -czf - -T /dev/null; fi' | rclone rcat "$files" \
    || { echo "تعذّر نسخ الملفات المرفوعة" >&2; return 1; }
  local dbs fs; dbs="$(size_of "$db")"; fs="$(size_of "$files")"
  [ -n "$dbs" ] && [ "$dbs" -gt 100 ] || { rclone deletefile "$db" 2>/dev/null || true; echo "نسخة قاعدة البيانات فارغة أو لم تصل" >&2; return 1; }
  echo "$dbs ${fs:-0}"
}

# يحذف الأقدم في مجلد ويُبقي آخر N نسخ (لا يُحذف شيء إلا بعد نجاح النسخة الجديدة)
prune() { # target folder keep
  local r; r="$(remote_of "$1")"
  local stamps old s
  stamps="$(rclone lsf --files-only "$r$2" 2>/dev/null | sed -n 's/^sanabel-db-\(.*\)\.dump$/\1/p' | sort -u)"
  old="$(printf '%s\n' "$stamps" | sed '/^$/d' | head -n "-$3")"
  for s in $old; do
    rclone deletefile "$r$2/sanabel-db-$s.dump" 2>/dev/null || true
    rclone deletefile "$r$2/sanabel-files-$s.tar.gz" 2>/dev/null || true
    echo "  حُذفت النسخة القديمة $2/$s"
  done
}

backup_target() { # target kind stamp
  local t="$1" kind="$2" stamp="$3" started out dbs fs msg r
  started="$(date -u +%FT%TZ)"; r="$(remote_of "$t")"
  say "النسخ إلى $(target_label "$t")"
  local folder=daily; [ "$kind" = pre-restore ] && folder=pre-restore
  if out="$(upload_to "$t" "$folder" "$stamp" 2>"$CONF_DIR/last-error")"; then
    read -r dbs fs <<<"$out"
    if [ "$kind" = pre-restore ]; then
      prune "$t" pre-restore "$KEEP_PRE_RESTORE"
    else
      if [ "$kind" = weekly ]; then
        if rclone copyto "${r}daily/sanabel-db-$stamp.dump" "${r}weekly/sanabel-db-$stamp.dump" \
          && rclone copyto "${r}daily/sanabel-files-$stamp.tar.gz" "${r}weekly/sanabel-files-$stamp.tar.gz"; then
          prune "$t" weekly "$KEEP_WEEKLY"
        else
          warn "تعذّر حفظ النسخة الأسبوعية، وبقيت اليومية"
        fi
      fi
      prune "$t" daily "$KEEP_DAILY"
    fi
    record "$t" "$kind" success "$stamp" "$dbs" "$fs" "$started" ""
    ok "تمت النسخة: قاعدة البيانات $((dbs / 1024)) ك.ب، الملفات $((fs / 1024)) ك.ب"
    return 0
  fi
  msg="$(tail -c 1500 "$CONF_DIR/last-error" 2>/dev/null)"
  record "$t" "$kind" failed "$stamp" "" "" "$started" "${msg:-فشل غير معروف}"
  warn "فشلت النسخة إلى $(target_label "$t"): $msg"
  return 1
}

cmd_run() {
  need_rclone
  mkdir -p "$CONF_DIR"; chmod 700 "$CONF_DIR"
  exec 9>"$CONF_DIR/.lock"; flock -n 9 || die "توجد نسخة أخرى جارية الآن"
  local targets; mapfile -t targets < <(configured_targets)
  if [ "${#targets[@]}" = 0 ]; then
    record none daily failed "" "" "" "$(date -u +%FT%TZ)" "النسخ الاحتياطي غير مفعّل: لم تُربط أي وجهة بعد (deploy/BACKUP.md)"
    die "لم تُربط أي وجهة بعد. ابدأ بـ: bash deploy/backup.sh setup-oracle"
  fi
  local stamp kind=daily failed=0 t
  stamp="$(TZ=Asia/Riyadh date +%Y-%m-%d_%H%M)"
  [ "$(TZ=Asia/Riyadh date +%u)" = "$WEEKLY_DAY" ] && kind=weekly
  for t in "${targets[@]}"; do backup_target "$t" "$kind" "$stamp" || failed=1; done
  # يوم النسخة الأسبوعية نجرّب استرجاع آخر نسخة للتأكد أنها صالحة فعلًا
  if [ "$kind" = weekly ]; then for t in "${targets[@]}"; do cmd_verify "$t" || failed=1; done; fi
  [ "$failed" = 0 ] || exit 1
}

# ---------------- العرض ----------------
latest_stamp() { # target → أحدث نسخة (يومية أو أسبوعية أو قبل الاسترجاع)
  local r f; r="$(remote_of "$1")"
  for f in daily weekly pre-restore; do
    rclone lsf --files-only "$r$f" 2>/dev/null | sed -n "s|^sanabel-db-\(.*\)\.dump$|\1 $f|p"
  done | sort -r | head -1
}

cmd_list() {
  need_rclone
  local t f any=0
  for t in $(configured_targets); do
    any=1; say "$(target_label "$t")"
    for f in daily weekly pre-restore; do
      { rclone lsl "$(remote_of "$t")$f" 2>/dev/null || true; } | awk -v f="$f" '$4 ~ /^sanabel-db-/ { s=$4; sub(/^sanabel-db-/, "", s); sub(/\.dump$/, "", s); printf "  %-12s %-22s %8.1f م.ب\n", f, s, $1/1048576 }' | sort -k2 -r
    done
  done
  [ "$any" = 1 ] || warn "لم تُربط أي وجهة بعد"
  echo; echo "للاسترجاع: bash deploy/backup.sh restore oracle <اسم النسخة>"
}

cmd_status() {
  dc exec -T db psql -U erp -d charity_erp -c \
    "SELECT to_char(started_at AT TIME ZONE 'Asia/Riyadh','YYYY-MM-DD HH24:MI') AS الوقت, target AS الوجهة, kind AS النوع, status AS النتيجة, round(coalesce(db_bytes,0)/1048576.0,1) AS قاعدة_مب, left(coalesce(message,''),80) AS ملاحظة FROM platform_backup_runs ORDER BY started_at DESC LIMIT 15"
}

pick_target() { # [target]
  if [ -n "${1:-}" ]; then has_remote "$1" || die "الوجهة $1 غير مربوطة"; echo "$1"; return; fi
  local t; t="$(configured_targets | head -1)"; [ -n "$t" ] || die "لم تُربط أي وجهة بعد"; echo "$t"
}

find_backup() { # target stamp → folder
  local r f; r="$(remote_of "$1")"
  for f in daily weekly pre-restore; do
    rclone lsf --files-only "$r$f" 2>/dev/null | grep -qx "sanabel-db-$2.dump" && { echo "$f"; return 0; }
  done
  return 1
}

# ---------------- التحقق: استرجاع في قاعدة مؤقتة ثم حذفها ----------------
cmd_verify() {
  need_rclone
  local t stamp folder started name="sanabel-restore-test" r tables orgs
  t="$(pick_target "${1:-}")"; r="$(remote_of "$t")"; started="$(date -u +%FT%TZ)"
  read -r stamp folder <<<"$(latest_stamp "$t")"
  [ -n "${stamp:-}" ] || die "لا توجد نسخ في $(target_label "$t")"
  say "تجربة استرجاع النسخة $stamp من $(target_label "$t") في قاعدة مؤقتة"
  docker rm -fv "$name" >/dev/null 2>&1 || true
  docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=verify -e POSTGRES_DB=verify postgres:16-alpine >/dev/null
  local i; for i in $(seq 1 60); do docker exec "$name" pg_isready -U postgres -d verify >/dev/null 2>&1 && break; sleep 1; done
  sleep 2
  if rclone cat "${r}$folder/sanabel-db-$stamp.dump" | docker exec -i "$name" pg_restore -U postgres -d verify --no-owner --no-acl --exit-on-error 2>"$CONF_DIR/last-error" \
    && tables="$(docker exec "$name" psql -U postgres -d verify -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")" \
    && orgs="$(docker exec "$name" psql -U postgres -d verify -tAc "SELECT count(*) FROM organizations")" \
    && [ "$tables" -gt 10 ] \
    && rclone cat "${r}$folder/sanabel-files-$stamp.tar.gz" | tar -tzf - >/dev/null 2>>"$CONF_DIR/last-error"; then
    docker rm -fv "$name" >/dev/null 2>&1 || true
    record "$t" verify success "$stamp" "" "" "$started" "استُرجعت بنجاح: $tables جدولًا، $orgs جمعية"
    ok "النسخة سليمة: $tables جدولًا، $orgs جمعية، وملف المرفقات يُقرأ"
    return 0
  fi
  docker rm -fv "$name" >/dev/null 2>&1 || true
  record "$t" verify failed "$stamp" "" "" "$started" "فشلت تجربة الاسترجاع: $(tail -c 1500 "$CONF_DIR/last-error" 2>/dev/null)"
  warn "فشلت تجربة الاسترجاع"; return 1
}

# ---------------- الاسترجاع الفعلي ----------------
cmd_restore() {
  need_rclone
  local t stamp folder r answer
  t="$(pick_target "${1:-}")"; r="$(remote_of "$t")"
  if [ -n "${2:-}" ]; then
    stamp="$2"; folder="$(find_backup "$t" "$stamp")" || die "لم أجد النسخة $stamp في $(target_label "$t"). اعرض النسخ بـ: bash deploy/backup.sh list"
  else
    read -r stamp folder <<<"$(latest_stamp "$t")"; [ -n "${stamp:-}" ] || die "لا توجد نسخ"
  fi
  echo
  echo "سيتم استبدال كل بيانات سنابل الحالية بالنسخة: $stamp ($folder) من $(target_label "$t")"
  echo "وقبل ذلك تُؤخذ نسخة أمان من الوضع الحالي في مجلد pre-restore."
  read -r -p "للمتابعة اكتب yes ثم Enter: " answer
  [ "$answer" = yes ] || die "أُلغي الاسترجاع"

  local now; now="$(TZ=Asia/Riyadh date +%Y-%m-%d_%H%M)-pre"
  backup_target "$t" pre-restore "$now" || die "تعذّرت نسخة الأمان، فلم يُستبدل شيء"

  local started; started="$(date -u +%FT%TZ)"
  say "استرجاع الملفات المرفوعة"
  rclone cat "${r}$folder/sanabel-files-$stamp.tar.gz" | dc exec -T backend sh -c 'set -e; S=/tmp/uploads.restore; rm -rf $S; mkdir -p $S; tar -xzf - -C $S; if [ -d $S/uploads ]; then rm -rf /app/uploads/*; cp -a $S/uploads/. /app/uploads/; fi; rm -rf $S' \
    || die "تعذّر استرجاع الملفات المرفوعة، فلم تُستبدل قاعدة البيانات"
  # سجل النسخ الاحتياطي نحتفظ به كما هو الآن (لا نريد أن يرجع لتاريخ النسخة المسترجعة)
  local history; history="$(dc exec -T db psql -U erp -d charity_erp -qc "COPY platform_backup_runs TO STDOUT" 2>/dev/null || true)"
  say "إيقاف الخادم مؤقتًا واسترجاع قاعدة البيانات"
  dc stop backend
  if rclone cat "${r}$folder/sanabel-db-$stamp.dump" | dc exec -T db pg_restore -U erp -d charity_erp --clean --if-exists --no-owner --single-transaction --exit-on-error; then
    if [ -n "$history" ]; then
      { echo "BEGIN; TRUNCATE platform_backup_runs; COPY platform_backup_runs FROM STDIN;"; printf '%s\n' "$history"; printf '\\.\nCOMMIT;\n'; } \
        | dc exec -T db psql -q -v ON_ERROR_STOP=1 -U erp -d charity_erp >/dev/null 2>&1 || warn "تعذّرت إعادة سجل النسخ الاحتياطي (البيانات نفسها استُرجعت)"
    fi
    dc start backend
    record "$t" restore success "$stamp" "" "" "$started" "استُرجعت النسخة $stamp (نسخة الأمان قبلها: $now)"
    ok "تم الاسترجاع. نسخة الأمان من الوضع السابق اسمها: $now"
  else
    dc start backend
    record "$t" restore failed "$stamp" "" "" "$started" "فشل استرجاع قاعدة البيانات، وبقيت البيانات السابقة كما هي"
    die "فشل استرجاع قاعدة البيانات. لم يتغير شيء فيها (الاسترجاع يتم كاملًا أو لا يتم)."
  fi
}

# ---------------- الإعداد ----------------
ensure_key() {
  mkdir -p "$CONF_DIR"; chmod 700 "$CONF_DIR"; touch "$RCLONE_CONFIG"; chmod 600 "$RCLONE_CONFIG"
  [ -f "$CONF_DIR/key" ] && return 0
  local key
  echo
  echo "كل النسخ تُشفّر بمفتاح سري، ولا يمكن فتحها بدونه أبدًا."
  read -r -s -p "إن كان لديك مفتاح سابق فالصقه الآن، وإلا اضغط Enter لإنشاء مفتاح جديد: " key; echo
  if [ -z "$key" ]; then
    key="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-32)"
    echo
    echo "=============================================="
    echo " مفتاح تشفير النسخ الاحتياطية:"
    echo
    echo "   $key"
    echo
    echo " اكتبه الآن واحفظه في مكان آمن خارج السيرفر (ورقة أو مدير كلمات مرور)."
    echo " إذا ضاع السيرفر وضاع هذا المفتاح، لا يمكن فتح أي نسخة."
    echo " لا ترسله في أي محادثة."
    echo "=============================================="
    read -r -p "بعد حفظه اضغط Enter للمتابعة..." _
  fi
  ( umask 077; printf '%s' "$key" >"$CONF_DIR/key" )
}

add_crypt() { # name remote_path
  rclone config delete "$1-enc" >/dev/null 2>&1 || true
  rclone config create "$1-enc" crypt remote="$2" filename_encryption=off directory_name_encryption=false \
    password="$(rclone obscure "$(cat "$CONF_DIR/key")")" --non-interactive >/dev/null
}

test_target() { # target
  local r; r="$(remote_of "$1")"
  say "تجربة الكتابة والقراءة والحذف في $(target_label "$1")"
  echo "sanabel $(date -u +%FT%TZ)" | rclone rcat "${r}check/test.txt" \
    && rclone cat "${r}check/test.txt" | grep -q sanabel \
    && rclone deletefile "${r}check/test.txt" \
    && ok "الربط يعمل" && return 0
  die "الربط لا يعمل. راجع البيانات وأعد المحاولة."
}

cmd_setup_oracle() {
  need_rclone; ensure_key
  local ns bucket region ak sk
  echo
  echo "ربط Oracle Object Storage. تجد القيم المطلوبة في deploy/BACKUP.md."
  read -r -p "Namespace (يظهر في صفحة الـ Bucket): " ns
  read -r -p "اسم الـ Bucket [sanabel-backups]: " bucket; bucket="${bucket:-sanabel-backups}"
  read -r -p "المنطقة [me-jeddah-1]: " region; region="${region:-me-jeddah-1}"
  read -r -p "Access Key: " ak
  read -r -s -p "Secret Key (لن يظهر أثناء اللصق): " sk; echo
  [ -n "$ns" ] && [ -n "$ak" ] && [ -n "$sk" ] || die "كل الحقول مطلوبة"
  rclone config delete oracle >/dev/null 2>&1 || true
  rclone config create oracle s3 provider=Other env_auth=false access_key_id="$ak" secret_access_key="$sk" \
    endpoint="https://$ns.compat.objectstorage.$region.oraclecloud.com" region="$region" \
    force_path_style=true no_check_bucket=true --non-interactive >/dev/null
  add_crypt oracle "oracle:$bucket/sanabel"
  test_target oracle
  echo; echo "الخطوة التالية: bash deploy/backup.sh run   (لأخذ أول نسخة الآن)"
}

cmd_setup_drive() {
  need_rclone; ensure_key
  echo
  echo "ربط Google Drive. يجب أن تكون دخلت السيرفر بهذا الأمر (انظر deploy/BACKUP.md):"
  echo "  ssh -L 53682:localhost:53682 -i <ملف المفتاح> ubuntu@<IP السيرفر>"
  echo
  echo "سيظهر الآن رابط. انسخه وافتحه في متصفح جهازك، وسجّل الدخول بحساب Google ووافق."
  echo "بعد ظهور صفحة All done ارجع هنا وانتظر، ولا تكتب شيئًا في هذه الشاشة."
  echo "الصلاحية المطلوبة محدودة: الملفات التي ينشئها سنابل فقط، ولا يرى بقية ملفاتك."
  echo
  # authorize يكتفي بتسجيل الدخول ويطبع الرمز، دون أسئلة إضافية تقرأ من لوحة المفاتيح
  # (صلاحية drive.file فقط: الملفات التي ينشئها سنابل)
  local blob out tok
  blob="$(printf '{"scope":"drive.file"}' | base64 -w0 | tr -d '=')"
  out="$(rclone authorize drive "$blob" </dev/null)" || die "لم يكتمل تسجيل الدخول في Google. تأكد من أمر الدخول أعلاه ثم أعد المحاولة."
  # مع إعدادات مرفقة يطبع rclone الرد مرمّزًا (base64 لـ JSON فيه token)، وبدونها يطبع الرمز نفسه
  tok="$(printf '%s\n' "$out" | sed -n '/--->$/,/^<---End paste/p' | sed '1d;$d' | tr -d '[:space:]' | python3 -I -c '
import base64, json, sys
s = sys.stdin.read().strip()
if s.startswith("{"):
    print(s)
else:
    print(json.loads(base64.b64decode(s + "=" * (-len(s) % 4)))["token"])
' 2>/dev/null)"
  printf '%s' "$tok" | grep -q access_token || die "لم يصل رمز الدخول من Google. أعد المحاولة."
  rclone config delete gdrive >/dev/null 2>&1 || true
  rclone config create gdrive drive scope=drive.file token="$tok" config_refresh_token=false --non-interactive </dev/null >/dev/null \
    || die "تعذّر حفظ ربط Google Drive. أعد المحاولة."
  rclone config show gdrive 2>/dev/null | grep -q '^token' || die "لم يكتمل تسجيل الدخول في Google. أعد المحاولة."
  add_crypt gdrive "gdrive:sanabel-backups"
  test_target gdrive
  echo; echo "الخطوة التالية: bash deploy/backup.sh run   (لأخذ نسخة الآن)"
}

cmd_show_key() {
  [ -f "$CONF_DIR/key" ] || die "لا يوجد مفتاح بعد"
  echo "مفتاح تشفير النسخ (احفظه خارج السيرفر ولا ترسله في أي محادثة):"
  echo; cat "$CONF_DIR/key"; echo
}

case "${1:-}" in
  run) cmd_run ;;
  list) cmd_list ;;
  status) cmd_status ;;
  verify) cmd_verify "${2:-}" ;;
  restore) cmd_restore "${2:-}" "${3:-}" ;;
  setup-oracle) cmd_setup_oracle ;;
  setup-drive) cmd_setup_drive ;;
  show-key) cmd_show_key ;;
  *) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
