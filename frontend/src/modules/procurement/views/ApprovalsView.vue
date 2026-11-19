<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, reactive, ref } from 'vue';
import { api, openProtectedFile } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { PR, fmtDate, fmtDateTime, ibanView } from '../lib';
import '../../projects/projects.css';
import '../procurement.css';

const session = useSession();
const toast = useToast();
const d = ref<any>(null);
const notes = reactive<Record<string, string>>({});
const busy = ref(false);
async function load() {
  try {
    d.value = await api('/procurement/supplier-approvals');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);
async function run(fn: () => Promise<any>, ok: string) {
  busy.value = true;
  try {
    await fn();
    toast.success(ok);
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const reviewDoc = (x: any, decision: 'accept' | 'reject') => {
  const n = (notes[x.id] ?? '').trim();
  if (decision === 'reject' && n.length < 3) return toast.error('اكتب سبب رفض المستند');
  return run(() => api(`/procurement/suppliers/${x.supplierId}/docs/${x.id}/review`, { method: 'POST', json: { decision, note: n || null } }), decision === 'accept' ? 'قُبل المستند' : 'رُفض المستند');
};
const decideBank = (x: any, decision: 'approve' | 'reject') =>
  run(() => api(`/procurement/suppliers/${x.supplierId}/banks/${x.id}/decision`, { method: 'POST', json: { decision, note: (notes[x.id] ?? '').trim() || null } }), decision === 'approve' ? 'اعتُمد الحساب البنكي' : 'رُفض الحساب البنكي');
const openDoc = (x: any) => openProtectedFile(`/procurement/suppliers/${x.supplierId}/docs/${x.id}/file`).catch((e) => toast.error(e.message));
const openBank = (x: any) => openProtectedFile(`/procurement/suppliers/${x.supplierId}/banks/${x.id}/file`).catch((e) => toast.error(e.message));
</script>

<template>
  <div>
    <div class="page-head"><div><h1>طلبات اعتماد الموردين</h1><p class="muted">موردون بانتظار الاعتماد، ومستندات محدّثة، وحسابات بنكية جديدة أو معدّلة. افتح ملف المورد لمراجعته كاملًا قبل القرار.</p></div></div>
    <template v-if="d">
      <template v-if="session.can(PR.approveSuppliers)">
        <div class="pc-sec">موردون بانتظار الاعتماد ({{ d.suppliers.length }})</div>
        <div class="card table-wrap">
          <table class="table">
            <thead><tr><th>الرقم</th><th>المورد</th><th>المصدر</th><th>أُرسل</th><th>مستندات للمراجعة</th><th /></tr></thead>
            <tbody>
              <tr v-for="x in d.suppliers" :key="x.id">
                <td class="pc-code">{{ x.code }}</td><td><b>{{ x.name }}</b><small class="pm-muted" style="display: block">{{ x.city }}</small></td>
                <td>{{ x.source === 'portal' ? 'البوابة' : 'موظف' }}</td><td style="font-size: .84rem">{{ fmtDateTime(x.submittedAt) }}</td><td class="pc-num">{{ x.docsPending }}</td>
                <td><RouterLink :to="`/procurement/suppliers/${x.id}`" class="btn btn-sm btn-primary">مراجعة الملف والقرار</RouterLink></td>
              </tr>
              <tr v-if="!d.suppliers.length"><td colspan="6" class="pc-empty">لا يوجد موردون بانتظار الاعتماد ✓</td></tr>
            </tbody>
          </table>
        </div>

        <div class="pc-sec">مستندات محدّثة بانتظار المراجعة ({{ d.docs.length }})</div>
        <div class="card table-wrap">
          <table class="table">
            <thead><tr><th>المورد</th><th>المستند</th><th>الانتهاء</th><th>رُفع</th><th /></tr></thead>
            <tbody>
              <tr v-for="x in d.docs" :key="x.id">
                <td><RouterLink :to="`/procurement/suppliers/${x.supplierId}`" class="pm-link">{{ x.supplier }}</RouterLink></td>
                <td><button class="pm-link" style="background: none; border: 0; cursor: pointer; font: inherit; font-weight: 700" @click="openDoc(x)">{{ x.title }}</button></td>
                <td>{{ fmtDate(x.expiryDate) }}</td><td style="font-size: .84rem">{{ x.via === 'portal' ? 'البوابة' : 'موظف' }} · {{ fmtDateTime(x.createdAt) }}</td>
                <td style="min-width: 260px"><div class="pc-inline">
                  <input v-model="notes[x.id]" class="input" placeholder="ملاحظة" />
                  <button class="btn btn-sm btn-primary" :disabled="busy" @click="reviewDoc(x, 'accept')">قبول</button>
                  <button class="btn btn-sm" :disabled="busy" @click="reviewDoc(x, 'reject')">رفض</button>
                </div></td>
              </tr>
              <tr v-if="!d.docs.length"><td colspan="5" class="pc-empty">لا توجد مستندات بانتظار المراجعة ✓</td></tr>
            </tbody>
          </table>
        </div>
      </template>

      <template v-if="session.can(PR.approveBanks)">
        <div class="pc-sec">حسابات بنكية بانتظار الاعتماد ({{ d.banks.length }})</div>
        <div class="card table-wrap">
          <table class="table">
            <thead><tr><th>المورد</th><th>البنك والآيبان</th><th>صاحب الحساب</th><th>الطلب</th><th /></tr></thead>
            <tbody>
              <tr v-for="x in d.banks" :key="x.id">
                <td><RouterLink :to="`/procurement/suppliers/${x.supplierId}`" class="pm-link">{{ x.supplier }}</RouterLink> <span v-if="x.isChange" class="pc-warn">تغيير حساب</span></td>
                <td><b>{{ x.bankName }}</b><span class="pc-code" style="display: block">{{ ibanView(x.iban) }}</span></td>
                <td>{{ x.accountName }}</td>
                <td style="font-size: .84rem">{{ x.requestedBy }} · {{ x.via === 'portal' ? 'البوابة' : 'موظف' }}<small class="pm-muted" style="display: block">{{ fmtDateTime(x.createdAt) }}</small>
                  <button class="pm-link" style="background: none; border: 0; cursor: pointer; font: inherit; font-size: .8rem; padding: 0" @click="openBank(x)">خطاب البنك</button></td>
                <td style="min-width: 260px">
                  <p v-if="x.mine" class="pm-muted" style="font-size: .82rem; margin: 0">أنت من سجّل الطلب، فيعتمده موظف آخر.</p>
                  <div v-else class="pc-inline">
                    <input v-model="notes[x.id]" class="input" placeholder="ملاحظة" />
                    <button class="btn btn-sm btn-primary" :disabled="busy" @click="decideBank(x, 'approve')">اعتماد</button>
                    <button class="btn btn-sm" :disabled="busy" @click="decideBank(x, 'reject')">رفض</button>
                  </div>
                </td>
              </tr>
              <tr v-if="!d.banks.length"><td colspan="5" class="pc-empty">لا توجد حسابات بنكية بانتظار الاعتماد ✓</td></tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>
  </div>
</template>
