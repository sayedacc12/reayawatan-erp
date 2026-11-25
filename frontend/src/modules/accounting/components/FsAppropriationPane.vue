<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api } from '../../../api';
import { useToast } from '../../../stores/toast';
import { dt, todayStr } from '../lib';
import { amt, type FsOptions } from '../statements';

/**
 * مشروع توزيع الأرباح للسنة المالية (يُعرض ضمن الميزانية السنوية): حصة التنمية (حتى 30%) ومنها الاحتياطي التشغيلي،
 * والتوزيع على العضو (حتى 10%)، والباقي للمصارف غير الربحية في المادة (4) من النظام الأساس.
 * هو مشروع يُرفع لمجلس المديرين ولا يُنشئ قيودًا؛ والقيود المقترحة تُسجَّل بعد قرار المجلس.
 */
const props = defineProps<{ opts: FsOptions; canEdit: boolean }>();
const toast = useToast();

interface Program { channel: number; name: string; amount: number }
interface Result {
  netProfit: number; accumulatedLosses: number; unrealized: number; distributable: number;
  development: number; developmentPct: number; reserveTarget: number; reserveBalance: number; reserve: number; expansion: number;
  distribution: number; distributionPct: number; nonprofit: number; nonprofitPct: number; programsTotal: number; deferred: number;
  entries: { debit: string; credit: string; amount: number }[]; issues: { level: 'error' | 'warning'; text: string }[]; valid: boolean;
}
interface Appr {
  year: string; yearStatus: string; saved: boolean; updatedByName: string | null; updatedAt: string | null;
  history: { at: string; by: string; action: string }[];
  inputs: { developmentPct: number; distributionPct: number; reserveMonths: number; unrealized: number; programs: Program[]; boardDecision: string | null; notes: string | null };
  result: Result;
}

const today = todayStr();
const yearId = ref((props.opts.years.find((y) => y.startDate <= today && y.endDate >= today) ?? props.opts.years[0])?.id ?? '');
const data = ref<Appr | null>(null);
const error = ref('');
const busy = ref(false);
const f = reactive({ developmentPct: 30, distributionPct: 0, reserveMonths: 6, unrealized: 0, programs: [] as Program[], boardDecision: '', notes: '' });
const snap = ref('');
const dirty = computed(() => !!data.value && JSON.stringify(f) !== snap.value);
const pol = computed(() => props.opts.policy);

async function load() {
  if (!yearId.value) return;
  try {
    const d = await api<Appr>(`/accounting/statements/appropriation?yearId=${yearId.value}`);
    data.value = d; error.value = '';
    Object.assign(f, { ...d.inputs, programs: d.inputs.programs.map((p) => ({ ...p })), boardDecision: d.inputs.boardDecision ?? '', notes: d.inputs.notes ?? '' });
    snap.value = JSON.stringify(f);
  } catch (e) { data.value = null; error.value = (e as Error).message; }
}
watch(yearId, load);

function addProgram() { f.programs.push({ channel: 3, name: '', amount: 0 }); }
async function save() {
  busy.value = true;
  try {
    data.value = await api<Appr>('/accounting/statements/appropriation', { method: 'PUT', json: {
      yearId: yearId.value, developmentPct: Number(f.developmentPct), distributionPct: Number(f.distributionPct), reserveMonths: Number(f.reserveMonths),
      unrealized: Number(f.unrealized) || 0, programs: f.programs.map((p) => ({ channel: Number(p.channel), name: p.name.trim(), amount: Number(p.amount) || 0 })),
      boardDecision: f.boardDecision.trim() || null, notes: f.notes.trim() || null,
    } });
    snap.value = JSON.stringify(f);
    toast.success('حُفظ مشروع التوزيع وأُعيد احتسابه');
  } catch (e) { toast.error((e as Error).message); } finally { busy.value = false; }
}
async function remove() {
  if (!confirm('حذف مشروع التوزيع المحفوظ لهذه السنة والعودة للقيم المقترحة في السياسة؟')) return;
  busy.value = true;
  try { await api(`/accounting/statements/appropriation/${yearId.value}`, { method: 'DELETE' }); toast.success('حُذف المشروع'); await load(); } catch (e) { toast.error((e as Error).message); } finally { busy.value = false; }
}
onMounted(load);
</script>

