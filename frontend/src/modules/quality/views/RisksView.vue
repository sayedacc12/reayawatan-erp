<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { LEVEL_COLOR, P, STATUS_COLOR, TREATMENTS, errMsg, fmtDate, loadSettings, type ActionItem, type QSettings } from '../lib';
import '../../../shared/module.css';
import '../quality.css';

interface Risk {
  id: string; code: string; kind: 'risk' | 'opportunity'; title: string; process: string; department: string; departmentName: string; cause: string | null; consequence: string | null;
  likelihood: number; impact: number; score: number; level: string; levelLabel: string; treatment: string; treatmentLabel: string; actions: ActionItem[]; ownerName: string;
  residualLikelihood: number | null; residualImpact: number | null; residualScore: number | null; residualLevel: string | null; status: 'open' | 'treated' | 'closed';
  reviewDate: string | null; reviewDue: boolean; actionsOpen: number;
}
const session = useSession();
const toast = useToast();
const rows = ref<Risk[]>([]);
const settings = ref<QSettings | null>(null);
const kind = ref<'risk' | 'opportunity' | ''>('');
const cell = ref<[number, number] | null>(null);
async function load() {
  rows.value = await api<Risk[]>('/quality/risks');
}
onMounted(async () => {
  settings.value = await loadSettings();
  await load();
});
const shown = computed(() => rows.value.filter((r) => (!kind.value || r.kind === kind.value) && (!cell.value || (r.likelihood === cell.value[0] && r.impact === cell.value[1]))));
const heat = computed(() => [5, 4, 3, 2, 1].map((l) => [1, 2, 3, 4, 5].map((i) => rows.value.filter((r) => r.kind === 'risk' && r.status !== 'closed' && r.likelihood === l && r.impact === i).length)));
const heatColor = (l: number, i: number) => LEVEL_COLOR[l * i >= 15 ? 'high' : l * i >= 8 ? 'medium' : 'low'];
const STATUS = { open: 'مفتوح', treated: 'تمت المعالجة', closed: 'مغلق' };

const empty = () => ({ id: '', kind: 'risk' as 'risk' | 'opportunity', title: '', process: '', department: 'QMS', cause: '', consequence: '', likelihood: 3, impact: 3, treatment: 'mitigate', ownerName: '', residualLikelihood: null as number | null, residualImpact: null as number | null, status: 'open' as Risk['status'], reviewDate: '', actions: [] as ActionItem[] });
const form = reactive({ show: false, ...empty() });
function edit(r?: Risk) {
  Object.assign(form, empty(), r ? { ...r, cause: r.cause ?? '', consequence: r.consequence ?? '', reviewDate: r.reviewDate ?? '', actions: r.actions.map((a) => ({ ...a })) } : {}, { show: true });
}
async function save() {
  try {
    const body = {
      kind: form.kind, title: form.title, process: form.process, department: form.department, cause: form.cause || null, consequence: form.consequence || null,
      likelihood: form.likelihood, impact: form.impact, treatment: form.treatment, ownerName: form.ownerName, residualLikelihood: form.residualLikelihood || null,
      residualImpact: form.residualImpact || null, status: form.status, reviewDate: form.reviewDate || null,
      actions: form.actions.map((a) => ({ id: a.id, title: a.title, ownerName: a.ownerName, dueDate: a.dueDate || null, status: a.status })),
    };
    await api(form.id ? `/quality/risks/${form.id}` : '/quality/risks', { method: form.id ? 'PUT' : 'POST', json: body });
    form.show = false;
    toast.success('حُفظ السجل');
    await load();
  } catch (e) {
    toast.error(errMsg(e));
  }
}
async function remove() {
  if (!confirm('حذف هذا السجل؟')) return;
  await api(`/quality/risks/${form.id}`, { method: 'DELETE' });
  form.show = false;
  await load();
}
const score = computed(() => form.likelihood * form.impact);
</script>

