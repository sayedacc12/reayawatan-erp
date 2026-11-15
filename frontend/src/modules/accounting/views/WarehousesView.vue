<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import SearchSelect from '../../fundraising/components/SearchSelect.vue';
import { P, sar, useAccounts } from '../lib';
import '../../projects/projects.css';
import '../acc.css';

interface Wh { id: string; name: string; type: string; description: string | null; isActive: boolean; glAccount: { id: string; code: string; name: string } | null; balance: number }
const session = useSession();
const toast = useToast();
const rows = ref<Wh[]>([]);
const types = ref<string[]>([]);
const { load: loadAccounts, subOptions } = useAccounts();
const error = ref('');
async function load() {
  try {
    const r = await api<{ types: string[]; warehouses: Wh[] }>('/accounting/warehouses');
    rows.value = r.warehouses;
    types.value = r.types;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(() => { load(); loadAccounts().catch(() => {}); });
const show = ref(false);
const editing = ref<Wh | null>(null);
const form = reactive({ name: '', type: '', description: '', glAccountId: null as string | null, isActive: true });
function openNew() {
  editing.value = null;
  Object.assign(form, { name: '', type: types.value[0] ?? '', description: '', glAccountId: null, isActive: true });
  show.value = true;
}
function openEdit(w: Wh) {
  editing.value = w;
  Object.assign(form, { name: w.name, type: w.type, description: w.description ?? '', glAccountId: w.glAccount?.id ?? null, isActive: w.isActive });
  show.value = true;
}
async function save() {
  try {
    const body = { ...form, description: form.description || null };
    if (editing.value) await api(`/accounting/warehouses/${editing.value.id}`, { method: 'PATCH', json: body });
    else await api('/accounting/warehouses', { method: 'POST', json: body });
    toast.success('تم الحفظ');
    show.value = false;
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div>
    <section class="pm-hero ac-hero">
      <div>
        <p class="pm-kicker">النظام المالي</p>
        <h1>المستودعات</h1>
        <p class="pm-sub">تعريف المستودعات وربط كل مستودع بحسابه في الدليل. أنواع المستودعات تُعرَّف من الإعدادات، وإعدادات المخزون التفصيلية تأتي لاحقًا.</p>
      </div>
      <div class="pm-actions"><button v-if="session.can(P.warehouses)" class="btn ac-glow" @click="openNew">مستودع جديد</button></div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <section class="card pm-panel">
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>المستودع</th><th>النوع</th><th>الحساب المرتبط</th><th>الرصيد</th><th></th></tr></thead>
          <tbody>
            <tr v-for="w in rows" :key="w.id" :style="{ opacity: w.isActive ? 1 : .55 }">
              <td><b>{{ w.name }}</b><span v-if="w.description" class="pm-muted" style="display: block">{{ w.description }}</span></td>
              <td><span class="pm-tag">{{ w.type }}</span></td>
              <td><span class="ac-code">{{ w.glAccount?.code }}</span> {{ w.glAccount?.name }}</td>
              <td class="pm-money">{{ sar(w.balance) }}</td>
              <td><button v-if="session.can(P.warehouses)" class="btn btn-sm" @click="openEdit(w)">تعديل</button></td>
            </tr>
            <tr v-if="!rows.length"><td colspan="5" class="pm-empty">لا توجد مستودعات</td></tr>
          </tbody>
        </table>
      </div>
    </section>
    <div v-if="show" class="modal-backdrop" @click.self="show = false">
      <form class="card modal" @submit.prevent="save">
        <h2>{{ editing ? 'تعديل مستودع' : 'مستودع جديد' }}</h2>
        <label class="field"><span>الاسم</span><input v-model="form.name" class="input" required /></label>
        <label class="field"><span>النوع</span><select v-model="form.type" class="input" required><option v-for="t in types" :key="t" :value="t">{{ t }}</option></select></label>
        <label class="field"><span>الحساب المرتبط في الدليل</span>
          <SearchSelect v-model="form.glAccountId" :options="subOptions((a) => a.nature === 'assets')" :selected-label="editing?.glAccount ? `${editing.glAccount.code} ${editing.glAccount.name}` : ''" placeholder="ابحث في حسابات الأصول" required />
        </label>
        <label class="field"><span>الوصف</span><textarea v-model="form.description" class="input" rows="2" /></label>
        <label class="check" style="display: flex; gap: 8px"><input v-model="form.isActive" type="checkbox" /> نشط</label>
        <div class="modal-actions"><button class="btn btn-primary">حفظ</button><button type="button" class="btn" @click="show = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
