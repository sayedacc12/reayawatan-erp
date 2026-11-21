<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { api } from '../../../../api';
import { useSession } from '../../../../stores/session';
import { useToast } from '../../../../stores/toast';
import DepReport from '../../components/DepReport.vue';
import { AF, type DepReport as Report, type Run } from '../../assets';
import { P, dt, monthName, sar } from '../../lib';
import '../../../../shared/module.css';
import '../../acc.css';
import './assets.css';

const props = defineProps<{ id: string }>();
const session = useSession();
const toast = useToast();
const r = ref<(Run & Report) | null>(null);
const error = ref('');
async function load() {
  try {
    r.value = await api<Run & Report>(`${AF}/runs/${props.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
watch(() => props.id, load);
async function cancel() {
  if (!r.value) return;
  const reason = prompt('سبب الإلغاء؟');
  if (!reason) return;
  try {
    await api(`${AF}/runs/${r.value.id}/cancel`, { method: 'POST', json: { reason } });
    toast.success('أُلغيت حركة الإهلاك');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const printNow = () => window.print();
</script>

<template>
  <div v-if="r">
    <section class="pm-hero ac-hero fa-hero no-print">
      <div>
        <p class="pm-kicker">سجل حركات الإهلاك · الحركة {{ r.runNo }}</p>
        <h1>{{ r.kindLabel }}: {{ monthName(r.period) }}</h1>
        <p class="pm-sub">{{ r.scope.label }} · {{ r.assetCount }} أصل · {{ sar(r.total) }} · رحّلها {{ r.createdByName }} في {{ dt(r.createdAt) }}</p>
      </div>
      <div class="pm-actions">
        <RouterLink v-if="r.entry" :to="`/accounting/entries/${r.entry.id}`" class="btn ac-ghost">سند الإهلاك {{ r.entry.voucherNo }}</RouterLink>
        <button class="btn ac-ghost" @click="printNow">طباعة</button>
        <template v-if="r.status === 'posted' && session.can(P.assetsReverse)">
          <button v-if="!r.cancelBlock" class="btn ac-glow" @click="cancel">إلغاء الحركة</button>
        </template>
      </div>
    </section>
    <div v-if="r.cancelBlock && r.status === 'posted'" class="ac-warn no-print">{{ r.cancelBlock }}</div>
    <div v-if="r.status === 'cancelled'" class="ac-warn no-print">أُلغيت هذه الحركة بواسطة {{ r.cancelledByName }} في {{ dt(r.cancelledAt) }}: {{ r.cancelReason }}</div>
    <DepReport :report="r" :title="`تقرير إهلاك الأصول الثابتة · الحركة ${r.runNo}`" :organization="session.user?.organizationName ?? ''" :status="r.status === 'posted' ? 'مرحّل' : 'ملغى'" />
  </div>
  <div v-else-if="error" class="alert alert-error">{{ error }}</div>
</template>
