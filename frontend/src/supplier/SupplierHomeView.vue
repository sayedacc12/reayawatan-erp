<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { DOC_COLOR, SUPPLIER_COLOR, fmtDate, fmtDateTime } from '../modules/procurement/lib';
import { loadMe, me, setMe, supplierApi } from './supplier';

const route = useRoute();
const slug = route.params.slug as string;
const busy = ref(false);
const error = ref('');
const ok = ref('');
const summary = ref<{ openRfqs: number; newOrders: number } | null>(null);
onMounted(async () => {
  await loadMe(true).catch((e) => (error.value = e.message));
  if (me.value?.supplier.status === 'approved') summary.value = await supplierApi('/sourcing-summary').catch(() => null);
});
const m = computed(() => me.value);
const editable = computed(() => ['draft', 'returned'].includes(m.value?.supplier.status));
const STEP: Record<string, string> = {
  draft: 'أكمل بيانات المنشأة وارفع المستندات المطلوبة، ثم أرسل الطلب للجمعية.',
  pending: 'طلبك قيد المراجعة لدى الجمعية. سنبلغك بالبريد عند اتخاذ القرار.',
  returned: 'أعادت الجمعية الطلب لاستكمال ما يلي، ثم أعد إرساله.',
  approved: 'منشأتك مورد معتمد لدى الجمعية. حافظ على تحديث مستنداتك قبل انتهائها.',
  rejected: 'لم يُقبل طلب التسجيل.',
  suspended: 'أُوقف التعامل مع منشأتك مؤقتًا. تواصل مع الجمعية.',
};
async function submit() {
  busy.value = true;
  error.value = '';
  try {
    setMe(await supplierApi('/submit', { method: 'POST' }));
    ok.value = 'أُرسل الطلب للجمعية ✓';
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="m" class="home">
    <section class="card status" :style="{ '--c': SUPPLIER_COLOR[m.supplier.status] }">
      <div>
        <small class="pm-muted">{{ m.supplier.code }} · {{ m.supplier.entityTypeLabel }}</small>
        <h1>{{ m.supplier.name }}</h1>
        <span class="pm-pill" :style="{ '--c': SUPPLIER_COLOR[m.supplier.status] }">{{ m.supplier.statusLabel }}</span>
        <p>{{ STEP[m.supplier.status] }}</p>
        <p v-if="m.supplier.reviewNote && ['returned', 'rejected', 'suspended'].includes(m.supplier.status)" class="alert alert-error">ملاحظة الجمعية: {{ m.supplier.reviewNote }}</p>
      </div>
    </section>
    <div v-if="summary && (summary.openRfqs || summary.newOrders)" class="pc-cards" style="margin-bottom: 16px">
      <RouterLink v-if="summary.openRfqs" class="pc-kpi" :to="`/supplier/${slug}/rfqs`"><small class="pm-muted">منافسات بانتظار عرضكم</small><b style="font-size: 1.5rem">{{ summary.openRfqs }}</b></RouterLink>
      <RouterLink v-if="summary.newOrders" class="pc-kpi" :to="`/supplier/${slug}/orders`"><small class="pm-muted">تعميدات جديدة بانتظار تأكيدكم</small><b style="font-size: 1.5rem">{{ summary.newOrders }}</b></RouterLink>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="ok" class="alert alert-success">{{ ok }}</div>

    <div class="pc-grid">
      <section class="card pm-panel">
        <h2>اكتمال الملف</h2>
        <ul class="pc-check">
          <li v-for="d in m.checklist.docs" :key="d.key" :class="d.uploaded && !d.expired && d.status !== 'rejected' ? 'ok' : d.required ? 'bad' : ''">
            <span>{{ d.name }}<small v-if="d.required" class="pm-muted"> · مطلوب</small><small v-if="d.expiryDate" class="pm-muted"> · ينتهي {{ fmtDate(d.expiryDate) }}</small></span>
            <span class="st">
              <span v-if="!d.uploaded" class="pm-muted">لم يُرفع</span>
              <span v-else-if="d.expired" class="pc-flag">منتهي</span>
              <span v-else-if="d.expiring" class="pc-warn">ينتهي قريبًا</span>
              <span v-else class="pc-chip" :style="{ '--c': DOC_COLOR[d.status] }">{{ { pending: 'بانتظار المراجعة', accepted: 'مقبول', rejected: 'مرفوض' }[d.status as string] }}</span>
            </span>
          </li>
        </ul>
        <p v-if="m.checklist.missingProfile.length" class="pc-flag" style="margin-top: 8px; white-space: normal">أكمل في بيانات المنشأة: {{ m.checklist.missingProfile.join('، ') }}</p>
        <div class="pc-inline" style="margin-top: 12px">
          <RouterLink :to="`/supplier/${slug}/profile`" class="btn btn-sm">بيانات المنشأة</RouterLink>
          <RouterLink :to="`/supplier/${slug}/docs`" class="btn btn-sm">المستندات</RouterLink>
          <button v-if="editable && m.user.role === 'owner'" class="btn btn-primary" :disabled="busy || !m.checklist.complete" @click="submit">
            {{ m.supplier.status === 'returned' ? 'إعادة إرسال الطلب' : 'إرسال الطلب للجمعية' }}
          </button>
        </div>
        <p v-if="editable && !m.checklist.complete" class="pm-muted" style="font-size: .84rem">يُفعّل زر الإرسال بعد اكتمال البيانات والمستندات المطلوبة.</p>
      </section>
      <section class="card pm-panel">
        <h2>سجل الطلب</h2>
        <ul class="pc-log"><li v-for="(l, k) in m.log" :key="k"><div><b>{{ l.action }}</b> <span v-if="l.note">· {{ l.note }}</span><small>{{ fmtDateTime(l.at) }}</small></div></li></ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.status { padding: 22px 24px; margin-bottom: 16px; border-top: 4px solid var(--c); animation: rise .5s var(--ease) both; }
.status h1 { margin: 4px 0 8px; font-size: 1.5rem; }
.status p { margin: 10px 0 0; }
@keyframes rise { from { opacity: 0; transform: translateY(12px); } }
</style>
