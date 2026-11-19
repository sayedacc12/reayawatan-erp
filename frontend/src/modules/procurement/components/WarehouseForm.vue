<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { lookups } from '../lib';

const props = defineProps<{ warehouse?: any; warehouses: any[] }>();
const emit = defineEmits<{ close: []; saved: [any] }>();
const toast = useToast();
const lk = ref<any>(null);
const busy = ref(false);
const w = props.warehouse;
const f = reactive({
  code: w?.code ?? '', name: w?.name ?? '', kind: w?.kind ?? 'main', parentId: w?.parentId ?? '', unitId: w?.unitId ?? '', projectId: w?.projectId ?? '',
  city: w?.city ?? '', address: w?.address ?? '', keeperIds: [...(w?.keeperIds ?? [])] as string[], glAccountId: w?.glAccountId ?? '', capacity: w?.capacity ?? '',
  notes: w?.notes ?? '', isActive: w?.isActive ?? true,
});
onMounted(async () => {
  try {
    lk.value = await lookups();
  } catch (e) {
    toast.error((e as Error).message);
  }
});
const parents = computed(() => props.warehouses.filter((x) => x.id !== w?.id && x.parentId !== w?.id));
const needsAccount = computed(() => lk.value?.settings.accountLevel === 'warehouse');
function toggleKeeper(id: string) {
  f.keeperIds = f.keeperIds.includes(id) ? f.keeperIds.filter((x) => x !== id) : [...f.keeperIds, id];
}
async function save() {
  busy.value = true;
  try {
    const body = {
      ...f, code: f.code || undefined, parentId: f.kind === 'main' ? null : f.parentId || null, unitId: f.unitId || null, projectId: f.projectId || null,
      city: f.city || null, address: f.address || null, glAccountId: f.glAccountId || null, capacity: f.capacity || null, notes: f.notes || null,
    };
    const r = w ? await api(`/procurement/warehouses/${w.id}`, { method: 'PUT', json: body }) : await api('/procurement/warehouses', { method: 'POST', json: body });
    toast.success(w ? 'حُفظ المستودع' : 'أُضيف المستودع');
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
      <h2>{{ warehouse ? `تعديل ${warehouse.name}` : 'مستودع جديد' }}</h2>
      <div v-if="lk" class="pc-fields">
        <label class="field"><span>اسم المستودع *</span><input v-model="f.name" class="input" required minlength="2" /></label>
        <label class="field"><span>الرمز</span><input v-model="f.code" class="input" dir="ltr" placeholder="تلقائي (WH-01)" /></label>
        <label class="field"><span>النوع</span><select v-model="f.kind" class="input"><option v-for="(l, k) in lk.warehouseKinds" :key="k" :value="k">{{ l }}</option></select></label>
        <label v-if="f.kind !== 'main'" class="field"><span>يتبع المستودع</span>
          <select v-model="f.parentId" class="input"><option value="">لا يتبع مستودعًا</option><option v-for="p in parents" :key="p.id" :value="p.id">{{ p.code }} · {{ p.name }}</option></select>
        </label>
        <label class="field"><span>الإدارة أو الفرع</span><select v-model="f.unitId" class="input"><option value="">—</option><option v-for="u in lk.units" :key="u.id" :value="u.id">{{ u.name }}</option></select></label>
        <label class="field"><span>المشروع (للمستودع الميداني)</span><select v-model="f.projectId" class="input"><option value="">—</option><option v-for="p in lk.projects" :key="p.id" :value="p.id">{{ p.code }} · {{ p.name }}</option></select></label>
        <label class="field"><span>المدينة</span><input v-model="f.city" class="input" /></label>
        <label class="field"><span>السعة</span><input v-model="f.capacity" class="input" placeholder="مثل: 500 م² أو 40 منصة" /></label>
        <label class="field wide"><span>العنوان</span><input v-model="f.address" class="input" /></label>
        <label class="field wide"><span>حساب المخزون {{ needsAccount ? '*' : '(اختياري، وإلا يُؤخذ من مجموعة الصنف)' }}</span>
          <select v-model="f.glAccountId" class="input" :required="needsAccount"><option value="">—</option><option v-for="a in lk.accounts.filter((x: any) => x.nature === 'assets')" :key="a.id" :value="a.id">{{ a.code }} · {{ a.name }}</option></select>
        </label>
        <div class="field wide"><span>أمناء المستودع</span>
          <div class="pc-chips"><button v-for="u in lk.users" :key="u.id" type="button" :class="['pc-chip', { on: f.keeperIds.includes(u.id) }]" @click="toggleKeeper(u.id)">{{ u.fullName }}</button></div>
        </div>
        <label class="field wide"><span>ملاحظات</span><textarea v-model="f.notes" class="input" rows="2" /></label>
        <label v-if="warehouse" class="field"><span><input v-model="f.isActive" type="checkbox" /> المستودع نشط</span></label>
      </div>
      <div class="modal-actions">
        <button class="btn btn-primary" :disabled="busy || !lk">{{ busy ? 'جارٍ الحفظ...' : 'حفظ' }}</button>
        <button type="button" class="btn" @click="emit('close')">إلغاء</button>
      </div>
    </form>
  </div>
</template>