<template>
  <div>
    <section class="pm-hero q-hero">
      <div><p class="pm-kicker">البندان 6.1 و10.1</p><h1>سجل المخاطر والفرص</h1>
        <p class="pm-sub">لكل عملية مخاطرها وفرصها، تُقيّم بالاحتمال × الأثر (من 25): مرتفع 15 فأكثر، متوسط 8 إلى 14، منخفض أقل من 8، ثم تُعالج بإجراءات بمسؤول وموعد.</p></div>
      <div class="pm-actions"><button v-if="session.can(P.risks)" class="btn q-glow" @click="edit()">إضافة خطر أو فرصة</button></div>
    </section>
    <div class="q-grid">
      <section class="card pm-panel">
        <div class="q-tabs">
          <button :class="['q-tab', { on: kind === '' }]" @click="kind = ''">الكل <b>{{ rows.length }}</b></button>
          <button :class="['q-tab', { on: kind === 'risk' }]" @click="kind = 'risk'">المخاطر <b>{{ rows.filter((r) => r.kind === 'risk').length }}</b></button>
          <button :class="['q-tab', { on: kind === 'opportunity' }]" @click="kind = 'opportunity'">الفرص <b>{{ rows.filter((r) => r.kind === 'opportunity').length }}</b></button>
          <button v-if="cell" class="q-tab on" @click="cell = null">الاحتمال {{ cell[0] }} × الأثر {{ cell[1] }} ✕</button>
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>الكود</th><th>الوصف</th><th>العملية</th><th>الدرجة</th><th>المعالجة</th><th>بعد المعالجة</th><th>المالك</th><th>الحالة</th></tr></thead>
          <tbody>
            <tr v-for="r in shown" :key="r.id" class="q-row" @click="session.can(P.risks) && edit(r)">
              <td><span class="q-code">{{ r.code }}</span></td>
              <td><b>{{ r.title }}</b><span v-if="r.cause" class="pm-muted">السبب: {{ r.cause }}</span></td>
              <td>{{ r.process }}<span class="pm-muted">{{ r.departmentName }}</span></td>
              <td><span class="pm-pill" :style="{ '--c': r.kind === 'risk' ? LEVEL_COLOR[r.level] : '#10b981' }">{{ r.score }} · {{ r.kind === 'risk' ? r.levelLabel : 'فرصة' }}</span><span class="pm-muted">{{ r.likelihood }} × {{ r.impact }}</span></td>
              <td>{{ r.treatmentLabel }}<span class="pm-muted">{{ r.actions.length - r.actionsOpen }}/{{ r.actions.length }} إجراء منفذ</span></td>
              <td><span v-if="r.residualScore" class="pm-pill" :style="{ '--c': LEVEL_COLOR[r.residualLevel!] }">{{ r.residualScore }}</span><template v-else>—</template></td>
              <td>{{ r.ownerName }}<span v-if="r.reviewDate" class="pm-muted" :style="{ color: r.reviewDue ? 'var(--danger)' : '' }">المراجعة {{ fmtDate(r.reviewDate) }}</span></td>
              <td><span class="pm-pill" :style="{ '--c': STATUS_COLOR[r.status] }">{{ STATUS[r.status] }}</span></td>
            </tr>
            <tr v-if="!shown.length"><td colspan="8" class="pm-empty">لا توجد سجلات</td></tr>
          </tbody>
        </table></div>
      </section>
      <section class="card pm-panel">
        <h2>خريطة حرارة المخاطر المفتوحة</h2>
        <div class="q-heat">
          <template v-for="(row, r) in heat" :key="r">
            <span class="ax">{{ 5 - r }}</span>
            <button v-for="(n, c) in row" :key="c" :class="['cell', { zero: !n }]" :style="{ '--c': heatColor(5 - r, c + 1), '--i': r * 5 + c, border: 0, cursor: n ? 'pointer' : 'default' }" @click="n && (cell = [5 - r, c + 1])">{{ n }}</button>
          </template>
          <span /><span v-for="i in 5" :key="'x' + i" class="ax">{{ i }}</span>
        </div>
        <div class="q-heat-cap"><span>↑ الاحتمال</span><span>الأثر ←</span></div>
        <div class="pm-legend" style="margin-top: 12px"><span style="--c: #ef4444">مرتفع</span><span style="--c: #f59e0b">متوسط</span><span style="--c: #10b981">منخفض</span></div>
        <p class="pm-muted" style="margin-top: 10px">اضغط أي خانة لعرض مخاطرها.</p>
      </section>
    </div>

    <div v-if="form.show" class="modal-backdrop" @click.self="form.show = false">
      <form class="card modal" style="max-width: 760px; max-height: 90vh; overflow: auto" @submit.prevent="save">
        <h2>{{ form.id ? 'تعديل' : 'إضافة' }} {{ form.kind === 'risk' ? 'خطر' : 'فرصة' }}</h2>
        <div class="q-tabs"><button type="button" :class="['q-tab', { on: form.kind === 'risk' }]" @click="form.kind = 'risk'">خطر</button><button type="button" :class="['q-tab', { on: form.kind === 'opportunity' }]" @click="form.kind = 'opportunity'">فرصة</button></div>
        <label class="field"><span>الوصف</span><input v-model="form.title" class="input" required /></label>
        <div class="q-fields">
          <label class="field"><span>العملية</span><input v-model="form.process" class="input" required /></label>
          <label class="field"><span>الإدارة</span><select v-model="form.department" class="input"><option v-for="d in settings?.departments" :key="d.code" :value="d.code">{{ d.code }} · {{ d.name }}</option></select></label>
          <label class="field"><span>المالك</span><input v-model="form.ownerName" class="input" required /></label>
          <label class="field"><span>السبب</span><input v-model="form.cause" class="input" /></label>
          <label class="field"><span>الأثر المتوقع</span><input v-model="form.consequence" class="input" /></label>
          <label class="field"><span>المعالجة</span><select v-model="form.treatment" class="input"><option v-for="t in TREATMENTS" :key="t.value" :value="t.value">{{ t.label }}</option></select></label>
          <label class="field"><span>الاحتمال (1-5)</span><input v-model.number="form.likelihood" type="range" min="1" max="5" /><b>{{ form.likelihood }}</b></label>
          <label class="field"><span>الأثر (1-5)</span><input v-model.number="form.impact" type="range" min="1" max="5" /><b>{{ form.impact }}</b></label>
          <div class="field"><span>الدرجة</span><span class="pm-pill" :style="{ '--c': LEVEL_COLOR[score >= 15 ? 'high' : score >= 8 ? 'medium' : 'low'] }">{{ score }}</span></div>
          <label class="field"><span>الاحتمال بعد المعالجة</span><select v-model.number="form.residualLikelihood" class="input"><option :value="null">—</option><option v-for="i in 5" :key="i" :value="i">{{ i }}</option></select></label>
          <label class="field"><span>الأثر بعد المعالجة</span><select v-model.number="form.residualImpact" class="input"><option :value="null">—</option><option v-for="i in 5" :key="i" :value="i">{{ i }}</option></select></label>
          <label class="field"><span>الحالة</span><select v-model="form.status" class="input"><option value="open">مفتوح</option><option value="treated">تمت المعالجة</option><option value="closed">مغلق</option></select></label>
          <label class="field"><span>موعد المراجعة القادمة</span><input v-model="form.reviewDate" type="date" class="input" /></label>
        </div>
        <p class="q-sec">إجراءات المعالجة</p>
        <div v-for="(a, i) in form.actions" :key="i" style="display: flex; gap: 6px; margin-bottom: 6px; align-items: center">
          <input v-model="a.title" class="input" placeholder="الإجراء" /><input v-model="a.ownerName" class="input" style="max-width: 150px" placeholder="المسؤول" />
          <input v-model="a.dueDate" type="date" class="input" style="max-width: 150px" />
          <label style="white-space: nowrap"><input type="checkbox" :checked="a.status === 'done'" @change="a.status = ($event.target as HTMLInputElement).checked ? 'done' : 'open'" /> نُفذ</label>
          <button type="button" class="btn btn-sm" @click="form.actions.splice(i, 1)">✕</button>
        </div>
        <button type="button" class="btn btn-sm" @click="form.actions.push({ title: '', ownerName: form.ownerName, dueDate: null, status: 'open' })">+ إجراء</button>
        <div class="modal-actions"><button class="btn btn-primary">حفظ</button><button type="button" class="btn" @click="form.show = false">إلغاء</button>
          <button v-if="form.id" type="button" class="btn" style="color: var(--danger); margin-inline-start: auto" @click="remove">حذف</button></div>
      </form>
    </div>
  </div>
</template>
