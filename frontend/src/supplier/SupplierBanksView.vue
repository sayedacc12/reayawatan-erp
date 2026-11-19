<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref } from 'vue';
import { BANK_COLOR, fmtDateTime, ibanView } from '../modules/procurement/lib';
import { canBanks, loadMe, me, setMe, supplierUpload } from './supplier';

const busy = ref(false);
const error = ref('');
const ok = ref('');
const f = ref({ bankName: '', iban: '', accountName: '', file: null as File | null });
const fileInput = ref<HTMLInputElement | null>(null);
onMounted(() => loadMe(true).catch((e) => (error.value = e.message)));
const m = computed(() => me.value);
const can = computed(() => canBanks(m.value?.user.role) && !['rejected', 'suspended'].includes(m.value?.supplier.status));
const pending = computed(() => (m.value?.banks ?? []).some((b: any) => b.status === 'pending'));
async function send() {
  if (!f.value.file) { error.value = 'أرفق خطاب البنك أو شهادة الآيبان'; return; }
  busy.value = true;
  error.value = '';
  ok.value = '';
  try {
    setMe(await supplierUpload('/banks', f.value.file, { bankName: f.value.bankName, iban: f.value.iban, accountName: f.value.accountName }));
    ok.value = 'أُرسل الطلب، ويُعتمد الحساب بعد مراجعة الجمعية ✓';
    f.value = { bankName: '', iban: '', accountName: '', file: null };
    if (fileInput.value) fileInput.value.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <div class="page-head"><div><h1>الحساب البنكي</h1><p class="muted">الحساب الذي تُحوَّل عليه المستحقات. أي تغيير فيه لا يُعتمد إلا بعد تحقق الجمعية من خطاب البنك.</p></div></div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="ok" class="alert alert-success">{{ ok }}</div>
    <template v-if="m">
      <div class="card table-wrap" style="margin-bottom: 16px">
        <table class="table">
          <thead><tr><th>البنك</th><th>الآيبان</th><th>صاحب الحساب</th><th>الحالة</th><th>التاريخ</th></tr></thead>
          <tbody>
            <tr v-for="b in m.banks" :key="b.id">
              <td><b>{{ b.bankName }}</b> <span v-if="b.isPrimary" class="pc-okflag">الرئيسي</span></td>
              <td class="pc-code">{{ ibanView(b.iban) }}</td><td>{{ b.accountName }}</td>
              <td><span class="pc-chip" :style="{ '--c': BANK_COLOR[b.status] }">{{ b.statusLabel }}</span><small v-if="b.decisionNote" class="pm-muted" style="display: block">{{ b.decisionNote }}</small></td>
              <td style="font-size: .82rem">{{ fmtDateTime(b.decidedAt ?? b.createdAt) }}</td>
            </tr>
            <tr v-if="!m.banks.length"><td colspan="5" class="pc-empty">لم يُسجل حساب بنكي بعد</td></tr>
          </tbody>
        </table>
      </div>
      <section v-if="can" class="card pm-panel">
        <h2>{{ m.banks.some((b: any) => b.status === 'approved') ? 'طلب تغيير الحساب البنكي' : 'تسجيل الحساب البنكي' }}</h2>
        <p v-if="pending" class="alert alert-info">لديك طلب بانتظار الاعتماد. يمكنك إرسال طلب آخر إن كان فيه خطأ.</p>
        <form class="pc-fields" @submit.prevent="send">
          <label class="field"><span>البنك *</span><input v-model="f.bankName" class="input" required /></label>
          <label class="field"><span>رقم الآيبان *</span><input v-model="f.iban" class="input" dir="ltr" required placeholder="SA00 0000 0000 0000 0000 0000" /></label>
          <label class="field"><span>اسم صاحب الحساب كما في البنك *</span><input v-model="f.accountName" class="input" required /></label>
          <label class="field"><span>خطاب البنك أو شهادة الآيبان *</span><input ref="fileInput" class="input" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required @change="f.file = ($event.target as HTMLInputElement).files?.[0] ?? null" /></label>
          <div class="field" style="justify-content: flex-end"><button class="btn btn-primary" :disabled="busy">إرسال للاعتماد</button></div>
        </form>
      </section>
    </template>
  </div>
</template>
