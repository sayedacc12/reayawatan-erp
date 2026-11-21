<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { fmtQty, lookups, stockLookups, today } from '../lib';
import '../../../shared/module.css';
import '../procurement.css';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const kind = ref<'transfer' | 'writeoff'>(route.query.kind === 'writeoff' ? 'writeoff' : 'transfer');
const lk = ref<any>(null);
const slk = ref<any>(null);
const stock = ref<any[]>([]);
const busy = ref(false);
const form = ref<any>({ warehouseId: String(route.query.warehouse ?? ''), toWarehouseId: '', date: today(), reason: 'expired', notes: '', lines: [] as any[] });
const blank = () => ({ itemId: '', qty: 0, lot: '', toLocationId: '', lots: [] as any[] });

onMounted(async () => {
  try {
    [lk.value, slk.value] = await Promise.all([lookups(), stockLookups()]);
    form.value.lines = [blank()];
    if (form.value.warehouseId) await loadStock();
  } catch (e) {
    toast.error((e as Error).message);
  }
});
async function loadStock() {
  stock.value = [];
  form.value.lines = [blank()];
  if (!form.value.warehouseId) return;
  const r = await api<any>(`/procurement/stock?warehouse=${form.value.warehouseId}${kind.value === 'writeoff' && route.query.alert === 'expiry' ? '&alert=expiry' : ''}`);
  stock.value = r.rows.filter((x: any) => x.qty > 0);
}
watch(() => form.value.warehouseId, loadStock);
async function pickItem(l: any) {
  l.lot = '';
  l.lots = l.itemId ? await api<any[]>(`/procurement/stock/lots?item=${l.itemId}&warehouse=${form.value.warehouseId}`).catch(() => []) : [];
  const s = stock.value.find((x) => x.itemId === l.itemId);
  if (kind.value === 'writeoff') {
    const exp = l.lots.find((x: any) => x.expired);
    if (exp) {
      l.lot = exp.lot ?? '';
      l.qty = exp.qty;
      if (!exp.lot) l.qty = l.lots.filter((x: any) => x.expired).reduce((t: number, x: any) => t + x.qty, 0);
      return;
    }
  }
  l.qty = s?.qty ?? 0;
}
const toLocations = computed(() => (slk.value?.locations ?? []).filter((x: any) => x.warehouseId === (form.value.toWarehouseId || form.value.warehouseId)));
const lotQty = (l: any) => (l.lot ? l.lots.filter((x: any) => x.lot === l.lot).reduce((t: number, x: any) => t + x.qty, 0) : stock.value.find((x) => x.itemId === l.itemId)?.qty ?? 0);

