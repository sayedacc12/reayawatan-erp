<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { KIND_COLOR, PR, accLabel, groupTree, indent, lookups } from '../lib';
import '../../../shared/module.css';
import '../procurement.css';

const session = useSession();
const toast = useToast();
const tab = ref<'groups' | 'uoms'>('groups');
const lk = ref<any>(null);
const groups = ref<any[]>([]);
const uoms = ref<any[]>([]);
const busy = ref(false);
const editing = ref<any>(null);
const newUom = ref({ name: '', symbol: '' });
const can = computed(() => session.can(PR.items));
async function load() {
  try {
    [groups.value, uoms.value] = await Promise.all([api<any[]>('/procurement/groups'), api<any[]>('/procurement/uoms')]);
    lk.value = await lookups(true);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
onMounted(load);
const tree = computed(() => groupTree(groups.value));
const accounts = (nature: string) => (lk.value?.accounts ?? []).filter((a: any) => a.nature === nature);

function open(g?: any, parentId?: string) {
  editing.value = g
    ? { id: g.id, parentId: g.parentId ?? '', code: g.code, name: g.name, kind: g.kind, inventoryAccountId: g.inventoryAccountId ?? '', expenseAccountId: g.expenseAccountId ?? '',
        assetGroupId: g.assetGroupId ?? '', valuation: g.valuation ?? '', description: g.description ?? '', isActive: g.isActive }
    : { parentId: parentId ?? '', code: '', name: '', kind: groups.value.find((x) => x.id === parentId)?.kind ?? 'stock', inventoryAccountId: '', expenseAccountId: '', assetGroupId: '', valuation: '', description: '', isActive: true };
}
async function run(fn: () => Promise<any>, ok: string) {
  busy.value = true;
  try {
    await fn();
    toast.success(ok);
    await load();
    return true;
  } catch (e) {
    toast.error((e as Error).message);
    return false;
  } finally {
    busy.value = false;
  }
}
async function saveGroup() {
  const e = editing.value;
  const body = {
    parentId: e.parentId || null, code: e.code, name: e.name, kind: e.kind, inventoryAccountId: e.inventoryAccountId || null, expenseAccountId: e.expenseAccountId || null,
    assetGroupId: e.assetGroupId || null, valuation: e.valuation || null, description: e.description || null, isActive: e.isActive,
  };
  if (await run(() => (e.id ? api(`/procurement/groups/${e.id}`, { method: 'PATCH', json: body }) : api('/procurement/groups', { method: 'POST', json: body })), 'حُفظت المجموعة')) editing.value = null;
}
const removeGroup = (g: any) => confirm(`حذف المجموعة «${g.name}»؟`) && run(() => api(`/procurement/groups/${g.id}`, { method: 'DELETE' }), 'حُذفت المجموعة');
const addUom = () => run(async () => {
  await api('/procurement/uoms', { method: 'POST', json: { name: newUom.value.name, symbol: newUom.value.symbol || null } });
  newUom.value = { name: '', symbol: '' };
}, 'أُضيفت الوحدة');
const saveUom = (u: any) => run(() => api(`/procurement/uoms/${u.id}`, { method: 'PATCH', json: { name: u.name, symbol: u.symbol || null, isActive: u.isActive } }), 'حُفظت الوحدة');
const removeUom = (u: any) => confirm(`حذف الوحدة «${u.name}»؟`) && run(() => api(`/procurement/uoms/${u.id}`, { method: 'DELETE' }), 'حُذفت الوحدة');
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>المجموعات ووحدات القياس</h1><p class="muted">مجموعات الأصناف تحدد نوعها وحساباتها وطريقة تقييمها، وكل صنف يرث من مجموعته ما لم يُحدد غيره.</p></div>
      <button v-if="can && tab === 'groups'" class="btn btn-primary" @click="open()">+ مجموعة رئيسية</button>
    </div>
    <div class="pc-tabs">
      <button :class="{ on: tab === 'groups' }" @click="tab = 'groups'">مجموعات الأصناف</button>
      <button :class="{ on: tab === 'uoms' }" @click="tab = 'uoms'">وحدات القياس</button>
    </div>

    <div v-if="tab === 'groups'" class="card table-wrap">
      <table class="table">
        <thead><tr><th>المجموعة</th><th>النوع</th><th>حساب المخزون</th><th>حساب المصروف</th><th>التقييم</th><th>الأصناف</th><th /></tr></thead>
        <tbody>
          <tr v-for="g in tree" :key="g.id" :class="{ 'pc-row': true, off: !g.isActive }">
            <td><span class="pm-muted">{{ indent(g.depth) }}</span><span class="pc-code">{{ g.code }}</span> <b>{{ g.name }}</b></td>
            <td><span class="pc-chip" :style="{ '--c': KIND_COLOR[g.kind] }">{{ g.kindLabel }}</span><small v-if="g.assetGroup" class="pm-muted" style="display: block">{{ g.assetGroup.name }}</small></td>
            <td style="font-size: .82rem">{{ accLabel(g.inventoryAccount) }}</td>
            <td style="font-size: .82rem">{{ accLabel(g.expenseAccount) }}</td>
            <td style="font-size: .82rem">{{ g.valuationLabel ?? 'حسب الإعدادات' }}</td>
            <td class="pc-num"><RouterLink :to="`/procurement/items?group=${g.id}`" class="pm-link">{{ g.items }}</RouterLink></td>
            <td v-if="can" style="white-space: nowrap">
              <button class="btn btn-sm" @click="open(undefined, g.id)">+ فرعية</button>
              <button class="btn btn-sm" @click="open(g)">تعديل</button>
              <button v-if="!g.items" class="btn btn-sm" :disabled="busy" @click="removeGroup(g)">✕</button>
            </td><td v-else />
          </tr>
        </tbody>
      </table>
    </div>

    <section v-else class="card pm-panel">
      <table class="table">
        <thead><tr><th>الوحدة</th><th>الرمز</th><th>نشطة</th><th>الأصناف</th><th /></tr></thead>
        <tbody>
          <tr v-for="u in uoms" :key="u.id">
            <td><input v-model="u.name" class="input" :disabled="!can" /></td>
            <td><input v-model="u.symbol" class="input" :disabled="!can" style="max-width: 120px" /></td>
            <td><input v-model="u.isActive" type="checkbox" :disabled="!can" /></td>
            <td class="pc-num">{{ u.items }}</td>
            <td v-if="can" style="white-space: nowrap"><button class="btn btn-sm" :disabled="busy" @click="saveUom(u)">حفظ</button> <button v-if="!u.items" class="btn btn-sm" :disabled="busy" @click="removeUom(u)">✕</button></td><td v-else />
          </tr>
        </tbody>
      </table>
      <div v-if="can" class="pc-inline" style="margin-top: 12px">
        <input v-model="newUom.name" class="input" placeholder="وحدة جديدة (مثل: كرتون)" />
        <input v-model="newUom.symbol" class="input" placeholder="الرمز" style="flex: 0 0 120px" />
        <button class="btn btn-primary btn-sm" :disabled="busy || !newUom.name.trim()" @click="addUom">إضافة</button>
      </div>
    </section>

    <div v-if="editing && lk" class="modal-backdrop" @click.self="editing = null">
      <form class="card modal modal-wide" @submit.prevent="saveGroup">
        <h2>{{ editing.id ? 'تعديل المجموعة' : 'مجموعة جديدة' }}</h2>
        <div class="pc-fields">
          <label class="field"><span>الرمز *</span><input v-model="editing.code" class="input" dir="ltr" required placeholder="FOOD" /></label>
          <label class="field"><span>الاسم *</span><input v-model="editing.name" class="input" required /></label>
          <label class="field"><span>المجموعة الأعلى</span>
            <select v-model="editing.parentId" class="input"><option value="">مجموعة رئيسية</option><option v-for="g in tree.filter((x) => x.id !== editing.id)" :key="g.id" :value="g.id">{{ indent(g.depth) }}{{ g.name }}</option></select>
          </label>
          <label class="field"><span>نوع الأصناف</span><select v-model="editing.kind" class="input"><option v-for="(l, k) in lk.itemKinds" :key="k" :value="k">{{ l }}</option></select></label>
          <label v-if="editing.kind !== 'service'" class="field"><span>حساب المخزون</span>
            <select v-model="editing.inventoryAccountId" class="input"><option value="">—</option><option v-for="a in accounts('assets')" :key="a.id" :value="a.id">{{ a.code }} · {{ a.name }}</option></select>
          </label>
          <label class="field"><span>حساب المصروف</span>
            <select v-model="editing.expenseAccountId" class="input"><option value="">—</option><option v-for="a in accounts('expenses')" :key="a.id" :value="a.id">{{ a.code }} · {{ a.name }}</option></select>
          </label>
          <label v-if="editing.kind === 'asset'" class="field"><span>مجموعة الأصول الثابتة *</span>
            <select v-model="editing.assetGroupId" class="input" required><option value="">—</option><option v-for="a in lk.assetGroups" :key="a.id" :value="a.id">{{ a.code }} · {{ a.name }}</option></select>
            <small class="pm-muted">يُنشأ الأصل في هذه المجموعة تلقائيًا عند استلام الصنف.</small>
          </label>
          <label v-if="editing.kind === 'stock' || editing.kind === 'consumable'" class="field"><span>طريقة التقييم</span>
            <select v-model="editing.valuation" class="input"><option value="">حسب الإعدادات العامة</option><option v-for="(l, k) in lk.valuation" :key="k" :value="k">{{ l }}</option></select>
          </label>
          <label class="field wide"><span>الوصف</span><input v-model="editing.description" class="input" /></label>
          <label v-if="editing.id" class="field"><span><input v-model="editing.isActive" type="checkbox" /> المجموعة نشطة</span></label>
        </div>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="busy">حفظ</button><button type="button" class="btn" @click="editing = null">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
