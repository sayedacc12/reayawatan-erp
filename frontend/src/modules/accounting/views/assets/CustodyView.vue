<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../../api';
import { useToast } from '../../../../stores/toast';
import { AF, type AssetRow, type CustodyForm } from '../../assets';
import { sar } from '../../lib';
import '../../../../shared/module.css';
import '../../acc.css';
import './assets.css';

interface EmpRow { employeeId: string; name: string; employeeNo: number; unitName: string | null; employeeStatus: string; assets: number; cost: number; nbv: number; unconfirmed: number }
const toast = useToast();
const board = ref<{ employees: EmpRow[]; withoutCustodian: number; recent: CustodyForm[] } | null>(null);
const error = ref('');
const q = ref('');
const sel = ref<EmpRow | null>(null);
const detail = ref<{ held: AssetRow[]; forms: CustodyForm[] } | null>(null);
async function load() {
  try {
    board.value = await api(`${AF}/custody`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
const shown = computed(() => (board.value?.employees ?? []).filter((e) => !q.value || e.name.includes(q.value)));
async function open(e: EmpRow) {
  sel.value = e;
  detail.value = null;
  detail.value = await api(`${AF}/custody/employee/${e.employeeId}`);
}
async function confirmForm(id: string) {
  try {
    await api(`${AF}/custody/forms/${id}/confirm`, { method: 'POST' });
    toast.success('تم تأكيد الاستلام');
    await load();
    if (sel.value) await open(sel.value);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div>
    <section class="pm-hero ac-hero fa-hero">
      <div>
        <p class="pm-kicker">الأصول الثابتة</p>
        <h1>العهد ونماذج الاستلام</h1>
        <p class="pm-sub">كل أصل مادي في عهدة موظف بنموذج استلام. لا يُقبل إخلاء طرف موظف لديه عهدة أصول إلا بعد إثبات إرجاعها أو نقلها لموظف آخر.</p>
      </div>
    </section>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="board?.withoutCustodian" class="ac-warn pulse">
      <b>{{ board.withoutCustodian }} أصل مادي بلا عهدة.</b>&nbsp;
      <RouterLink to="/accounting/assets/register?status=books" class="pm-link">افتح سجل الأصول وسلّمها لموظفين</RouterLink>
    </div>

    <div class="fa-grid2">
      <section class="card pm-panel">
        <h2>الموظفون أصحاب العهد <input v-model="q" class="input" placeholder="ابحث بالاسم" style="width: 180px" /></h2>
        <button v-for="e in shown" :key="e.employeeId" :class="['emp', { on: sel?.employeeId === e.employeeId, out: e.employeeStatus !== 'active' }]" @click="open(e)">
          <span class="av">{{ e.name.slice(0, 1) }}</span>
          <span class="grow"><b>{{ e.name }}</b><small class="pm-muted">{{ e.unitName ?? '' }} · رقم {{ e.employeeNo }}{{ e.employeeStatus !== 'active' ? ' · ليس على رأس العمل' : '' }}</small></span>
          <span class="ac-num"><b>{{ e.assets }} أصل</b><small class="pm-muted">{{ sar(e.nbv) }}</small><small v-if="e.unconfirmed" class="unc">{{ e.unconfirmed }} لم يؤكد</small></span>
        </button>
        <p v-if="!shown.length" class="pm-empty">لا توجد عهد</p>
      </section>

      <section class="card pm-panel">
        <template v-if="sel">
          <h2>عهدة {{ sel.name }}</h2>
          <p v-if="!detail" class="pm-muted">جارٍ التحميل...</p>
          <template v-else>
            <div v-for="a in detail.held" :key="a.id" class="fa-grow">
              <span class="grow"><RouterLink :to="`/accounting/assets/${a.id}`" class="pm-link"><b>{{ a.name }}</b></RouterLink><small class="pm-muted ac-code">{{ a.code }} · {{ a.location }}</small></span>
              <span class="ac-num">{{ sar(a.nbv) }}</span>
            </div>
            <p v-if="!detail.held.length" class="pm-empty">لا يحمل أي أصل الآن</p>
            <h2 style="margin-top: 14px">نماذج العهدة</h2>
            <div v-for="f in detail.forms" :key="f.id" class="form-row">
              <span class="grow"><b>{{ f.kindLabel }} رقم {{ f.formNo }}</b><small class="pm-muted">{{ f.assetName }} · {{ f.date }}</small></span>
              <span v-if="f.confirmedAt" class="pm-ok">✓ مؤكد</span>
              <button v-else-if="f.toEmployeeId === sel.employeeId" class="btn btn-sm" @click="confirmForm(f.id)">تأكيد الاستلام</button>
              <RouterLink :to="`/accounting/assets/custody/forms/${f.id}`" class="pm-link">طباعة</RouterLink>
            </div>
          </template>
        </template>
        <template v-else>
          <h2>أحدث نماذج العهدة</h2>
          <div v-for="f in board?.recent ?? []" :key="f.id" class="form-row">
            <span class="grow"><b>{{ f.kindLabel }} رقم {{ f.formNo }}</b><small class="pm-muted">{{ f.assetName }} · {{ f.fromName ? `من ${f.fromName} ` : '' }}{{ f.toName ? `إلى ${f.toName}` : '' }} · {{ f.date }}</small></span>
            <span v-if="f.confirmedAt" class="pm-ok">✓</span><span v-else-if="f.toEmployeeId" class="pm-tag">ينتظر التأكيد</span>
            <RouterLink :to="`/accounting/assets/custody/forms/${f.id}`" class="pm-link">طباعة</RouterLink>
          </div>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.emp { width: 100%; display: flex; gap: 10px; align-items: center; padding: 10px; border-radius: 12px; border: 1px solid transparent; background: none; font: inherit; text-align: start; cursor: pointer; transition: .15s; }
.emp:hover { background: var(--surface-2); }
.emp.on { border-color: var(--primary); background: var(--primary-soft); }
.emp.out { border-color: #fecaca; }
.emp .av { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; color: #fff; background: linear-gradient(135deg, #0ea5e9, #164e38); flex: 0 0 38px; }
.emp .grow, .form-row .grow { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.emp .ac-num { display: flex; flex-direction: column; align-items: flex-end; }
.unc { color: #b45309 !important; font-weight: 700; }
.form-row { display: flex; gap: 10px; align-items: center; padding: 8px 0; border-bottom: 1px dashed var(--border); }
</style>
