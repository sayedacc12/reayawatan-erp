<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { fmtDateTime } from '../labels';
import '../platform.css';

type Health = 'ok' | 'stale' | 'failed' | 'off';
interface Run {
  id: string; target: string; kind: string; status: 'success' | 'failed'; stamp: string | null; message: string | null;
  dbBytes: number | null; filesBytes: number | null; startedAt: string; finishedAt: string;
}
interface Target {
  code: string; name: string; health: Health; verifyWarning: boolean;
  lastAttempt: Run | null; lastSuccess: Run | null; lastVerify: Run | null;
}
interface Overview { overall: Health | 'alert'; staleHours: number; targets: Target[]; history: Run[] }

const data = ref<Overview | null>(null);
const error = ref('');

onMounted(async () => {
  try {
    data.value = await api<Overview>('/platform/backups');
  } catch (e) {
    error.value = (e as Error).message;
  }
});

const HEALTH: Record<Health, { text: string; tone: string }> = {
  ok: { text: 'تعمل بانتظام', tone: 'ok' },
  stale: { text: 'متأخرة', tone: 'warn' },
  failed: { text: 'فشلت آخر محاولة', tone: 'bad' },
  off: { text: 'غير مربوطة', tone: 'muted' },
};
const KIND: Record<string, string> = {
  daily: 'يومية', weekly: 'أسبوعية', 'pre-restore': 'أمان قبل استرجاع', verify: 'تجربة استرجاع', restore: 'استرجاع فعلي',
};
const TARGET: Record<string, string> = { oracle: 'Oracle', gdrive: 'Google Drive', none: '—' };

const bytes = (n: number | null) => {
  if (n === null || n === undefined) return '—';
  if (n < 1024) return 'أقل من 1 ك.ب';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} ك.ب`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} م.ب`;
  return `${(n / 1024 ** 3).toFixed(2)} ج.ب`;
};
const ago = (d: string) => {
  const h = (Date.now() - new Date(d).getTime()) / 3_600_000;
  if (h < 1) return 'قبل أقل من ساعة';
  if (h < 48) return `قبل ${Math.round(h)} ساعة`;
  return `قبل ${Math.round(h / 24)} يومًا`;
};

const banner = computed(() => {
  const d = data.value;
  if (!d) return null;
  if (d.overall === 'off') return { tone: 'warn', text: 'النسخ الاحتياطي غير مفعّل بعد. اتبع خطوات الربط في ملف deploy/BACKUP.md على السيرفر.' };
  if (d.overall === 'ok') {
    const v = d.targets.some((t) => t.verifyWarning);
    return v
      ? { tone: 'warn', text: 'النسخ تعمل، لكن لم تُجرَّب استعادة نسخة بنجاح خلال الأيام الماضية.' }
      : { tone: 'ok', text: 'كل النسخ الاحتياطية تعمل بانتظام، وآخر تجربة استرجاع نجحت.' };
  }
  return { tone: 'bad', text: `تنبيه: وجهة على الأقل فشلت أو لم تُنسخ منذ أكثر من ${d.staleHours} ساعة. راجع التفاصيل أدناه.` };
});
</script>

<template>
  <div>
    <section class="p-hero">
      <div>
        <p class="p-kicker">حماية البيانات</p>
        <h1>النسخ الاحتياطي</h1>
        <p class="p-sub">
          نسخة يومية مشفّرة من قاعدة البيانات والملفات المرفوعة، تُرفع مباشرة إلى وجهتين خارج السيرفر دون أن تأخذ من مساحته.
          يُحتفظ بآخر 7 نسخ يومية وآخر 4 أسبوعية، وتُجرَّب استعادة نسخة كل أسبوع للتأكد أنها سليمة.
        </p>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <template v-if="data">
      <div v-if="banner" :class="['b-banner', `b-${banner.tone}`]">{{ banner.text }}</div>

      <div class="p-grid">
        <section v-for="t in data.targets" :key="t.code" :class="['card', 'p-panel', 'b-target', `b-${HEALTH[t.health].tone}-edge`]">
          <div class="b-head">
            <h2>{{ t.name }}</h2>
            <span :class="['tone', `tone-${HEALTH[t.health].tone}`]">{{ HEALTH[t.health].text }}</span>
          </div>
          <dl v-if="t.health !== 'off'" class="p-dl">
            <dt>آخر نسخة ناجحة</dt>
            <dd>
              <template v-if="t.lastSuccess">{{ fmtDateTime(t.lastSuccess.startedAt) }} <small class="muted">({{ ago(t.lastSuccess.startedAt) }})</small></template>
              <span v-else class="muted">لا يوجد</span>
            </dd>
            <dt>حجمها</dt>
            <dd v-if="t.lastSuccess">قاعدة البيانات {{ bytes(t.lastSuccess.dbBytes) }}، الملفات {{ bytes(t.lastSuccess.filesBytes) }}</dd>
            <dd v-else>—</dd>
            <dt>آخر تجربة استرجاع</dt>
            <dd>
              <template v-if="t.lastVerify">
                <span :class="['tone', t.lastVerify.status === 'success' ? 'tone-ok' : 'tone-bad']">{{ t.lastVerify.status === 'success' ? 'نجحت' : 'فشلت' }}</span>
                {{ fmtDateTime(t.lastVerify.startedAt) }}
              </template>
              <span v-else class="muted">لم تُجرَّب بعد</span>
            </dd>
          </dl>
          <p v-else class="muted">لم تُربط هذه الوجهة بعد.</p>
          <p v-if="t.health === 'failed' && t.lastAttempt?.message" class="b-error">{{ t.lastAttempt.message }}</p>
        </section>
      </div>

      <section class="card p-panel">
        <h2>سجل التشغيل</h2>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>الوقت</th><th>الوجهة</th><th>النوع</th><th>النتيجة</th><th>قاعدة البيانات</th><th>الملفات</th><th>ملاحظة</th></tr></thead>
            <tbody>
              <tr v-for="r in data.history" :key="r.id">
                <td>{{ fmtDateTime(r.startedAt) }}</td>
                <td>{{ TARGET[r.target] ?? r.target }}</td>
                <td>{{ KIND[r.kind] ?? r.kind }}</td>
                <td><span :class="['tone', r.status === 'success' ? 'tone-ok' : 'tone-bad']">{{ r.status === 'success' ? 'نجحت' : 'فشلت' }}</span></td>
                <td>{{ bytes(r.dbBytes) }}</td>
                <td>{{ bytes(r.filesBytes) }}</td>
                <td class="b-msg">{{ r.message ?? '' }}</td>
              </tr>
              <tr v-if="!data.history.length"><td colspan="7" class="muted center">لا توجد عمليات نسخ مسجلة بعد</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.b-banner { padding: 12px 16px; border-radius: 12px; margin-bottom: 16px; font-weight: 600; }
.b-ok { background: var(--success-soft); color: var(--success); }
.b-warn { background: #fff4e0; color: #9a5b00; }
.b-bad { background: var(--danger-soft); color: var(--danger); }
.b-target { border-top: 4px solid var(--border); }
.b-ok-edge { border-top-color: var(--success); }
.b-warn-edge { border-top-color: #e8b04b; }
.b-bad-edge { border-top-color: var(--danger); }
.b-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.b-head h2 { margin: 0; }
.b-error { margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--danger-soft); color: var(--danger); font-size: .88rem; white-space: pre-wrap; word-break: break-word; }
.b-msg { max-width: 360px; font-size: .86rem; color: var(--muted); word-break: break-word; }
</style>
