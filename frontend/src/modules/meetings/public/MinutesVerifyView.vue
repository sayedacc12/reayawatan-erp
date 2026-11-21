<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../../api';
import BrandMark from '../../../components/BrandMark.vue';
import { fmtDate, fmtDateTime } from '../lib';

/** التحقق العام من محضر برمز التحقق المطبوع عليه: يعرض حالته وتوقيعاته دون محتواه */
interface V {
  organization: string; body: string; refNo: string; title: string; date: string; version: number; hash: string; status: string; adoptedAt: string | null; adoptionMethod: string | null;
  wetCopy: boolean; signatures: { name: string; role: string; status: string; method: string | null; at: string | null; matches: boolean }[];
}
const code = useRoute().params.code as string;
const v = ref<V | null>(null);
const error = ref('');
onMounted(async () => {
  try {
    v.value = await api<V>(`/public/minutes/verify/${encodeURIComponent(code)}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
});
const METHOD_AR: Record<string, string> = { password: 'إلكتروني بكلمة المرور', code: 'إلكتروني برمز تحقق', wet: 'توقيع حي' };
</script>

<template>
  <div class="mv">
    <main class="wrap">
      <header class="top"><BrandMark :size="30" /><b>التحقق من محضر</b></header>
      <div v-if="error" class="card box"><h1>✖ تعذر التحقق</h1><p class="muted">{{ error }}</p></div>
      <div v-else-if="v" class="card box">
        <div class="seal" :class="{ ok: v.status === 'adopted' }">{{ v.status === 'adopted' ? '✓' : '…' }}</div>
        <h1>{{ v.status === 'adopted' ? 'محضر معتمد وصحيح' : 'محضر صادر وبانتظار اكتمال التوقيع' }}</h1>
        <p class="muted">{{ v.organization }} · {{ v.body }}</p>
        <dl>
          <dt>الاجتماع</dt><dd>{{ v.title }}</dd>
          <dt>الرقم</dt><dd dir="ltr" style="text-align: right">{{ v.refNo }}</dd>
          <dt>التاريخ</dt><dd>{{ fmtDate(v.date) }} · الإصدار {{ v.version }}</dd>
          <dt v-if="v.adoptedAt">الاعتماد</dt><dd v-if="v.adoptedAt">{{ fmtDateTime(v.adoptedAt) }}{{ v.wetCopy ? ' · له نسخة موقعة يدويًا' : '' }}</dd>
          <dt>البصمة</dt><dd class="hash">{{ v.hash }}</dd>
        </dl>
        <table>
          <thead><tr><th>الموقّع</th><th>الحالة</th><th>الطريقة</th><th>مطابقة البصمة</th></tr></thead>
          <tbody>
            <tr v-for="(s, i) in v.signatures" :key="i">
              <td>{{ s.name }}<br /><small class="muted">{{ s.role }}</small></td>
              <td>{{ s.status }}<br /><small class="muted">{{ s.at ? fmtDateTime(s.at) : '' }}</small></td>
              <td>{{ s.method ? METHOD_AR[s.method] : '—' }}</td>
              <td>{{ s.at ? (s.matches ? '✔ مطابق' : '✖ غير مطابق') : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </main>
  </div>
</template>

<style scoped>
.mv { min-height: 100vh; background: var(--grad-dark); padding: 24px 14px 60px; }
.wrap { max-width: 720px; margin: 0 auto; }
.top { display: flex; align-items: center; gap: 10px; color: #fff; font-size: 1.1rem; margin-bottom: 16px; }
.box { padding: 26px; text-align: center; }
.box h1 { font-size: 1.3rem; margin: 10px 0 4px; }
.muted { color: var(--muted); }
.seal { width: 84px; height: 84px; margin: 0 auto; border-radius: 50%; display: grid; place-items: center; font-size: 2.2rem; color: #fff; background: linear-gradient(135deg, #f59e0b, #6366f1); }
.seal.ok { background: linear-gradient(135deg, #10b981, #164e38); box-shadow: 0 0 0 10px rgba(16,185,129,.15); }
dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; text-align: start; margin: 18px 0; }
dt { color: var(--muted); font-size: .85rem; }
dd { margin: 0; font-weight: 600; }
.hash { font-family: ui-monospace, monospace; font-size: .72rem; word-break: break-all; font-weight: 400; direction: ltr; text-align: left; }
table { width: 100%; border-collapse: collapse; text-align: start; font-size: .88rem; }
th, td { border-bottom: 1px solid var(--border); padding: 8px; text-align: start; }
</style>
