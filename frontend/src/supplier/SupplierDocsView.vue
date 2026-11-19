<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref } from 'vue';
import { DOC_COLOR, fmtDate, fmtDateTime } from '../modules/procurement/lib';
import { canDocs, loadMe, me, openSupplierFile, setMe, supplierApi, supplierUpload } from './supplier';

const busy = ref(false);
const error = ref('');
const ok = ref('');
const doc = ref({ docType: '', number: '', issueDate: '', expiryDate: '', file: null as File | null });
const fileInput = ref<HTMLInputElement | null>(null);
onMounted(() => loadMe(true).catch((e) => (error.value = e.message)));
const m = computed(() => me.value);
const type = computed(() => m.value?.docTypes.find((d: any) => d.key === doc.value.docType));
const can = computed(() => canDocs(m.value?.user.role) && !['rejected', 'suspended'].includes(m.value?.supplier.status));
async function act(fn: () => Promise<any>, msg: string) {
  busy.value = true;
  error.value = '';
  ok.value = '';
  try {
    setMe(await fn());
    ok.value = msg;
    return true;
  } catch (e) {
    error.value = (e as Error).message;
    return false;
  } finally {
    busy.value = false;
  }
}
async function add() {
  const d = doc.value;
  if (!d.file) { error.value = 'اختر ملف المستند'; return; }
  if (await act(() => supplierUpload('/docs', d.file, { docType: d.docType, number: d.number, issueDate: d.issueDate, expiryDate: d.expiryDate }), 'رُفع المستند، وتراجعه الجمعية ✓')) {
    doc.value = { docType: '', number: '', issueDate: '', expiryDate: '', file: null };
    if (fileInput.value) fileInput.value.value = '';
  }
}
const remove = (d: any) => confirm(`حذف «${d.title}»؟`) && act(() => supplierApi(`/docs/${d.id}`, { method: 'DELETE' }), 'حُذف المستند');
const open = (d: any) => openSupplierFile(`/docs/${d.id}/file`).catch((e) => (error.value = e.message));
</script>

<template>
  <div>
    <div class="page-head"><div><h1>المستندات</h1><p class="muted">ارفع المستندات النظامية بصيغة PDF أو صورة (حتى 10 م.ب)، وحدّثها قبل انتهائها.</p></div></div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="ok" class="alert alert-success">{{ ok }}</div>
    <template v-if="m">
      <section v-if="can" class="card pm-panel" style="margin-bottom: 16px">
        <h2>رفع مستند</h2>
        <form class="pc-fields" @submit.prevent="add">
          <label class="field"><span>نوع المستند *</span><select v-model="doc.docType" class="input" required><option value="" disabled>اختر</option><option v-for="t in m.docTypes" :key="t.key" :value="t.key">{{ t.name }}{{ t.required ? ' (مطلوب)' : '' }}</option></select></label>
          <label class="field"><span>رقم المستند</span><input v-model="doc.number" class="input" dir="ltr" /></label>
          <label class="field"><span>تاريخ الإصدار</span><input v-model="doc.issueDate" class="input" type="date" /></label>
          <label v-if="type?.hasExpiry" class="field"><span>تاريخ الانتهاء *</span><input v-model="doc.expiryDate" class="input" type="date" required /></label>
          <label class="field"><span>الملف *</span><input ref="fileInput" class="input" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required @change="doc.file = ($event.target as HTMLInputElement).files?.[0] ?? null" /></label>
          <div class="field" style="justify-content: flex-end"><button class="btn btn-primary" :disabled="busy">{{ busy ? 'جارٍ الرفع...' : 'رفع' }}</button></div>
        </form>
      </section>
      <div class="card table-wrap">
        <table class="table">
          <thead><tr><th>المستند</th><th>الرقم</th><th>الانتهاء</th><th>الحالة</th><th>رُفع</th><th /></tr></thead>
          <tbody>
            <tr v-for="d in m.docs" :key="d.id" :style="{ opacity: d.isCurrent ? 1 : .55 }">
              <td><button class="pm-link" style="background: none; border: 0; cursor: pointer; font: inherit; font-weight: 700" @click="open(d)">{{ d.title }}</button><small v-if="!d.isCurrent" class="pm-muted"> (نسخة سابقة)</small></td>
              <td class="pc-code">{{ d.number ?? '—' }}</td>
              <td><span v-if="d.expired" class="pc-flag">{{ fmtDate(d.expiryDate) }}</span><span v-else-if="d.expiring" class="pc-warn">{{ fmtDate(d.expiryDate) }}</span><span v-else>{{ fmtDate(d.expiryDate) }}</span></td>
              <td><span class="pc-chip" :style="{ '--c': DOC_COLOR[d.status] }">{{ d.statusLabel }}</span><small v-if="d.reviewNote" class="pm-muted" style="display: block">{{ d.reviewNote }}</small></td>
              <td style="font-size: .82rem">{{ fmtDateTime(d.createdAt) }}</td>
              <td><button v-if="can && d.status !== 'accepted'" class="btn btn-sm" :disabled="busy" @click="remove(d)">حذف</button></td>
            </tr>
            <tr v-if="!m.docs.length"><td colspan="6" class="pc-empty">لم تُرفع مستندات بعد</td></tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
