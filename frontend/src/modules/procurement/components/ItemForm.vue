<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { groupTree, indent, lookups } from '../lib';

/** إضافة صنف أو تعديل بطاقته. ينبّه على الأسماء المتقاربة قبل الحفظ */
const props = defineProps<{ item?: any }>();
const emit = defineEmits<{ close: []; saved: [any] }>();
const toast = useToast();
const lk = ref<any>(null);
const busy = ref(false);
const similar = ref<any[]>([]);
const confirmSimilar = ref(false);
const i = props.item;
const f = reactive({
  name: i?.name ?? '', groupId: i?.groupId ?? '', kind: i?.kind ?? 'stock', uomId: i?.uomId ?? '', barcode: i?.barcode ?? '', description: i?.description ?? '',
  units: (i?.units ?? []).map((u: any) => ({ uomId: u.uomId, factor: u.factor, barcode: u.barcode ?? '' })) as any[],
  specs: (i?.specs ?? []).map((s: any) => ({ ...s })) as any[],
  trackBatch: i?.trackBatch ?? false, trackSerial: i?.trackSerial ?? false, trackExpiry: i?.trackExpiry ?? false, shelfLifeDays: i?.shelfLifeDays ?? null,
  minQty: i?.minQty ?? null, maxQty: i?.maxQty ?? null, reorderPoint: i?.reorderPoint ?? null, reorderQty: i?.reorderQty ?? null,
  issuePolicy: i?.issuePolicy ?? 'fifo', valuation: i?.valuation ?? '', inventoryAccountId: i?.inventoryAccountId ?? '', expenseAccountId: i?.expenseAccountId ?? '',
  refPrice: i?.refPrice ?? null,
});
onMounted(async () => {
  try {
    lk.value = await lookups();
    if (!f.uomId) f.uomId = lk.value.uoms.find((u: any) => u.isActive)?.id ?? '';
  } catch (e) {
    toast.error((e as Error).message);
  }
});
const groups = computed(() => groupTree((lk.value?.groups ?? []).filter((g: any) => g.isActive || g.id === f.groupId)));
const group = computed(() => lk.value?.groups.find((g: any) => g.id === f.groupId));
/** نوع الصنف تفرضه المجموعة: أصول وخدمات ثابتة، ومخزنية تسمح بمخزني أو مستهلك */
const kinds = computed(() => {
  const k = group.value?.kind;
  if (k === 'asset' || k === 'service') return [k];
  return ['stock', 'consumable'];
});
watch(kinds, (ks) => { if (!ks.includes(f.kind)) f.kind = ks[0]; });
const stocked = computed(() => f.kind === 'stock' || f.kind === 'consumable');
const accounts = (nature: string) => (lk.value?.accounts ?? []).filter((a: any) => a.nature === nature);

