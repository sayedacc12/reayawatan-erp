<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../../api';
import { useSession } from '../../../stores/session';
import { useToast } from '../../../stores/toast';
import { fmtDate, loadCatalog, OBL_STATE, P, todayStr } from '../lib';
import '../../../shared/module.css';
import '../gov.css';

interface Obligation {
  id: string; kind: string; kindLabel: string; title: string; dueDate: string; doneDate: string | null; doneByName: string | null; fiscalYear: number;
  refs: string[]; evidence: string | null; note: string | null; state: string; daysLeft: number;
}
const session = useSession();
const toast = useToast();
const base = new Date().getFullYear();
const year = ref(base);
const rows = ref<Obligation[]>([]);
const kinds = ref<Record<string, string>>({});
const can = computed(() => session.can(P.calendar));
async function load() {
  rows.value = await api<Obligation[]>(`/governance/obligations?year=${year.value}`);
}
onMounted(async () => {
  kinds.value = (await loadCatalog()).obligationKinds;
  await load();
});
async function generate() {
  try {
    const r = await api<{ created: number }>('/governance/obligations/generate', { method: 'POST', json: { fiscalYear: year.value } });
    toast.success(r.created ? `أُضيف ${r.created} التزاماً` : 'التقويم مكتمل لهذه السنة');
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
const months = computed(() => {
  const m = new Map<string, Obligation[]>();
  for (const o of rows.value) {
    const k = o.dueDate.slice(0, 7);
    m.set(k, [...(m.get(k) ?? []), o]);
  }
  return [...m.entries()];
});
const monthName = (k: string) => new Date(`${k}-01T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory', { month: 'long', year: 'numeric' });
const blank = () => ({ show: false, id: '', kind: 'other', title: '', dueDate: todayStr(), doneDate: '', evidence: '', note: '' });
const form = reactive(blank());
function edit(o?: Obligation) {
  Object.assign(form, blank(), o ? { id: o.id, kind: o.kind, title: o.title, dueDate: o.dueDate, doneDate: o.doneDate ?? '', evidence: o.evidence ?? '', note: o.note ?? '' } : {}, { show: true });
}
async function save() {
  try {
    const json = { kind: form.kind, title: form.title, dueDate: form.dueDate, doneDate: form.doneDate || null, evidence: form.evidence || null, note: form.note || null };
    await api(form.id ? `/governance/obligations/${form.id}` : '/governance/obligations', { method: form.id ? 'PUT' : 'POST', json });
    form.show = false;
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function done(o: Obligation) {
  const evidence = prompt('الشاهد (رقم المحضر أو خطاب الرفع):', o.evidence ?? '');
  if (evidence === null) return;
  try {
    await api(`/governance/obligations/${o.id}`, { method: 'PUT', json: { kind: o.kind, title: o.title, dueDate: o.dueDate, doneDate: todayStr(), evidence: evidence || null, note: o.note } });
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
async function remove() {
  if (!confirm('حذف الالتزام؟')) return;
  await api(`/governance/obligations/${form.id}`, { method: 'DELETE' });
  form.show = false;
  await load();
}
const count = (s: string) => rows.value.filter((o) => o.state === s).length;
</script>

<template>
  <div>
    <section class="pm-hero gv-hero">
      <div>
        <p class="pm-kicker">تقويم الالتزامات النظامية</p>
        <h1>كل موعد يمسّ درجة الحوكمة في مكان واحد</h1>
        <p class="pm-sub">اجتماعات مجلس الإدارة الأربعة، والتقارير المالية الربعية، واجتماع الجمعية العمومية والقوائم المدققة وتقرير البرامج والموازنة خلال 4 أشهر من نهاية السنة، والتقييمات الذاتية الدورية. ينذر النظام قبل كل موعد.</p>
      </div>
      <div class="pm-actions" style="align-items: center">
        <select v-model.number="year" class="input" style="width: auto" @change="load"><option v-for="y in [base - 1, base, base + 1]" :key="y" :value="y">{{ y }}</option></select>
        <button v-if="can" class="btn gv-glow" @click="generate">توليد التزامات السنة</button>
        <button v-if="can" class="btn gv-ghost" @click="edit()">التزام آخر</button>
      </div>
    </section>
    <div class="pm-kpis">
      <div v-for="(s, k, i) in OBL_STATE" :key="k" class="pm-kpi" :style="{ '--a': s.color, '--i': i }"><span>{{ s.label }}</span><strong>{{ count(k) }}</strong></div>
    </div>
    <p v-if="!rows.length" class="card pm-panel pm-empty">لا توجد التزامات لسنة {{ year }}. اضغط «توليد التزامات السنة».</p>
    <section v-for="[m, list] in months" :key="m" class="card pm-panel" style="margin-bottom: 12px">
      <h2>{{ monthName(m) }}</h2>
      <table class="table">
        <tbody><tr v-for="o in list" :key="o.id">
          <td style="width: 110px">{{ fmtDate(o.dueDate) }}</td>
          <td><span class="gv-pill" :style="{ '--c': OBL_STATE[o.state].color }">{{ OBL_STATE[o.state].label }}</span></td>
          <td style="white-space: normal">{{ o.title }}<div class="pm-muted">{{ o.kindLabel }}<template v-if="o.note"> · {{ o.note }}</template></div>
            <div v-if="o.doneDate" class="pm-muted">أُنجز {{ fmtDate(o.doneDate) }}{{ o.doneByName ? ` · ${o.doneByName}` : '' }}{{ o.evidence ? ` · ${o.evidence}` : '' }}</div></td>
          <td style="text-align: end; white-space: nowrap">
            <button v-if="can && !o.doneDate" class="btn btn-sm" @click="done(o)">تم الإنجاز</button>
            <button v-if="can" class="btn btn-sm btn-ghost" @click="edit(o)">تعديل</button>
          </td>
        </tr></tbody>
      </table>
    </section>

    <div v-if="form.show" class="modal-backdrop" @click.self="form.show = false">
      <form class="card modal" @submit.prevent="save">
        <h2>{{ form.id ? 'تعديل الالتزام' : 'التزام جديد' }}</h2>
        <label class="field"><span>النوع</span><select v-model="form.kind" class="input"><option v-for="(l, k) in kinds" :key="k" :value="k">{{ l }}</option></select></label>
        <label class="field"><span>العنوان</span><input v-model="form.title" class="input" required /></label>
        <div class="pm-grid2">
          <label class="field"><span>الموعد</span><input v-model="form.dueDate" type="date" class="input" required /></label>
          <label class="field"><span>تاريخ الإنجاز</span><input v-model="form.doneDate" type="date" class="input" :max="todayStr()" /></label>
        </div>
        <label class="field"><span>الشاهد</span><input v-model="form.evidence" class="input" /></label>
        <label class="field"><span>ملاحظات</span><textarea v-model="form.note" class="input" rows="2" /></label>
        <div class="modal-actions">
          <button class="btn btn-primary">حفظ</button><button type="button" class="btn" @click="form.show = false">إلغاء</button>
          <button v-if="form.id" type="button" class="btn btn-ghost" style="margin-inline-start: auto" @click="remove">حذف</button>
        </div>
      </form>
    </div>
  </div>
</template>
