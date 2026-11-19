<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { errMsg, fmtDateTime, money, P, SECTIONS, short, WF_STATUS } from '../lib';
import '../../projects/projects.css';
import '../../risk/risk.css';
import '../planning.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const session = useSession();
const router = useRouter();
const toast = useToast();
const list = ref<any[] | null>(null);
const error = ref('');
const canManage = computed(() => session.can(P.budgets));
const form = reactive({ open: false, title: '', fiscalYear: new Date().getFullYear() + 1, historyYears: 3, copyFromId: '', busy: false });

async function load() {
  try { list.value = await api<any[]>('/planning/budgets'); } catch (e) { error.value = errMsg(e); }
}
onMounted(load);
function open() {
  Object.assign(form, { open: true, title: `الموازنة التقديرية لعام ${form.fiscalYear}`, copyFromId: list.value?.[0]?.id ?? '' });
}
async function create() {
  form.busy = true;
  try {
    const b = await api<any>('/planning/budgets', { method: 'POST', json: { title: form.title, fiscalYear: form.fiscalYear, historyYears: form.historyYears, copyFromId: form.copyFromId || null } });
    toast.success('أُنشئت الموازنة');
    router.push(`/planning/budgets/${b.id}`);
  } catch (e) {
    toast.error(errMsg(e));
  } finally {
    form.busy = false;
  }
}
const share = (b: any, k: string) => (b.expenses ? Math.round((b.sections[k] / b.expenses) * 100) : 0);
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>الموازنات التقديرية</h1>
        <p class="muted">موازنة شاملة لكل سنة مالية تُبنى من بيانات الأنظمة الأخرى: الرواتب من الموارد البشرية، والمصروفات والإيرادات الفعلية من المحاسبة، والأنشطة من الخطط التشغيلية، والمشاريع، ثم تُحسب بمعادلات قابلة للتعديل وتُعتمد بإصدارات.</p></div>
      <button v-if="canManage" class="btn pl-glow" @click="open">+ موازنة جديدة</button>
    </div>
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <p v-if="list && !list.length" class="card pm-empty" style="padding: 40px">لا توجد موازنات بعد.{{ canManage ? ' أنشئ موازنة السنة القادمة ثم استورد بياناتها من الأنظمة الأخرى بضغطة واحدة.' : '' }}</p>
    <div v-if="list" class="pl-cards">
      <div v-for="(b, i) in list" :key="b.id" class="card pl-card-plan bg-card" :style="{ '--i': i }" @click="router.push(`/planning/budgets/${b.id}`)">
        <div class="pl-flex"><span class="rk-code">{{ b.code }}</span><span class="pm-pill" :style="{ '--c': WF_STATUS[b.status]?.color }">{{ WF_STATUS[b.status]?.label }}</span>
          <span v-if="b.version" class="pm-tag">إصدار {{ b.version }}</span><span class="pm-tag">{{ b.methodologyName }}</span></div>
        <div><b style="font-size: 1.05rem">{{ b.title }}</b><small class="pm-muted" style="display: block">السنة المالية {{ b.fiscalYear }} · {{ b.lines }} بندًا</small></div>
        <p v-if="b.stageName" class="pm-muted" style="margin: 0">بانتظار «{{ b.stageName }}»<b v-if="b.canDecide" style="color: #f59e0b"> · قرارك</b></p>
        <div class="bg-stack" :title="'توزيع المصروفات'">
          <i v-for="k in ['hr', 'opex', 'activity']" :key="k" :style="{ width: `${share(b, k)}%`, background: SECTIONS[k].color }" />
        </div>
        <div class="pl-stat3">
          <div><b>{{ short(b.expenses) }}</b><small>المصروفات</small></div>
          <div><b>{{ short(b.revenues) }}</b><small>الإيرادات</small></div>
          <div><b :style="{ color: b.balance < 0 ? '#dc2626' : '#059669' }">{{ short(b.balance) }}</b><small>{{ b.balance < 0 ? 'العجز' : 'الفائض' }}</small></div>
        </div>
        <small class="pm-muted">آخر احتساب {{ fmtDateTime(b.calculatedAt) }} · {{ b.createdByName }}</small>
      </div>
    </div>

    <div v-if="form.open" class="modal-backdrop" @click.self="form.open = false">
      <form class="card modal" @submit.prevent="create">
        <h2>موازنة تقديرية جديدة</h2>
        <label class="field"><span>العنوان</span><input v-model="form.title" class="input" required /></label>
        <div class="rk-fields">
          <label class="field"><span>السنة المالية</span><input v-model.number="form.fiscalYear" type="number" class="input" required @change="form.title = `الموازنة التقديرية لعام ${form.fiscalYear}`" /></label>
          <label class="field"><span>سنوات التاريخ الفعلي</span><input v-model.number="form.historyYears" type="number" min="1" max="10" class="input" /></label>
        </div>
        <label class="field"><span>البدء من موازنة سابقة (اختياري)</span>
          <select v-model="form.copyFromId" class="input"><option value="">موازنة جديدة بالافتراضات العامة</option>
            <option v-for="b in list ?? []" :key="b.id" :value="b.id">{{ b.code }} {{ b.title }} ({{ money(b.expenses) }})</option></select></label>
        <p class="pm-muted">النسخ ينقل الافتراضات وقواعد العلاوات والسقوف وطريقة تقدير كل بند مصروف وإيراد، ويعيد جلب التاريخ الفعلي للسنة الجديدة. الموظفون والأنشطة تُستورد من جديد.</p>
        <div class="modal-actions"><button class="btn btn-primary" :disabled="form.busy">إنشاء</button><button type="button" class="btn" @click="form.open = false">إلغاء</button></div>
      </form>
    </div>
  </div>
</template>
