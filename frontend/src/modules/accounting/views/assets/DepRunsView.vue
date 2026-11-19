<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../../api';
import { useSession } from '../../../../stores/session';
import { useToast } from '../../../../stores/toast';
import { AF, type Run } from '../../assets';
import { P, dt, monthName, sar } from '../../lib';
import '../../../projects/projects.css';
import '../../acc.css';
import './assets.css';

const session = useSession();
const toast = useToast();
const router = useRouter();
const runs = ref<Run[]>([]);
const error = ref('');
async function load() {
  try {
    runs.value = await api<Run[]>(`${AF}/runs`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
async function cancel(r: Run) {
  const reason = prompt(`سبب إلغاء حركة الإهلاك رقم ${r.runNo} (${monthName(r.period)})؟ يُعكس قيدها ويعود الأصل لحالته قبلها.`);
  if (!reason) return;
  try {
    await api(`${AF}/runs/${r.id}/cancel`, { method: 'POST', json: { reason } });
    toast.success('أُلغيت حركة الإهلاك وقيدها');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div>
    <section class="pm-hero ac-hero fa-hero">
      <div>
        <p class="pm-kicker">الأصول الثابتة</p>
        <h1>سجل حركات الإهلاك</h1>
        <p class="pm-sub">كل ترحيل إهلاك حركة برقمها وسند إهلاكها. الإلغاء من هنا فقط وبالتسلسل: لا تُلغى حركة في الوسط، فلإلغاء إهلاك فبراير تُلغى حركة مارس أولًا. وقيود الإهلاك لا تُعدَّل ولا تُلغى من النظام المالي.</p>
      </div>
      <div class="pm-actions"><RouterLink v-if="session.can(P.assetsDepreciate)" to="/accounting/assets/depreciation" class="btn ac-glow">احتساب جديد</RouterLink></div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <section class="card pm-panel">
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>الحركة</th><th>النوع</th><th>الفترة</th><th>حتى تاريخ</th><th>النطاق</th><th>الأصول</th><th>المبلغ</th><th>سند الإهلاك</th><th>الحالة</th><th></th></tr></thead>
          <tbody>
            <tr v-for="r in runs" :key="r.id" :class="['ac-row-click', { voided: r.status === 'cancelled' }]" @click="router.push(`/accounting/assets/runs/${r.id}`)">
              <td class="ac-code"><b>{{ r.runNo }}</b></td><td>{{ r.kindLabel }}</td><td>{{ monthName(r.period) }}</td><td>{{ r.toDate }}</td><td>{{ r.scope.label }}</td>
              <td>{{ r.assetCount }}</td><td class="pm-money">{{ sar(r.total) }}</td>
              <td @click.stop><RouterLink v-if="r.entry" :to="`/accounting/entries/${r.entry.id}`" class="pm-link ac-code">{{ r.entry.voucherNo }}</RouterLink></td>
              <td>
                <span class="pm-pill" :style="{ '--c': r.status === 'posted' ? '#10b981' : '#b91c1c' }">{{ r.statusLabel }}</span>
                <span class="pm-muted">{{ r.createdByName }} · {{ dt(r.createdAt) }}</span>
                <span v-if="r.cancelReason" class="pm-muted">أُلغيت: {{ r.cancelReason }}</span>
              </td>
              <td @click.stop>
                <template v-if="r.status === 'posted' && session.can(P.assetsReverse)">
                  <button v-if="!r.cancelBlock" class="btn btn-sm" @click="cancel(r)">إلغاء</button>
                  <span v-else class="pm-tag" :title="r.cancelBlock">🔒 {{ r.cancelBlock }}</span>
                </template>
              </td>
            </tr>
            <tr v-if="!runs.length"><td colspan="10" class="pm-empty">لم يُرحَّل إهلاك بعد</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
td .pm-muted { display: block; font-size: .78rem; }
.voided td { color: var(--muted); }
td .pm-tag { white-space: normal; max-width: 260px; display: inline-block; }
</style>
