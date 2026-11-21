<script setup lang="ts">
/** تسجيل صيانة على أصل (وقائية أو إصلاح عطل)، مع سند صرف اختياري */
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import SearchSelect from '../../../shared/SearchSelect.vue';
import { AF, useLookups, type AssetRow, type MaintRecord } from '../assets';
import { todayStr } from '../lib';

const props = defineProps<{ assetId?: string | null; assetLabel?: string; kind?: 'preventive' | 'repair' }>();
const emit = defineEmits<{ saved: [r: MaintRecord]; close: [] }>();
const toast = useToast();
const { lookups, load: loadLookups } = useLookups();
const assets = ref<AssetRow[]>([]);
const busy = ref(false);
const f = reactive({
  assetId: props.assetId ?? null as string | null, kind: props.kind ?? 'repair' as 'preventive' | 'repair', date: todayStr(), description: '', vendor: '',
  cost: null as number | null, downtimeDays: 0, notes: '', pay: false, method: 'bank' as 'cash' | 'bank' | 'credit', cashAccountId: '', partnerId: '',
});
onMounted(async () => {
  loadLookups().catch(() => {});
  if (!props.assetId) assets.value = await api<AssetRow[]>(AF).catch(() => []);
});
const assetOptions = computed(() => assets.value.filter((a) => ['draft', 'construction', 'pending_purchase', 'active', 'pending_sale'].includes(a.status))
  .map((a) => ({ id: a.id, label: `${a.code} ${a.name}`, sub: `${a.groupName}${a.custodianName ? ` · ${a.custodianName}` : ''}` })));
const cashList = computed(() => (lookups.value?.cash ?? []).filter((c) => c.kind === (f.method === 'bank' ? 'bank' : 'cash')));
const noAccount = computed(() => f.pay && !lookups.value?.config.maintenanceAccountId);

async function save() {
  busy.value = true;
  try {
    const r = await api<MaintRecord>(`${AF}/maintenance`, {
      method: 'POST',
      json: {
        ...f, vendor: f.vendor || null, notes: f.notes || null, cost: f.cost ?? 0,
        cashAccountId: f.pay && f.method !== 'credit' ? f.cashAccountId : null, partnerId: f.pay && f.method === 'credit' ? f.partnerId : null,
      },
    });
    toast.success(f.pay ? 'سُجلت الصيانة وصدر سند الصرف' : 'سُجلت الصيانة');
    emit('saved', r);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <form class="card modal" @submit.prevent="save">
      <h2>تسجيل صيانة</h2>
      <p class="fa-sub">{{ assetLabel ? `الأصل: ${assetLabel}` : 'اختر الأصل ونوع الصيانة' }}. الصيانة الوقائية تحدّث موعد الصيانة القادم في خطة الأصل.</p>
      <label v-if="!assetId" class="field"><span>الأصل</span><SearchSelect v-model="f.assetId" :options="assetOptions" placeholder="ابحث برمز الأصل أو اسمه" required /></label>
      <div class="field"><span>نوع الصيانة</span>
        <div class="ac-switch">
          <button type="button" :class="{ on: f.kind === 'preventive' }" @click="f.kind = 'preventive'">وقائية (دورية)</button>
          <button type="button" :class="{ on: f.kind === 'repair' }" @click="f.kind = 'repair'">إصلاح عطل</button>
        </div>
      </div>
      <label class="field"><span>{{ f.kind === 'repair' ? 'وصف العطل والإصلاح' : 'ما تم في الصيانة' }}</span><input v-model="f.description" class="input" maxlength="1000" required /></label>
      <div class="field-row">
        <label class="field"><span>التاريخ</span><input v-model="f.date" type="date" class="input" :max="todayStr()" required /></label>
        <label class="field"><span>الجهة المنفذة (اختياري)</span><input v-model="f.vendor" class="input" maxlength="250" /></label>
      </div>
      <div class="field-row">
        <label class="field"><span>التكلفة</span><input v-model.number="f.cost" type="number" min="0" step="0.01" class="input" /></label>
        <label class="field"><span>أيام توقف الأصل</span><input v-model.number="f.downtimeDays" type="number" min="0" max="3650" class="input" /></label>
      </div>
      <label class="field"><span>ملاحظات</span><input v-model="f.notes" class="input" maxlength="1000" /></label>
      <label class="fa-check"><input v-model="f.pay" type="checkbox" /> إصدار سند صرف بالتكلفة (مصروف صيانة)</label>
      <template v-if="f.pay">
        <div class="field-row">
          <label class="field"><span>طريقة السداد</span>
            <select v-model="f.method" class="input"><option value="bank">بنكي</option><option value="cash">نقدي</option><option value="credit">آجل على المورد</option></select></label>
          <label v-if="f.method !== 'credit'" class="field"><span>{{ f.method === 'bank' ? 'الحساب البنكي' : 'الصندوق' }}</span>
            <select v-model="f.cashAccountId" class="input" required><option value="" disabled>اختر</option><option v-for="c in cashList" :key="c.id" :value="c.id">{{ c.name }}</option></select></label>
          <label v-else class="field"><span>المورد</span>
            <select v-model="f.partnerId" class="input" required><option value="" disabled>اختر</option><option v-for="p in lookups?.partners ?? []" :key="p.id" :value="p.id">{{ p.name }}</option></select></label>
        </div>
        <p v-if="noAccount" class="ac-warn">حدد حساب مصروف الصيانة في إعدادات الأصول الثابتة أولًا.</p>
        <p class="fa-sub">يصدر السند مسودة ويمر بمراحل اعتماد السندات المعتادة.</p>
      </template>
      <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">حفظ</button><button type="button" class="btn" @click="emit('close')">إلغاء</button></div>
    </form>
  </div>
</template>

<style scoped>
.fa-check { display: flex; gap: 8px; align-items: center; margin: 8px 0; }
</style>
