<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { BL, CAT_COLOR, accLabel, billingLookups, sar } from '../lib';
import '../../projects/projects.css';
import '../../procurement/procurement.css';
import '../billing.css';

const toast = useToast();
const session = useSession();
const rows = ref<any[]>([]);
const lk = ref<any>(null);
const q = ref('');
const busy = ref(false);
const form = ref<any>(null);
const canEdit = computed(() => session.can(BL.items));
async function load() {
  try {
    rows.value = await api('/billing/items');
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(async () => {
  lk.value = await billingLookups().catch(() => null);
  await load();
});
const shown = computed(() => rows.value.filter((r) => !q.value || `${r.code} ${r.name}`.includes(q.value)));
const revenueAccounts = computed(() => (lk.value?.accounts ?? []).filter((a: any) => a.nature === 'revenue'));
const reasons = computed(() => (lk.value?.vatReasons ?? []).filter((r: any) => r.category === form.value?.vatCategory));
function edit(r?: any) {
  if (!canEdit.value) return;
  form.value = {
    id: r?.id ?? null, code: r?.code ?? '', name: r?.name ?? '', nameEn: r?.nameEn ?? '', kind: r?.kind ?? 'service', unit: r?.unit ?? '', price: r?.price ?? 0,
    vatCategory: r?.vatCategory ?? 'S', reasonCode: r?.reasonCode ?? '', revenueAccountId: r?.revenueAccountId ?? '', isActive: r?.isActive ?? true,
  };
}
async function save() {
  busy.value = true;
  try {
    const x = form.value;
    const json = {
      code: x.code || null, name: x.name, nameEn: x.nameEn || null, kind: x.kind, unit: x.unit || null, price: Number(x.price), vatCategory: x.vatCategory,
      reasonCode: x.vatCategory === 'S' ? null : x.reasonCode || null, revenueAccountId: x.revenueAccountId || null, isActive: x.isActive,
    };
    if (x.id) await api(`/billing/items/${x.id}`, { method: 'PUT', json });
    else await api('/billing/items', { method: 'POST', json });
    toast.success('حُفظ الصنف');
    form.value = null;
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>الأصناف والخدمات</h1>
        <p class="muted">ما تبيعه الجمعية من سلع وخدمات وإيجارات، بسعره وفئته الضريبية: خاضع بالنسبة الأساسية، أو بنسبة صفر، أو معفى، أو خارج النطاق، مع سبب الهيئة لغير الخاضع. ويمكن تحديد حساب إيراد لكل صنف.</p>
      </div>
      <div v-if="canEdit"><button class="btn btn-primary" @click="edit()">صنف أو خدمة جديدة</button></div>
    </div>
    <div class="pc-toolbar"><input v-model="q" class="input grow" placeholder="بحث بالرمز أو الاسم" /></div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>الرمز</th><th>الاسم</th><th>النوع</th><th>الوحدة</th><th>السعر قبل الضريبة</th><th>الفئة الضريبية</th><th>حساب الإيراد</th></tr></thead>
        <tbody>
          <tr v-for="r in shown" :key="r.id" class="pc-row" :class="{ off: !r.isActive }" @click="edit(r)">
            <td class="pc-code">{{ r.code }}</td>
            <td>{{ r.name }}</td>
            <td>{{ r.kindLabel }}</td>
            <td>{{ r.unit ?? '—' }}</td>
            <td class="pc-num">{{ sar(r.price) }}</td>
            <td><span class="pm-pill" :style="{ '--c': CAT_COLOR[r.vatCategory] }">{{ r.categoryLabel }}</span><small v-if="r.reasonLabel" class="pm-muted" style="display: block">{{ r.reasonLabel }}</small></td>
            <td style="font-size: .84rem">{{ r.revenueAccount ? accLabel(r.revenueAccount) : 'الافتراضي' }}</td>
          </tr>
          <tr v-if="!shown.length"><td colspan="7" class="pc-empty">لا توجد أصناف.</td></tr>
        </tbody>
      </table>
    </div>

    <div v-if="form && lk" class="modal-backdrop" @click.self="form = null">
      <form class="card modal" style="max-width: 640px" @submit.prevent="save">
        <h2>{{ form.id ? 'تعديل الصنف' : 'صنف أو خدمة جديدة' }}</h2>
        <div class="pc-fields">
          <label class="field"><span>الاسم</span><input v-model="form.name" class="input" required minlength="2" maxlength="250" /></label>
          <label class="field"><span>الرمز (اختياري)</span><input v-model="form.code" class="input" maxlength="30" dir="ltr" placeholder="يُولّد تلقائيًا" /></label>
          <label class="field"><span>النوع</span><select v-model="form.kind" class="input"><option v-for="(l, k) in lk.itemKinds" :key="k" :value="k">{{ l }}</option></select></label>
          <label class="field"><span>الوحدة</span><input v-model="form.unit" class="input" maxlength="40" placeholder="ساعة، يوم، شهر، حبة" /></label>
          <label class="field"><span>السعر قبل الضريبة</span><input v-model.number="form.price" type="number" min="0" step="any" class="input" required /></label>
          <label class="field"><span>الفئة الضريبية</span><select v-model="form.vatCategory" class="input"><option v-for="(l, k) in lk.vatCategories" :key="k" :value="k">{{ l }}</option></select></label>
          <label v-if="form.vatCategory !== 'S'" class="field wide"><span>السبب حسب قائمة الهيئة</span><select v-model="form.reasonCode" class="input" required><option value="">اختر…</option><option v-for="r in reasons" :key="r.code" :value="r.code">{{ r.label }} ({{ r.code }})</option></select></label>
          <label class="field wide"><span>حساب الإيراد</span><select v-model="form.revenueAccountId" class="input"><option value="">الحساب الافتراضي من الإعدادات</option><option v-for="a in revenueAccounts" :key="a.id" :value="a.id">{{ a.code }} · {{ a.name }}</option></select></label>
        </div>
        <label v-if="form.id" class="field" style="flex-direction: row; gap: 8px; align-items: center"><input v-model="form.isActive" type="checkbox" /> <span>نشط</span></label>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">حفظ</button><button type="button" class="btn" @click="form = null">رجوع</button></div>
      </form>
    </div>
  </div>
</template>