async function save() {
  busy.value = true;
  const f = form.value;
  const lines = f.lines.filter((l: any) => l.itemId && Number(l.qty) > 0).map((l: any) => ({
    itemId: l.itemId, qty: Number(l.qty), lot: l.lot || null, toLocationId: kind.value === 'transfer' ? l.toLocationId || null : null,
  }));
  try {
    const d = kind.value === 'transfer'
      ? await api<any>('/procurement/stock-docs/transfer', { method: 'POST', json: { warehouseId: f.warehouseId, toWarehouseId: f.toWarehouseId, date: f.date, notes: f.notes || null, lines } })
      : await api<any>('/procurement/stock-docs/writeoff', { method: 'POST', json: { warehouseId: f.warehouseId, date: f.date, reason: f.reason, notes: f.notes, lines } });
    toast.success(kind.value === 'transfer' ? `صدر سند التحويل ${d.code}` : `سُجل محضر الإتلاف ${d.code} وينتظر الاعتماد`);
    router.push(`/procurement/stock-docs/${d.id}`);
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
      <div>
        <h1>{{ kind === 'transfer' ? 'تحويل بين المستودعات' : 'محضر إتلاف وشطب' }}</h1>
        <p class="muted">
          {{ kind === 'transfer'
            ? 'ينقل الكمية بتكلفتها نفسها وتشغيلتها وصلاحيتها. ويصدر قيد إذا اختلف حساب المخزون بين المستودعين. وللنقل بين مواقع المستودع نفسه اختر المستودع نفسه وحدد الموقع.'
            : 'للأصناف المنتهية أو التالفة أو المفقودة. لا يخرج من الرصيد إلا بعد اعتماد مسؤول آخر، ويُحمّل على حساب فروقات المخزون.' }}
        </p>
      </div>
    </div>
    <form class="pc-grid" style="grid-template-columns: minmax(0, 1fr)" @submit.prevent="save">
      <section class="card pm-panel">
        <div class="pc-fields">
          <label class="field"><span>{{ kind === 'transfer' ? 'من المستودع' : 'المستودع' }}</span>
            <select v-model="form.warehouseId" class="input" required><option value="">اختر…</option><option v-for="w in lk.activeWarehouses" :key="w.id" :value="w.id">{{ w.code }} · {{ w.name }}</option></select>
          </label>
          <label v-if="kind === 'transfer'" class="field"><span>إلى المستودع</span>
            <select v-model="form.toWarehouseId" class="input" required><option value="">اختر…</option><option v-for="w in lk.activeWarehouses" :key="w.id" :value="w.id">{{ w.code }} · {{ w.name }}</option></select>
          </label>
          <label class="field"><span>التاريخ</span><input v-model="form.date" type="date" class="input" :max="today()" required /></label>
          <label v-if="kind === 'writeoff'" class="field"><span>السبب</span>
            <select v-model="form.reason" class="input"><option v-for="(t, k) in slk?.writeoffReasons ?? {}" :key="k" :value="k">{{ t }}</option></select>
          </label>
        </div>
      </section>
      <section v-if="form.warehouseId" class="card pm-panel">
        <h2>الأصناف</h2>
        <table class="pc-lines">
          <thead><tr><th>الصنف</th><th style="width: 200px">التشغيلة</th><th>المتاح</th><th style="width: 110px">الكمية</th><th v-if="kind === 'transfer' && toLocations.length" style="width: 150px">إلى الموقع</th><th /></tr></thead>
          <tbody>
            <tr v-for="(l, i) in form.lines" :key="i">
              <td>
                <select v-model="l.itemId" class="input" required @change="pickItem(l)">
                  <option value="">اختر الصنف…</option>
                  <option v-for="s in stock" :key="s.itemId" :value="s.itemId">{{ s.code }} · {{ s.name }} ({{ fmtQty(s.qty) }} {{ s.uomName }})</option>
                </select>
              </td>
              <td>
                <select v-if="l.lots.some((x: any) => x.lot)" v-model="l.lot" class="input">
                  <option value="">{{ kind === 'writeoff' ? 'الأقدم أولًا' : 'تلقائي' }}</option>
                  <option v-for="x in l.lots.filter((y: any) => y.lot)" :key="`${x.lot}-${x.expiryDate}-${x.locationId}`" :value="x.lot">{{ x.lot }} · {{ fmtQty(x.qty) }}{{ x.expiryDate ? ` · ${x.expiryDate}` : '' }}{{ x.expired ? ' (منتهي)' : '' }}</option>
                </select>
                <span v-else class="pm-muted" style="font-size: .8rem">{{ l.lots.some((x: any) => x.expired) ? 'فيه كميات منتهية' : '—' }}</span>
              </td>
              <td class="pc-num">{{ fmtQty(lotQty(l)) }}</td>
              <td><input v-model.number="l.qty" type="number" min="0.001" step="any" class="input" required /></td>
              <td v-if="kind === 'transfer' && toLocations.length">
                <select v-model="l.toLocationId" class="input" :required="form.toWarehouseId === form.warehouseId"><option value="">—</option><option v-for="x in toLocations" :key="x.id" :value="x.id">{{ x.code }} · {{ x.name }}</option></select>
              </td>
              <td><button type="button" class="btn btn-ghost" @click="form.lines.splice(i, 1)">✕</button></td>
            </tr>
          </tbody>
        </table>
        <button type="button" class="btn" style="margin-top: 8px" @click="form.lines.push(blank())">+ صنف</button>
      </section>
      <section class="card pm-panel">
        <label class="field">
          <span>{{ kind === 'writeoff' ? 'تفاصيل الإتلاف ومحضره (اللجنة وطريقة الإتلاف)' : 'ملاحظات' }}</span>
          <textarea v-model="form.notes" class="input" rows="3" :required="kind === 'writeoff'" :minlength="kind === 'writeoff' ? 3 : 0" />
        </label>
        <div class="pc-inline" style="margin-top: 12px">
          <button class="btn btn-primary" :disabled="busy">{{ kind === 'transfer' ? 'تنفيذ التحويل' : 'رفع المحضر للاعتماد' }}</button>
          <button type="button" class="btn" @click="router.back()">رجوع</button>
        </div>
      </section>
    </form>
  </div>
</template>
