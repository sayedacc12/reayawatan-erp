<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { lookups, stockLookups } from '../lib';
import '../../../shared/module.css';
import '../procurement.css';

const props = defineProps<{ id?: string }>();
const router = useRouter();
const toast = useToast();
const lk = ref<any>(null);
const slk = ref<any>(null);
const items = ref<any[]>([]);
const busy = ref(false);
const form = ref<any>({
  warehouseId: '', purpose: '', unitId: '', projectId: '', fundingBatchId: '', analyticId: '', beneficiaryRef: '', receiverName: '', neededBy: '', lines: [] as any[],
});
const blank = () => ({ id: undefined, itemId: '', qty: 1, note: '' });

onMounted(async () => {
  try {
    const [l, s, it] = await Promise.all([lookups(), stockLookups(), api<any[]>('/procurement/items?status=active')]);
    lk.value = l;
    slk.value = s;
    items.value = it.filter((x) => x.kind === 'stock' || x.kind === 'consumable');
    if (props.id) {
      const r = await api<any>(`/procurement/issue-requests/${props.id}`);
      form.value = {
        warehouseId: r.warehouseId, purpose: r.purpose, unitId: r.unitId ?? '', projectId: r.projectId ?? '', fundingBatchId: r.fundingBatchId ?? '', analyticId: r.analyticId ?? '',
        beneficiaryRef: r.beneficiaryRef ?? '', receiverName: r.receiverName ?? '', neededBy: r.neededBy ?? '',
        lines: r.lines.map((x: any) => ({ id: x.id, itemId: x.itemId, qty: x.qty, note: x.note ?? '' })),
      };
    } else {
      form.value.lines = [blank()];
      if (l.activeWarehouses.length === 1) form.value.warehouseId = l.activeWarehouses[0].id;
    }
  } catch (e) {
    toast.error((e as Error).message);
  }
});

async function save(andSubmit = false) {
  busy.value = true;
  const f = form.value;
  const nul = (v: string) => (v ? v : null);
  const body = {
    warehouseId: f.warehouseId, purpose: f.purpose, unitId: nul(f.unitId), projectId: nul(f.projectId), fundingBatchId: nul(f.fundingBatchId), analyticId: nul(f.analyticId),
    beneficiaryRef: nul(f.beneficiaryRef), receiverName: nul(f.receiverName), neededBy: nul(f.neededBy),
    lines: f.lines.filter((l: any) => l.itemId && Number(l.qty) > 0).map((l: any) => ({ id: l.id, itemId: l.itemId, qty: Number(l.qty), note: nul(l.note) })),
  };
  try {
    let r: any;
    if (props.id) {
      r = await api<any>(`/procurement/issue-requests/${props.id}`, { method: 'PUT', json: body });
      if (andSubmit) r = await api<any>(`/procurement/issue-requests/${props.id}/submit`, { method: 'POST', json: {} });
    } else r = await api<any>(`/procurement/issue-requests${andSubmit ? '?submit=1' : ''}`, { method: 'POST', json: body });
    toast.success(andSubmit ? `أُرسل طلب الصرف ${r.code} للاعتماد` : `حُفظ طلب الصرف ${r.code}`);
    router.push(`/procurement/issue-requests/${r.id}`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="lk">
    <div class="page-head">
      <div><h1>{{ id ? 'تعديل طلب الصرف' : 'طلب صرف جديد' }}</h1><p class="muted">اطلب المواد من المستودع، وحدد الجهة التي يُحمّل عليها المصروف. يعتمد الطلب مختص غير مقدمه، ثم يصرفه أمين المستودع.</p></div>
    </div>
    <form class="pc-grid" style="grid-template-columns: minmax(0, 2fr) minmax(0, 1fr)" @submit.prevent="save(false)">
      <div style="display: grid; gap: 16px; align-content: start">
        <section class="card pm-panel">
          <div class="pc-fields">
            <label class="field" style="grid-column: 1 / -1"><span>الغرض من الصرف</span><input v-model="form.purpose" class="input" required minlength="3" maxlength="250" placeholder="مثل: توزيع سلال غذائية على أسر البرنامج" /></label>
            <label class="field"><span>المستودع</span><select v-model="form.warehouseId" class="input" required><option value="">اختر…</option><option v-for="w in lk.activeWarehouses" :key="w.id" :value="w.id">{{ w.code }} · {{ w.name }}</option></select></label>
            <label class="field"><span>الإدارة الطالبة</span><select v-model="form.unitId" class="input"><option value="">—</option><option v-for="u in lk.units" :key="u.id" :value="u.id">{{ u.name }}</option></select></label>
            <label class="field"><span>المستلم</span><input v-model="form.receiverName" class="input" maxlength="200" /></label>
            <label class="field"><span>مطلوب قبل</span><input v-model="form.neededBy" type="date" class="input" /></label>
            <label class="field"><span>مرجع المستفيد (اختياري)</span><input v-model="form.beneficiaryRef" class="input" maxlength="120" placeholder="رقم الملف أو الطلب فقط" /></label>
          </div>
        </section>
        <section class="card pm-panel">
          <h2>الأصناف</h2>
          <table class="pc-lines">
            <thead><tr><th>الصنف</th><th style="width: 110px">الكمية</th><th>ملاحظة</th><th /></tr></thead>
            <tbody>
              <tr v-for="(l, i) in form.lines" :key="i">
                <td><select v-model="l.itemId" class="input" required><option value="">اختر الصنف…</option><option v-for="it in items" :key="it.id" :value="it.id">{{ it.code }} · {{ it.name }} ({{ it.uom }})</option></select></td>
                <td><input v-model.number="l.qty" type="number" min="0.001" step="any" class="input" required /></td>
                <td><input v-model="l.note" class="input" maxlength="500" /></td>
                <td><button type="button" class="btn btn-ghost" @click="form.lines.splice(i, 1)">✕</button></td>
              </tr>
            </tbody>
          </table>
          <button type="button" class="btn" style="margin-top: 8px" @click="form.lines.push(blank())">+ صنف</button>
        </section>
      </div>
      <div style="display: grid; gap: 16px; align-content: start">
        <section class="card pm-panel">
          <h2>تحميل المصروف</h2>
          <label class="field"><span>مركز التكلفة</span><select v-model="form.analyticId" class="input"><option value="">—</option><option v-for="x in slk?.analytics ?? []" :key="x.id" :value="x.id">{{ x.code }} · {{ x.name }}</option></select></label>
          <label class="field"><span>المشروع أو البرنامج</span><select v-model="form.projectId" class="input"><option value="">—</option><option v-for="p in lk.projects" :key="p.id" :value="p.id">{{ p.code }} · {{ p.name }}</option></select></label>
          <label class="field"><span>مصدر التمويل</span><select v-model="form.fundingBatchId" class="input"><option value="">—</option><option v-for="b in slk?.funding ?? []" :key="b.id" :value="b.id">الدفعة {{ b.batchNo }} · {{ b.targetName }}</option></select></label>
          <p class="pm-muted" style="font-size: .78rem">يُصرف بتكلفة المخزون، ويُقيد المصروف على مركز التكلفة، ويُسجل المشروع ومصدر التمويل على سند الصرف لتقاريرهما.</p>
        </section>
        <div class="pc-inline">
          <button class="btn" :disabled="busy">حفظ مسودة</button>
          <button type="button" class="btn btn-primary" :disabled="busy" @click="save(true)">حفظ وإرسال للاعتماد</button>
          <button type="button" class="btn btn-ghost" @click="router.back()">إلغاء</button>
        </div>
      </div>
    </form>
  </div>
</template>