let t: ReturnType<typeof setTimeout>;
watch(() => f.name, (n) => {
  clearTimeout(t);
  confirmSimilar.value = false;
  t = setTimeout(async () => {
    similar.value = n.trim().length > 2 ? await api<any[]>(`/procurement/items-similar?name=${encodeURIComponent(n)}${i ? `&except=${i.id}` : ''}`).catch(() => []) : [];
  }, 350);
});
const num = (v: any) => (v === '' || v === null || v === undefined ? null : Number(v));
async function save() {
  if (similar.value.length && !confirmSimilar.value) return toast.error('يوجد صنف باسم قريب. راجع القائمة ثم أكّد أنه صنف مختلف');
  busy.value = true;
  try {
    const body = {
      ...f, barcode: f.barcode || null, description: f.description || null, valuation: f.valuation || null,
      inventoryAccountId: f.inventoryAccountId || null, expenseAccountId: f.expenseAccountId || null,
      units: f.units.filter((u) => u.uomId).map((u) => ({ uomId: u.uomId, factor: Number(u.factor), barcode: u.barcode || null })),
      specs: f.specs.filter((s) => s.name?.trim()),
      shelfLifeDays: f.trackExpiry ? num(f.shelfLifeDays) : null, minQty: num(f.minQty), maxQty: num(f.maxQty), reorderPoint: num(f.reorderPoint),
      reorderQty: num(f.reorderQty), refPrice: num(f.refPrice), confirmSimilar: confirmSimilar.value,
    };
    const r = i ? await api(`/procurement/items/${i.id}`, { method: 'PUT', json: body }) : await api('/procurement/items', { method: 'POST', json: body });
    toast.success(i ? 'حُفظت بطاقة الصنف' : 'أُضيف الصنف إلى الدليل');
    emit('saved', r);
    emit('close');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <form class="card modal modal-wide" @submit.prevent="save">
      <h2>{{ item ? `تعديل الصنف ${item.code}` : 'صنف جديد في الدليل' }}</h2>
      <template v-if="lk">
        <div class="pc-fields">
          <label class="field wide"><span>اسم الصنف *</span><input v-model="f.name" class="input" required minlength="2" /></label>
        </div>
        <div v-if="similar.length" class="alert alert-error">
          <b>أصناف بأسماء قريبة:</b>
          <ul style="margin: 6px 0"><li v-for="s in similar" :key="s.id"><span class="pc-code">{{ s.code }}</span> {{ s.name }} <small v-if="s.status === 'stopped'">(موقوف)</small></li></ul>
          <label><input v-model="confirmSimilar" type="checkbox" /> راجعت القائمة، وهذا صنف مختلف</label>
        </div>
        <div class="pc-fields">
          <label class="field"><span>المجموعة *</span>
            <select v-model="f.groupId" class="input" required><option value="" disabled>اختر</option><option v-for="g in groups" :key="g.id" :value="g.id">{{ indent(g.depth) }}{{ g.code }} · {{ g.name }}</option></select>
          </label>
          <label class="field"><span>نوع الصنف</span>
            <select v-model="f.kind" class="input" :disabled="kinds.length < 2"><option v-for="k in kinds" :key="k" :value="k">{{ lk.itemKinds[k] }}</option></select>
          </label>
          <label class="field"><span>وحدة القياس الأساسية *</span>
            <select v-model="f.uomId" class="input" required><option v-for="u in lk.uoms.filter((x: any) => x.isActive || x.id === f.uomId)" :key="u.id" :value="u.id">{{ u.name }}</option></select>
          </label>
          <label class="field"><span>الباركود</span><input v-model="f.barcode" class="input" dir="ltr" /></label>
          <label class="field"><span>السعر الاسترشادي</span><input v-model="f.refPrice" class="input" type="number" min="0" step="0.01" /></label>
          <label class="field wide"><span>الوصف</span><textarea v-model="f.description" class="input" rows="2" /></label>
        </div>

        <div class="pc-sec">وحدات أخرى <button type="button" class="btn btn-sm" @click="f.units.push({ uomId: '', factor: 1, barcode: '' })">+ وحدة</button></div>
        <div v-for="(u, k) in f.units" :key="k" class="pc-inline" style="margin-bottom: 6px">
          <select v-model="u.uomId" class="input"><option value="" disabled>الوحدة</option><option v-for="x in lk.uoms" :key="x.id" :value="x.id">{{ x.name }}</option></select>
          <input v-model="u.factor" class="input" type="number" min="0.0001" step="any" placeholder="كم وحدة أساسية فيها" />
          <input v-model="u.barcode" class="input" dir="ltr" placeholder="باركود الوحدة" />
          <button type="button" class="btn btn-sm" @click="f.units.splice(k, 1)">✕</button>
        </div>

        <div class="pc-sec">المواصفات <button type="button" class="btn btn-sm" @click="f.specs.push({ name: '', value: '' })">+ مواصفة</button></div>
        <div v-for="(s, k) in f.specs" :key="k" class="pc-inline" style="margin-bottom: 6px">
          <input v-model="s.name" class="input" placeholder="المواصفة (مثل: الوزن)" />
          <input v-model="s.value" class="input" placeholder="القيمة" />
          <button type="button" class="btn btn-sm" @click="f.specs.splice(k, 1)">✕</button>
        </div>

        <template v-if="stocked">
          <div class="pc-sec">التتبع والمخزون</div>
          <div class="pc-chips" style="margin-bottom: 10px">
            <label class="pc-chip"><input v-model="f.trackBatch" type="checkbox" /> رقم التشغيلة</label>
            <label class="pc-chip"><input v-model="f.trackSerial" type="checkbox" /> الرقم التسلسلي</label>
            <label class="pc-chip"><input v-model="f.trackExpiry" type="checkbox" /> تاريخ الانتهاء</label>
          </div>
          <div class="pc-fields">
            <label v-if="f.trackExpiry" class="field"><span>مدة الصلاحية (يوم)</span><input v-model="f.shelfLifeDays" class="input" type="number" min="1" /></label>
            <label class="field"><span>سياسة الصرف</span><select v-model="f.issuePolicy" class="input"><option v-for="(l, k) in lk.issuePolicy" :key="k" :value="k">{{ l }}</option></select></label>
            <label class="field"><span>الحد الأدنى</span><input v-model="f.minQty" class="input" type="number" min="0" step="any" /></label>
            <label class="field"><span>الحد الأعلى</span><input v-model="f.maxQty" class="input" type="number" min="0" step="any" /></label>
            <label class="field"><span>نقطة إعادة الطلب</span><input v-model="f.reorderPoint" class="input" type="number" min="0" step="any" /></label>
            <label class="field"><span>كمية إعادة الطلب</span><input v-model="f.reorderQty" class="input" type="number" min="0" step="any" /></label>
          </div>
        </template>

        <div class="pc-sec">المحاسبة (اتركها فارغة لتأخذ إعداد المجموعة)</div>
        <div class="pc-fields">
          <label v-if="stocked" class="field"><span>طريقة التقييم</span><select v-model="f.valuation" class="input"><option value="">حسب المجموعة</option><option v-for="(l, k) in lk.valuation" :key="k" :value="k">{{ l }}</option></select></label>
          <label v-if="f.kind !== 'service'" class="field"><span>حساب المخزون</span><select v-model="f.inventoryAccountId" class="input"><option value="">حسب المجموعة</option><option v-for="a in accounts('assets')" :key="a.id" :value="a.id">{{ a.code }} · {{ a.name }}</option></select></label>
          <label class="field"><span>حساب المصروف</span><select v-model="f.expenseAccountId" class="input"><option value="">حسب المجموعة</option><option v-for="a in accounts('expenses')" :key="a.id" :value="a.id">{{ a.code }} · {{ a.name }}</option></select></label>
        </div>
      </template>
      <div class="modal-actions">
        <button class="btn btn-primary" :disabled="busy || !lk">{{ busy ? 'جارٍ الحفظ...' : 'حفظ' }}</button>
        <button type="button" class="btn" @click="emit('close')">إلغاء</button>
      </div>
    </form>
  </div>
</template>