<template>
  <div>
    <section class="card pm-panel">
      <h2>مشروع توزيع الأرباح <span class="pm-muted">وفق النظام الأساس ومسودة سياسة توزيع الأرباح POL-FIN-03</span></h2>
      <div class="ap-row">
        <label class="field"><span>السنة المالية</span>
          <select v-model="yearId" class="input"><option v-for="y in opts.years" :key="y.id" :value="y.id">{{ y.name }}{{ y.status === 'closed' ? ' · مغلقة' : '' }}</option></select></label>
      </div>
      <p class="pm-muted">يُبنى المشروع على صافي ربح السنة كاملة بعد استيعاب الخسائر المتراكمة والأرباح غير المحققة نقدًا. يظهر في الميزانية السنوية مشروعًا يُرفع لمجلس المديرين، ولا يُنشئ قيودًا.</p>
      <div v-if="error" class="alert alert-error">{{ error }}</div>
    </section>

    <template v-if="data">
      <div class="ap-grid">
        <section class="card pm-panel">
          <h2>مدخلات المشروع</h2>
          <div class="ap-fields">
            <label class="field"><span>حصة التنمية والتوسع % (الحد {{ pol.maxDevelopmentPct }}%)</span>
              <input v-model.number="f.developmentPct" type="number" min="0" :max="pol.maxDevelopmentPct" step="0.5" class="input" :disabled="!canEdit" /></label>
            <label class="field"><span>التوزيع على العضو % (الحد {{ pol.maxDistributionPct }}%)</span>
              <input v-model.number="f.distributionPct" type="number" min="0" :max="pol.maxDistributionPct" step="0.5" class="input" :disabled="!canEdit" /></label>
            <label class="field"><span>الاحتياطي التشغيلي (أشهر من المصروفات)</span>
              <input v-model.number="f.reserveMonths" type="number" min="0" max="24" class="input" :disabled="!canEdit" /></label>
            <label class="field"><span>أرباح غير محققة نقدًا تُستبعد</span>
              <input v-model.number="f.unrealized" type="number" min="0" step="0.01" class="input" :disabled="!canEdit" /></label>
          </div>

          <h3 class="ap-h3">البرامج المقترحة من حصة المصارف غير الربحية</h3>
          <div v-for="(p, i) in f.programs" :key="i" class="ap-prog">
            <select v-model.number="p.channel" class="input" :disabled="!canEdit"><option v-for="(c, j) in opts.channels" :key="j" :value="j + 1">{{ j + 1 }}. {{ c }}</option></select>
            <input v-model="p.name" class="input" maxlength="200" placeholder="اسم البرنامج أو الجهة" :disabled="!canEdit" />
            <input v-model.number="p.amount" type="number" min="0" step="0.01" class="input ap-amt" :disabled="!canEdit" />
            <button v-if="canEdit" class="btn btn-sm" @click="f.programs.splice(i, 1)">حذف</button>
          </div>
          <button v-if="canEdit && f.programs.length < 30" class="btn btn-sm" @click="addProgram">إضافة برنامج</button>

          <label class="field"><span>قرار مجلس المديرين (إن صدر)</span><input v-model="f.boardDecision" class="input" maxlength="200" placeholder="مثل: قرار المجلس رقم 2/2027" :disabled="!canEdit" /></label>
          <label class="field"><span>ملاحظات</span><textarea v-model="f.notes" class="input" rows="2" maxlength="2000" :disabled="!canEdit" /></label>
          <div v-if="canEdit" class="modal-actions">
            <button v-if="data.saved" class="btn btn-danger" :disabled="busy" @click="remove">حذف المشروع</button>
            <button class="btn btn-primary" :disabled="busy" @click="save">{{ dirty ? 'حفظ وإعادة الاحتساب' : 'حفظ' }}</button>
          </div>
          <p class="pm-muted">{{ data.saved ? `آخر تعديل: ${data.updatedByName ?? ''} · ${dt(data.updatedAt)}` : 'غير محفوظ بعد: الأرقام بالقيم المقترحة في السياسة' }}</p>
        </section>

        <section class="card pm-panel">
          <h2>نتيجة الاحتساب <span v-if="dirty" class="pm-muted">احفظ لإعادة الاحتساب بالقيم الجديدة</span></h2>
          <table class="table ap-res"><tbody>
            <tr><td>صافي ربح السنة</td><td class="ac-num">{{ amt(data.result.netProfit) }}</td></tr>
            <tr v-if="data.result.accumulatedLosses"><td>يُطرح: الخسائر المتراكمة</td><td class="ac-num">{{ amt(-data.result.accumulatedLosses) }}</td></tr>
            <tr v-if="data.result.unrealized"><td>يُطرح: أرباح غير محققة نقدًا</td><td class="ac-num">{{ amt(-data.result.unrealized) }}</td></tr>
            <tr class="ap-strong"><td>الأرباح القابلة للتخصيص</td><td class="ac-num">{{ amt(data.result.distributable) }}</td></tr>
            <tr><td>حصة التنمية والتوسع ({{ data.result.developmentPct }}%)</td><td class="ac-num">{{ amt(data.result.development) }}</td></tr>
            <tr class="ap-sub"><td>منها الاحتياطي التشغيلي (المستهدف {{ amt(data.result.reserveTarget) }}، القائم {{ amt(data.result.reserveBalance) }})</td><td class="ac-num">{{ amt(data.result.reserve) }}</td></tr>
            <tr class="ap-sub"><td>ومنها احتياطي تنمية الاستثمارات والتوسع</td><td class="ac-num">{{ amt(data.result.expansion) }}</td></tr>
            <tr><td>التوزيع على العضو الوحيد ({{ data.result.distributionPct }}%)</td><td class="ac-num">{{ amt(data.result.distribution) }}</td></tr>
            <tr class="ap-strong"><td>حصة المصارف غير الربحية ({{ data.result.nonprofitPct }}%)</td><td class="ac-num">{{ amt(data.result.nonprofit) }}</td></tr>
            <tr class="ap-sub"><td>منها البرامج المقترحة</td><td class="ac-num">{{ amt(data.result.programsTotal) }}</td></tr>
            <tr class="ap-sub"><td>ومنها مخصص مؤجل لم يُحدد مصرفه</td><td class="ac-num">{{ amt(data.result.deferred) }}</td></tr>
          </tbody></table>
          <div v-for="i in data.result.issues" :key="i.text" :class="['alert', i.level === 'error' ? 'alert-error' : 'alert-warn']">{{ i.text }}</div>
          <template v-if="data.result.entries.length">
            <h3 class="ap-h3">القيود المقترحة بعد قرار المجلس</h3>
            <table class="table"><thead><tr><th>من حـ/</th><th>إلى حـ/</th><th class="ac-num">المبلغ</th></tr></thead>
              <tbody><tr v-for="e in data.result.entries" :key="e.credit"><td>{{ e.debit }}</td><td>{{ e.credit }}</td><td class="ac-num">{{ amt(e.amount) }}</td></tr></tbody></table>
          </template>
          <template v-if="data.history.length">
            <h3 class="ap-h3">سجل التغييرات</h3>
            <ul class="ap-hist"><li v-for="h in [...data.history].reverse()" :key="h.at">{{ h.action }} · {{ h.by }} · {{ dt(h.at) }}</li></ul>
          </template>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ap-row { display: flex; gap: 12px; }
.ap-row .field { flex: 0 1 300px; }
.ap-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 14px; margin-top: 14px; }
.ap-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
.ap-h3 { font-size: .9rem; margin: 14px 0 8px; }
.ap-prog { display: grid; grid-template-columns: minmax(160px, 1.4fr) minmax(140px, 1.2fr) 120px auto; gap: 6px; margin-bottom: 6px; align-items: center; }
.ap-res td { padding: 6px 10px; }
.ap-strong td { font-weight: 800; border-top: 1px solid var(--border); }
.ap-sub td:first-child { padding-inline-start: 24px; color: var(--muted); }
.ap-hist { margin: 0; padding-inline-start: 18px; color: var(--muted); font-size: .82rem; }
.alert { margin-top: 8px; }
@media (max-width: 640px) { .ap-grid { grid-template-columns: 1fr; } .ap-prog { grid-template-columns: 1fr; } }
</style>
